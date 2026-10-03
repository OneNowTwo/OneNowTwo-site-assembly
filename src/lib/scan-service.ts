import type { BBox, ParcelData } from "@/lib/types";
import { clampBBox, MAX_BBOX_SPAN_DEG } from "@/lib/data-sources/nsw-cadastre";
import { fetchNominatedCentres, bboxAround, nearestLmrCentre, type NominatedCentre } from "@/lib/data-sources/housing-sepp-lmr";
import { getParcelsForBBox } from "@/lib/parcel-service";
import { getGlobalAssumptions } from "@/lib/opportunity-service";
import { applyValuationsToScanResult, runAreaScan, type AreaScanResult } from "@/lib/analysis/area-scan";
import type { WalkingDistanceHint } from "@/lib/analysis/effective-controls";
import { nearestPointOnRing, walkingDistanceProvider, WALKING_PROVIDER_NAME } from "@/lib/data-sources/walking-distance";
import { valueParcels, valuationProviderStatus } from "@/lib/data-sources/valuation-service";

/** Tile a bbox into cadastre-safe cells. */
export function tileBBox(b: BBox, maxSpan = MAX_BBOX_SPAN_DEG): BBox[] {
  const width = b.east - b.west;
  const height = b.north - b.south;
  if (width <= maxSpan && height <= maxSpan) return [clampBBox(b)];
  const tiles: BBox[] = [];
  for (let west = b.west; west < b.east; west += maxSpan * 0.92) {
    for (let south = b.south; south < b.north; south += maxSpan * 0.92) {
      tiles.push(
        clampBBox({
          west,
          south,
          east: Math.min(b.east, west + maxSpan),
          north: Math.min(b.north, south + maxSpan),
        }),
      );
    }
  }
  return tiles.slice(0, 9); // hard cap for V1 performance
}

async function loadParcelsTiled(bbox: BBox): Promise<{
  parcels: ParcelData[];
  messages: string[];
  cadastreStatus: string;
  planningStatus: string;
  loadedCount: number;
}> {
  const tiles = tileBBox(bbox);
  const byId = new Map<string, ParcelData>();
  const messages: string[] = [];
  let cadastreStatus = "live";
  let planningStatus = "live";
  for (const tile of tiles) {
    const result = await getParcelsForBBox(tile);
    for (const p of result.parcels) byId.set(p.externalParcelId, p);
    messages.push(...result.messages);
    if (result.cadastreStatus !== "live") cadastreStatus = result.cadastreStatus;
    if (result.planningStatus !== "live") planningStatus = result.planningStatus;
  }
  let parcels = [...byId.values()];
  const loadedCount = parcels.length;
  const SCAN_PARCEL_CAP = 1200;
  if (parcels.length > SCAN_PARCEL_CAP) {
    // Prefer residential / mid-size lots — NOT the smallest 450 (that starved suburb scans).
    const scoreParcel = (p: ParcelData) => {
      const zone = p.planning?.zone ?? "";
      const residential = /^R[1-4]$/.test(zone) ? 1000 : 0;
      const strataPenalty = p.isStrata ? -500 : 0;
      // Prefer typical house lots for assembly (250–1200 sqm).
      const areaFit = p.areaSqm >= 250 && p.areaSqm <= 1200 ? 200 : p.areaSqm >= 200 && p.areaSqm <= 2000 ? 80 : 0;
      return residential + strataPenalty + areaFit + Math.min(p.areaSqm, 800) / 10;
    };
    parcels = [...parcels].sort((a, b) => scoreParcel(b) - scoreParcel(a)).slice(0, SCAN_PARCEL_CAP);
    messages.push(
      `PARTIAL SCAN — processed ${parcels.length} of ${loadedCount} parcels (cap ${SCAN_PARCEL_CAP} for performance). Not a complete suburb inventory.`,
    );
  }
  return { parcels, messages, cadastreStatus, planningStatus, loadedCount };
}

async function enrichWalkingHints(
  parcels: ParcelData[],
  centres: NominatedCentre[],
  maxRoutes = 36,
): Promise<{ walkingByParcelId: Map<string, WalkingDistanceHint>; messages: string[] }> {
  const walkingByParcelId = new Map<string, WalkingDistanceHint>();
  const messages: string[] = [];
  if (!centres.length) return { walkingByParcelId, messages };

  type Cand = { id: string; from: [number, number]; to: [number, number]; straight: number };
  const cands: Cand[] = [];
  for (const p of parcels) {
    const prox = nearestLmrCentre({ type: "Point", coordinates: p.centroid }, centres);
    if (!prox || prox.distanceM > 900) continue;
    const fromPt = { type: "Point" as const, coordinates: p.centroid };
    const to = prox.centre.boundaryRing?.length
      ? nearestPointOnRing(fromPt, prox.centre.boundaryRing)
      : { type: "Point" as const, coordinates: [prox.centre.lng, prox.centre.lat] as [number, number] };
    cands.push({
      id: p.externalParcelId,
      from: p.centroid,
      to: [to.coordinates[0], to.coordinates[1]],
      straight: Math.round(prox.distanceM),
    });
  }
  cands.sort((a, b) => a.straight - b.straight);
  const sample = cands.slice(0, maxRoutes);
  if (!sample.length) return { walkingByParcelId, messages };

  let ok = 0;
  let failed = 0;
  const concurrency = 4;
  for (let i = 0; i < sample.length; i += concurrency) {
    const batch = sample.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (c) => {
        const route = await walkingDistanceProvider.route(
          { type: "Point", coordinates: c.from },
          { type: "Point", coordinates: c.to },
        );
        return { id: c.id, route };
      }),
    );
    for (const { id, route } of results) {
      walkingByParcelId.set(id, {
        walkingDistanceM: route.walkingDistanceM,
        straightLineDistanceM: route.straightLineDistanceM,
        status: route.status,
        provider: route.provider,
      });
      if (route.status === "OK") ok++;
      else failed++;
    }
  }

  messages.push(
    `Pedestrian routing via ${WALKING_PROVIDER_NAME}: ${ok} confirmed, ${failed} not confirmed (${sample.length} of ${cands.length} LMR-proximate parcels checked).`,
  );
  if (failed > 0) {
    messages.push("WALKING DISTANCE NOT CONFIRMED for some parcels — straight-line screening only; modelled FSR stays REQUIRES PLANNING CONFIRMATION.");
  }
  return { walkingByParcelId, messages };
}

/**
 * Staged area scan:
 * 1) planning/geometry  2) assemblies  3) top candidates
 * 4) auto-value only those lots  5) feasibility  6) rerank
 */
export async function scanArea(input: {
  bbox?: BBox;
  centreQuery?: string;
  suburbHint?: string;
  maxResults?: number;
  /** Skip live AVM (tests / offline). */
  skipValuation?: boolean;
}): Promise<
  AreaScanResult & {
    bbox: BBox;
    cadastreStatus: string;
    planningStatus: string;
    valuedParcels: ParcelData[];
    valuationStatus: ReturnType<typeof valuationProviderStatus> & { valued: number; attempted: number };
  }
> {
  const assumptions = await getGlobalAssumptions();
  let bbox = input.bbox;
  let centres: NominatedCentre[] = [];
  const progress: string[] = [];

  if (input.centreQuery || input.suburbHint) {
    const q = (input.centreQuery ?? input.suburbHint ?? "").toLowerCase();
    const broad: BBox = bbox ?? { west: 150.6, south: -34.2, east: 151.4, north: -33.5 };
    const all = await fetchNominatedCentres(broad);
    const matched = all.filter((c) => c.label.toLowerCase().includes(q) || q.split(/\s+/).every((w) => c.label.toLowerCase().includes(w)));
    if (matched.length) {
      centres = matched;
      const c = matched[0]!;
      bbox = bboxAround(c.lng, c.lat, 800);
    }
  }

  if (!bbox) throw new Error("bbox or centreQuery required");

  if (!centres.length) {
    const pad = 0.01;
    centres = await fetchNominatedCentres({
      west: bbox.west - pad,
      south: bbox.south - pad,
      east: bbox.east + pad,
      north: bbox.north + pad,
    });
  }

  progress.push("Planning scan");
  const loaded = await loadParcelsTiled(bbox);
  const walking = await enrichWalkingHints(loaded.parcels, centres);

  progress.push("Generating assemblies");
  let result = runAreaScan({
    parcels: loaded.parcels,
    centres,
    assumptions,
    maxResults: input.maxResults ?? 20,
    walkingByParcelId: walking.walkingByParcelId,
  });
  const partial = loaded.loadedCount > loaded.parcels.length;
  result = {
    ...result,
    funnel: {
      ...result.funnel,
      parcelsLoaded: loaded.loadedCount,
      partialScan: partial || result.funnel.partialScan,
    },
    progress: [...progress, "Planning scan complete", "Generating assemblies", ...result.progress],
  };
  if (partial) {
    result.messages = [
      `SCAN AREA: map bbox / centre catchment (not necessarily full suburb boundary). Loaded ${loaded.loadedCount} parcels; processed ${loaded.parcels.length}.`,
      ...result.messages,
    ];
  }

  // Stage 3–6: value only lots in top candidate assemblies.
  const topIds = new Set<string>();
  for (const c of result.candidates) for (const id of c.lotIds) topIds.add(id);
  // Also include family alternatives so Analyse paths are covered.
  for (const f of result.families) {
    for (const alt of f.alternatives) for (const id of alt.lotIds) topIds.add(id);
  }

  const toValue = loaded.parcels.filter((p) => topIds.has(p.externalParcelId));
  let valuedParcels = loaded.parcels;
  let valued = 0;
  const valMessages: string[] = [];
  const providerStatus = valuationProviderStatus();

  if (!input.skipValuation && toValue.length) {
    progress.push("Valuing properties");
    const batch = await valueParcels(toValue, { concurrency: 2 });
    valued = batch.valued;
    valMessages.push(...batch.messages);
    const byId = new Map(batch.parcels.map((p) => [p.externalParcelId, p]));
    valuedParcels = loaded.parcels.map((p) => byId.get(p.externalParcelId) ?? p);

    progress.push("Running feasibility");
    result = applyValuationsToScanResult(result, valuedParcels, assumptions);
    progress.push("Ranking opportunities");
    result = { ...result, progress: [...new Set([...progress, ...result.progress])] };
  }

  return {
    ...result,
    messages: [...loaded.messages, ...walking.messages, ...valMessages, ...result.messages],
    bbox,
    cadastreStatus: loaded.cadastreStatus,
    planningStatus: loaded.planningStatus,
    valuedParcels: valuedParcels.filter((p) => topIds.has(p.externalParcelId)),
    valuationStatus: { ...providerStatus, valued, attempted: toValue.length },
  };
}

export async function resolveCentre(labelIncludes: string): Promise<NominatedCentre | null> {
  const centres = await fetchNominatedCentres({ west: 150.6, south: -34.2, east: 151.4, north: -33.5 });
  return centres.find((c) => c.label.toLowerCase().includes(labelIncludes.toLowerCase())) ?? null;
}
