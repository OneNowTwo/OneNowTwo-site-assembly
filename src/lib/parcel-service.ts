import type { Polygon, MultiPolygon } from "geojson";
import { prisma } from "@/lib/db";
import type { BBox, ParcelData, PlanningControls } from "@/lib/types";
import { clampBBox, nswCadastreProvider } from "@/lib/data-sources/nsw-cadastre";
import { nswPlanningProvider } from "@/lib/data-sources/nsw-planning";
import { UpstreamError } from "@/lib/data-sources/http";
import type { Parcel, Prisma } from "@/generated/prisma/client";
import {
  latestSourceRetrievedAt,
  mergePlanningControls,
  planningControlsFromSnapshot,
} from "@/lib/planning/planning-persist";

export interface ParcelQueryResult {
  parcels: ParcelData[];
  cadastreStatus: "live" | "cached" | "unavailable";
  planningStatus: "live" | "partial" | "cached" | "unavailable";
  messages: string[];
  bbox: BBox;
}

/** Hosting proxy budget — keep full /api/parcels under ~30s. */
const PARCELS_ENDPOINT_BUDGET_MS = 25_000;
const CADASTRE_BUDGET_MS = 8_000;

type ParcelWithSnap = Parcel & { latestSnap?: { data: unknown; retrievedAt: Date; source: string } | null };

function planningFromRow(row: ParcelWithSnap): PlanningControls | null {
  if (row.planningCheckedAt == null && !row.latestSnap) return null;
  return planningControlsFromSnapshot(row.latestSnap?.data ?? null, row);
}

export function parcelFromRow(row: ParcelWithSnap): ParcelData {
  const planning = planningFromRow(row);
  const retrievedAt =
    latestSourceRetrievedAt(planning) ??
    (row.latestSnap?.retrievedAt ?? row.planningCheckedAt ?? row.updatedAt).toISOString();
  return {
    externalParcelId: row.externalParcelId,
    source: row.source === "MANUAL" ? "MANUAL" : "CACHED_NSW",
    lot: row.lot,
    section: row.section,
    dp: row.dp,
    lotIdString: row.lotIdString,
    address: row.address,
    suburb: row.suburb,
    geometry: row.geometry as unknown as Polygon | MultiPolygon,
    centroid: [row.centroidLng, row.centroidLat],
    areaSqm: row.areaSqm,
    isStrata: row.isStrata,
    planning,
    planningStatus: planning ? "ok" : "unavailable",
    retrievedAt,
  };
}

async function attachLatestSnapshots(rows: Parcel[]): Promise<ParcelWithSnap[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const snaps = await prisma.planningSnapshot.findMany({
    where: { parcelId: { in: ids } },
    orderBy: { retrievedAt: "desc" },
    distinct: ["parcelId"],
    select: { parcelId: true, data: true, retrievedAt: true, source: true },
  });
  const byParcel = new Map(snaps.map((s) => [s.parcelId, s]));
  return rows.map((r) => ({ ...r, latestSnap: byParcel.get(r.id) ?? null }));
}

async function storedParcelsInBBox(b: BBox) {
  const rows = await prisma.parcel.findMany({
    where: {
      centroidLng: { gte: b.west, lte: b.east },
      centroidLat: { gte: b.south, lte: b.north },
    },
    take: 2000,
  });
  return attachLatestSnapshots(rows);
}

/**
 * Persist live planning by merging successful layers only.
 * Failed layers keep previous verified values + original FieldSource dates.
 */
async function persistLivePlanning(
  parcels: Array<{
    externalParcelId: string;
    planning: PlanningControls | null;
    previous: PlanningControls | null;
    retrievedAt: string;
  }>,
): Promise<void> {
  const withPlanning = parcels.filter((p) => p.planning);
  if (!withPlanning.length) return;
  try {
    await Promise.all(
      withPlanning.map(async (p) => {
        const live = p.planning!;
        const merged = mergePlanningControls(p.previous, live);
        const checked = new Date(
          latestSourceRetrievedAt(merged) ?? p.retrievedAt,
        );
        const existing = await prisma.parcel.findUnique({
          where: { externalParcelId: p.externalParcelId },
          select: {
            id: true,
            zone: true,
            zoneName: true,
            fsr: true,
            heightM: true,
            minLotSizeSqm: true,
            heritage: true,
            planningInstrument: true,
            lga: true,
          },
        });
        if (!existing) return;
        await prisma.parcel.update({
          where: { id: existing.id },
          data: {
            zone: merged.zone,
            zoneName: merged.zoneName,
            fsr: merged.fsr,
            heightM: merged.heightM,
            minLotSizeSqm: merged.minLotSizeSqm,
            heritage: merged.heritage,
            planningInstrument: merged.planningInstrument,
            lga: merged.lga,
            planningCheckedAt: checked,
          },
        });
        await prisma.planningSnapshot.create({
          data: {
            parcelId: existing.id,
            source: "LIVE_NSW",
            data: merged as unknown as Prisma.InputJsonValue,
            retrievedAt: checked,
          },
        });
      }),
    );
  } catch {
    // Persistence is best-effort — never fail the map response.
  }
}

function remainingMs(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}

async function withBudget<T>(ms: number, label: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  if (ms <= 0) throw new UpstreamError(`${label} budget exhausted`, label);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    return await Promise.race([
      fn(ac.signal),
      new Promise<never>((_, reject) => {
        const onAbort = () => reject(new UpstreamError(`${label} request budget exceeded`, label));
        if (ac.signal.aborted) onAbort();
        else ac.signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Real NSW lots + planning for a map viewport. Falls back to previously stored NSW data when a service is down. */
export async function getParcelsForBBox(input: BBox): Promise<ParcelQueryResult> {
  const bbox = clampBBox(input);
  const messages: string[] = [];
  const deadline = Date.now() + PARCELS_ENDPOINT_BUDGET_MS;
  const cadastreStatus: ParcelQueryResult["cadastreStatus"] = "live";
  let base: Omit<ParcelData, "planning" | "planningStatus">[];
  let stored: ParcelWithSnap[] | null = null;

  try {
    base = await withBudget(Math.min(CADASTRE_BUDGET_MS, remainingMs(deadline)), "NSW Cadastre", async () =>
      nswCadastreProvider.getParcelsInBBox(bbox),
    );
  } catch (err) {
    stored = await storedParcelsInBBox(bbox);
    const msg = err instanceof UpstreamError ? err.message : "Cadastre service error";
    if (!stored.length) {
      return {
        parcels: [],
        cadastreStatus: "unavailable",
        planningStatus: "unavailable",
        messages: [`Cadastre service temporarily unavailable (${msg}).`],
        bbox,
      };
    }
    messages.push(
      `Cadastre service temporarily unavailable (${msg}). Showing ${stored.length} previously saved NSW parcels.`,
    );
    return {
      parcels: stored.map(parcelFromRow),
      cadastreStatus: "cached",
      planningStatus: "cached",
      messages,
      bbox,
    };
  }

  // Always load stored planning for fallback / merge.
  stored = await storedParcelsInBBox(bbox);
  const storedById = new Map(stored.map((r) => [r.externalParcelId, r]));

  let planningStatus: ParcelQueryResult["planningStatus"] = "live";
  let controls = new Map<string, PlanningControls>();
  let planningError: string | null = null;
  try {
    if (process.env.SA_FORCE_PLANNING_FAIL === "1") {
      throw new UpstreamError("Live NSW Planning did not respond", "NSW Planning");
    }
    const planningBudget = remainingMs(deadline);
    if (planningBudget < 1500) {
      throw new UpstreamError("Planning request budget exceeded", "NSW Planning");
    }
    controls = await withBudget(planningBudget, "NSW Planning", (signal) =>
      nswPlanningProvider.getControlsForParcels(
        bbox,
        base.map((p) => ({ id: p.externalParcelId, geometry: p.geometry })),
        { signal },
      ),
    );
    const sample = controls.values().next().value as PlanningControls | undefined;
    if (sample && Object.keys(sample.sources).length < 5) {
      planningStatus = "partial";
      messages.push("Some planning layers did not respond; missing fields are shown as not loaded — prior verified values are kept where available.");
    }
  } catch (err) {
    planningError = err instanceof Error ? err.message : "error";
    planningStatus = "unavailable";
  }

  const retrievedAt = new Date().toISOString();
  const parcels: ParcelData[] = base.map((p) => {
    const live = controls.get(p.externalParcelId);
    const row = storedById.get(p.externalParcelId);
    const previous = row ? planningFromRow(row) : null;

    if (live) {
      const merged = mergePlanningControls(previous, live);
      const sourceCount = Object.keys(merged.sources).length;
      return {
        ...p,
        planning: merged,
        planningStatus: sourceCount < 5 ? ("partial" as const) : ("ok" as const),
        retrievedAt: latestSourceRetrievedAt(merged) ?? retrievedAt,
      };
    }
    if (row?.planningCheckedAt || previous) {
      const cached = previous ?? planningFromRow(row!);
      const checkedIso =
        latestSourceRetrievedAt(cached) ??
        row!.planningCheckedAt?.toISOString() ??
        retrievedAt;
      return {
        ...p,
        planning: cached,
        planningStatus: "cached" as const,
        planningMessage: `Stored official planning (${checkedIso.slice(0, 10)}) — live NSW Planning did not respond.`,
        retrievedAt: checkedIso,
      };
    }
    return {
      ...p,
      planning: null,
      planningStatus: "unavailable" as const,
      planningMessage: planningError
        ? `Planning not loaded — ${planningError}. Retry to fetch live NSW controls.`
        : "Planning not loaded. Retry to fetch live NSW controls.",
    };
  });

  const cachedCount = parcels.filter((p) => p.planningStatus === "cached").length;
  const liveCount = parcels.filter((p) => p.planningStatus === "ok" || p.planningStatus === "partial").length;
  if (planningError) {
    if (cachedCount > 0) {
      planningStatus = "cached";
      messages.push(
        `Live planning unavailable (${planningError}). Showing stored official planning for ${cachedCount} parcel${cachedCount === 1 ? "" : "s"}.`,
      );
    } else {
      planningStatus = "unavailable";
      messages.push(`Planning service temporarily unavailable (${planningError}).`);
    }
  } else if (liveCount > 0) {
    // Persist off the critical path if budget is nearly exhausted; otherwise await briefly.
    const persistWork = persistLivePlanning(
      parcels.map((p) => ({
        externalParcelId: p.externalParcelId,
        planning: p.planning,
        previous: storedById.get(p.externalParcelId)
          ? planningFromRow(storedById.get(p.externalParcelId)!)
          : null,
        retrievedAt: p.retrievedAt,
      })),
    );
    if (remainingMs(deadline) > 2000) {
      await Promise.race([
        persistWork,
        new Promise<void>((resolve) => setTimeout(resolve, remainingMs(deadline) - 500)),
      ]);
    } else {
      void persistWork;
    }
  }

  return { parcels, cadastreStatus, planningStatus, messages, bbox };
}

/**
 * DB-only parcel lookup by external ids — no NSW cadastre / planning calls.
 * Used by INDEX_CANDIDATE MapTarget so Today → Map stays lightweight.
 */
export async function getStoredParcelsByExternalIds(externalParcelIds: string[]): Promise<ParcelData[]> {
  const ids = [...new Set(externalParcelIds.filter((id) => /^nsw-cadid:\d+$/.test(id)))];
  if (!ids.length) return [];
  const stored = await prisma.parcel.findMany({ where: { externalParcelId: { in: ids } } });
  const withSnaps = await attachLatestSnapshots(stored);
  return withSnaps.map(parcelFromRow);
}

export type GetParcelsByExternalIdsOptions = {
  /** Skip NSW planning attach (INDEX_CANDIDATE hydrate stays geometry-only). */
  skipPlanning?: boolean;
};

/**
 * Load parcels by external ids (nsw-cadid:N).
 * Prefers stored rows; hydrates missing lots from NSW cadastre by exact cadid only.
 * Never uses bbox / suburb scan / LMR.
 */
export async function getParcelsByExternalIds(
  externalParcelIds: string[],
  opts: GetParcelsByExternalIdsOptions = {},
): Promise<ParcelData[]> {
  const ids = [...new Set(externalParcelIds.filter((id) => /^nsw-cadid:\d+$/.test(id)))];
  if (!ids.length) return [];

  const stored = await attachLatestSnapshots(
    await prisma.parcel.findMany({ where: { externalParcelId: { in: ids } } }),
  );
  const byId = new Map(stored.map((r) => [r.externalParcelId, parcelFromRow(r)]));
  const previousById = new Map(stored.map((r) => [r.externalParcelId, planningFromRow(r)]));
  const missing = ids.filter((id) => !byId.has(id) || !byId.get(id)?.geometry);

  if (missing.length) {
    const cadids = missing.map((id) => id.replace("nsw-cadid:", "")).join(",");
    try {
      const { buildUrl, fetchJson } = await import("@/lib/data-sources/http");
      const { NSW_CADASTRE_BASE, splitNswAddress } = await import("@/lib/data-sources/nsw-cadastre");
      const { esriToGeoJSON } = await import("@/lib/data-sources/esri");
      const area = (await import("@turf/area")).default;
      const centroid = (await import("@turf/centroid")).default;
      const booleanPointInPolygon = (await import("@turf/boolean-point-in-polygon")).default;
      const pointOnFeature = (await import("@turf/point-on-feature")).default;
      type LotAttrs = {
        cadid: number;
        lotnumber: string | null;
        sectionnumber: string | null;
        planlabel: string | null;
        lotidstring: string | null;
        planlotarea: number | null;
      };
      type PropAttrs = { address: string | null; propid: number };
      type QueryResp<A> = { features: Array<{ attributes: A; geometry?: { rings: number[][][] } }> };
      const lotUrl = buildUrl(`${NSW_CADASTRE_BASE}/8/query`, {
        where: `cadid IN (${cadids})`,
        outFields: "cadid,lotnumber,sectionnumber,planlabel,lotidstring,planlotarea",
        returnGeometry: true,
        outSR: 4326,
        f: "json",
      });
      const lots = await fetchJson<QueryResp<LotAttrs>>(lotUrl, {
        service: "nsw-cadastre-by-id",
        ttlMs: 5 * 60 * 1000,
      });
      let props: QueryResp<PropAttrs> = { features: [] };
      const geoms = (lots.features ?? [])
        .map((f) => (f.geometry ? esriToGeoJSON(f.geometry) : null))
        .filter(Boolean) as Array<Polygon | MultiPolygon>;
      if (geoms.length) {
        const xs = geoms.flatMap((g) =>
          (g.type === "Polygon" ? g.coordinates[0]! : g.coordinates.flatMap((p) => p[0]!)).map((c) => c[0]!),
        );
        const ys = geoms.flatMap((g) =>
          (g.type === "Polygon" ? g.coordinates[0]! : g.coordinates.flatMap((p) => p[0]!)).map((c) => c[1]!),
        );
        const propUrl = buildUrl(`${NSW_CADASTRE_BASE}/12/query`, {
          where: "principaladdresstype=1",
          geometry: `${Math.min(...xs)},${Math.min(...ys)},${Math.max(...xs)},${Math.max(...ys)}`,
          geometryType: "esriGeometryEnvelope",
          inSR: 4326,
          spatialRel: "esriSpatialRelIntersects",
          outFields: "address,propid",
          returnGeometry: true,
          outSR: 4326,
          f: "json",
        });
        props = await fetchJson<QueryResp<PropAttrs>>(propUrl, {
          service: "nsw-cadastre-props-by-id",
          ttlMs: 5 * 60 * 1000,
        }).catch(() => ({ features: [] }));
      }
      const propertyPolys = (props.features ?? [])
        .map((f) => {
          const g = f.geometry ? esriToGeoJSON(f.geometry) : null;
          return g ? { address: f.attributes.address, geom: { type: "Feature" as const, properties: {}, geometry: g } } : null;
        })
        .filter(Boolean) as Array<{ address: string | null; geom: GeoJSON.Feature<Polygon | MultiPolygon> }>;

      const retrievedAt = new Date().toISOString();
      for (const f of lots.features ?? []) {
        const a = f.attributes;
        const geometry = f.geometry ? esriToGeoJSON(f.geometry) : null;
        if (!geometry) continue;
        const feature = { type: "Feature" as const, properties: {}, geometry };
        const inside = pointOnFeature(feature);
        const c = centroid(feature).geometry.coordinates as [number, number];
        const match = propertyPolys.find((p) => booleanPointInPolygon(inside, p.geom));
        const { address, suburb } = splitNswAddress(match?.address ?? null);
        const id = `nsw-cadid:${a.cadid}`;
        byId.set(id, {
          externalParcelId: id,
          source: "LIVE_NSW",
          lot: a.lotnumber,
          section: a.sectionnumber,
          dp: a.planlabel,
          lotIdString: a.lotidstring,
          address,
          suburb,
          geometry,
          centroid: c,
          areaSqm: Math.round(a.planlotarea && a.planlotarea > 0 ? a.planlotarea : area(feature)),
          isStrata: !!a.planlabel && a.planlabel.startsWith("SP"),
          planning: null,
          planningStatus: "unavailable",
          retrievedAt,
        });
      }
    } catch {
      // Leave missing ids absent — caller surfaces the gap.
    }
  }

  const ordered = ids.map((id) => byId.get(id)).filter(Boolean) as ParcelData[];
  if (opts.skipPlanning || !ordered.length) return ordered;

  try {
    if (process.env.SA_FORCE_PLANNING_FAIL === "1") {
      throw new Error("Live NSW Planning did not respond");
    }
    const lngs = ordered.map((p) => p.centroid[0]);
    const lats = ordered.map((p) => p.centroid[1]);
    const bbox: BBox = {
      west: Math.min(...lngs),
      east: Math.max(...lngs),
      south: Math.min(...lats),
      north: Math.max(...lats),
    };
    const controls = await withBudget(18_000, "NSW Planning", (signal) =>
      nswPlanningProvider.getControlsForParcels(
        bbox,
        ordered.map((p) => ({ id: p.externalParcelId, geometry: p.geometry })),
        { signal },
      ),
    );
    const retrievedAt = new Date().toISOString();
    const withLive = ordered.map((p) => {
      const live = controls.get(p.externalParcelId);
      if (!live) return p;
      const merged = mergePlanningControls(previousById.get(p.externalParcelId), live);
      return {
        ...p,
        planning: merged,
        planningStatus: "ok" as const,
        retrievedAt: latestSourceRetrievedAt(merged) ?? retrievedAt,
      };
    });
    await persistLivePlanning(
      withLive.map((p) => ({
        externalParcelId: p.externalParcelId,
        planning: p.planning,
        previous: previousById.get(p.externalParcelId) ?? null,
        retrievedAt: p.retrievedAt,
      })),
    );
    return withLive;
  } catch {
    return ordered.map((p) => {
      if (p.planning) {
        return {
          ...p,
          planningStatus: "cached" as const,
          planningMessage: `Stored official planning (${p.retrievedAt.slice(0, 10)}) — live NSW Planning did not respond.`,
        };
      }
      return {
        ...p,
        planningStatus: "unavailable" as const,
        planningMessage: "Planning not loaded. Retry to fetch live NSW controls.",
      };
    });
  }
}

/**
 * Exact-ID hydrate for INDEX_CANDIDATE: DB first, then NSW cadastre by cadid only,
 * then persist so the next Today → Map is DB-only. Never bbox/LMR/scanArea.
 */
export async function hydrateExactParcelsForIndexCandidate(
  externalParcelIds: string[],
): Promise<{ parcels: ParcelData[]; hydratedFromCadastre: boolean }> {
  const { capParcelIds, parcelsMissingDrawableGeometry } = await import("@/lib/index-candidate-geometry");
  const { upsertParcel } = await import("@/lib/opportunity-service");
  const ids = capParcelIds(externalParcelIds);
  if (!ids.length) return { parcels: [], hydratedFromCadastre: false };

  let parcels = await getStoredParcelsByExternalIds(ids);
  const missing = parcelsMissingDrawableGeometry(ids, parcels);
  let hydratedFromCadastre = false;

  if (missing.length) {
    try {
      const live = await getParcelsByExternalIds(missing, { skipPlanning: true });
      if (live.length) {
        hydratedFromCadastre = true;
        await prisma.$transaction(async (tx) => {
          for (const p of live) {
            if (!p.geometry) continue;
            await upsertParcel(tx, p);
          }
        });
        parcels = await getStoredParcelsByExternalIds(ids);
        if (!parcels.length) parcels = live.filter((p) => !!p.geometry);
        else {
          const byId = new Map(parcels.map((p) => [p.externalParcelId, p]));
          for (const p of live) {
            if (p.geometry && !byId.get(p.externalParcelId)?.geometry) byId.set(p.externalParcelId, p);
          }
          parcels = ids.map((id) => byId.get(id)).filter(Boolean) as ParcelData[];
        }
      }
    } catch {
      // Cadastre unavailable — return whatever was already in DB.
    }
  }

  return {
    parcels: parcels.filter((p) => !!p.geometry),
    hydratedFromCadastre,
  };
}

/** Refresh live planning for specific stored parcels (Planning tab "Retry"/"Refresh"). */
export async function refreshPlanningForParcels(rows: Parcel[]) {
  if (!rows.length) return new Map<string, PlanningControls>();
  const lngs = rows.map((r) => r.centroidLng);
  const lats = rows.map((r) => r.centroidLat);
  const bbox: BBox = { west: Math.min(...lngs), east: Math.max(...lngs), south: Math.min(...lats), north: Math.max(...lats) };
  return nswPlanningProvider.getControlsForParcels(
    bbox,
    rows.map((r) => ({
      id: r.externalParcelId,
      geometry: r.geometry as unknown as Polygon | MultiPolygon,
    })),
  );
}
