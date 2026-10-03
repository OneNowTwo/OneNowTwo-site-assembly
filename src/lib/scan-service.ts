import type { BBox, ParcelData } from "@/lib/types";
import { clampBBox, MAX_BBOX_SPAN_DEG } from "@/lib/data-sources/nsw-cadastre";
import { fetchNominatedCentres, bboxAround, nearestLmrCentre, type NominatedCentre } from "@/lib/data-sources/housing-sepp-lmr";
import { getParcelsForBBox } from "@/lib/parcel-service";
import { getGlobalAssumptions } from "@/lib/opportunity-service";
import { runAreaScan, type AreaScanResult } from "@/lib/analysis/area-scan";
import type { WalkingDistanceHint } from "@/lib/analysis/effective-controls";
import { nearestPointOnRing, walkingDistanceProvider, WALKING_PROVIDER_NAME } from "@/lib/data-sources/walking-distance";

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

async function loadParcelsTiled(bbox: BBox): Promise<{ parcels: ParcelData[]; messages: string[]; cadastreStatus: string; planningStatus: string }> {
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
  // Cap parcel count for V1 scan cost
  let parcels = [...byId.values()];
  if (parcels.length > 450) {
    parcels = parcels.sort((a, b) => a.areaSqm - b.areaSqm).slice(0, 450);
    messages.push(`Scan capped at 450 parcels for performance (${byId.size} loaded).`);
  }
  return { parcels, messages, cadastreStatus, planningStatus };
}

/**
 * Pedestrian walking checks for parcels within ~900 m straight-line of a nominated centre.
 * Caps request volume; failures do not fall back to confirmed walking eligibility.
 */
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

export async function scanArea(input: {
  bbox?: BBox;
  /** Search near an official nominated centre by label substring. */
  centreQuery?: string;
  suburbHint?: string;
  maxResults?: number;
}): Promise<AreaScanResult & { bbox: BBox; cadastreStatus: string; planningStatus: string }> {
  const assumptions = await getGlobalAssumptions();
  let bbox = input.bbox;
  let centres: NominatedCentre[] = [];

  if (input.centreQuery || input.suburbHint) {
    const q = (input.centreQuery ?? input.suburbHint ?? "").toLowerCase();
    // Broad search then filter centres by name
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
    // Pad so centres near the edge of the scan are found
    const pad = 0.01;
    centres = await fetchNominatedCentres({
      west: bbox.west - pad,
      south: bbox.south - pad,
      east: bbox.east + pad,
      north: bbox.north + pad,
    });
  }

  const loaded = await loadParcelsTiled(bbox);
  const walking = await enrichWalkingHints(loaded.parcels, centres);
  const result = runAreaScan({
    parcels: loaded.parcels,
    centres,
    assumptions,
    maxResults: input.maxResults ?? 15,
    walkingByParcelId: walking.walkingByParcelId,
  });

  return {
    ...result,
    messages: [...loaded.messages, ...walking.messages, ...result.messages],
    bbox,
    cadastreStatus: loaded.cadastreStatus,
    planningStatus: loaded.planningStatus,
  };
}

/** Resolve Balgowlah Stockland centre for tests / default demos. */
export async function resolveCentre(labelIncludes: string): Promise<NominatedCentre | null> {
  const centres = await fetchNominatedCentres({ west: 150.6, south: -34.2, east: 151.4, north: -33.5 });
  return centres.find((c) => c.label.toLowerCase().includes(labelIncludes.toLowerCase())) ?? null;
}
