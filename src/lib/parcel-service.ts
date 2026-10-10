import type { Polygon, MultiPolygon } from "geojson";
import { prisma } from "@/lib/db";
import type { BBox, FsrControl, FsrMappedStatus, ParcelData, PlanningControls } from "@/lib/types";
import { clampBBox, nswCadastreProvider } from "@/lib/data-sources/nsw-cadastre";
import { nswPlanningProvider } from "@/lib/data-sources/nsw-planning";
import { UpstreamError } from "@/lib/data-sources/http";
import type { Parcel } from "@/generated/prisma/client";

export interface ParcelQueryResult {
  parcels: ParcelData[];
  cadastreStatus: "live" | "cached" | "unavailable";
  planningStatus: "live" | "partial" | "cached" | "unavailable";
  messages: string[];
  bbox: BBox;
}

function planningFromRow(row: Parcel): PlanningControls | null {
  if (row.planningCheckedAt == null) return null;
  return {
    zone: row.zone,
    zoneName: row.zoneName,
    fsr: row.fsr,
    fsrStatus: (row.fsr != null ? "MAPPED" : "NO_MAPPED") as FsrMappedStatus,
    fsrControls: [] as FsrControl[],
    heightM: row.heightM,
    minLotSizeSqm: row.minLotSizeSqm,
    heritage: row.heritage,
    planningInstrument: row.planningInstrument,
    lga: row.lga,
    sources: {},
  };
}

export function parcelFromRow(row: Parcel): ParcelData {
  const planning = planningFromRow(row);
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
    retrievedAt: (row.planningCheckedAt ?? row.updatedAt).toISOString(),
  };
}

async function storedParcelsInBBox(b: BBox) {
  return prisma.parcel.findMany({
    where: {
      centroidLng: { gte: b.west, lte: b.east },
      centroidLat: { gte: b.south, lte: b.north },
    },
    take: 2000,
  });
}

/** Real NSW lots + planning for a map viewport. Falls back to previously stored NSW data when a service is down. */
export async function getParcelsForBBox(input: BBox): Promise<ParcelQueryResult> {
  const bbox = clampBBox(input);
  const messages: string[] = [];
  const cadastreStatus: ParcelQueryResult["cadastreStatus"] = "live";
  let base: Omit<ParcelData, "planning" | "planningStatus">[];
  let stored: Parcel[] | null = null;

  try {
    base = await nswCadastreProvider.getParcelsInBBox(bbox);
  } catch (err) {
    stored = await storedParcelsInBBox(bbox);
    const msg = err instanceof UpstreamError ? err.message : "Cadastre service error";
    if (!stored.length) {
      return { parcels: [], cadastreStatus: "unavailable", planningStatus: "unavailable", messages: [`Cadastre service temporarily unavailable (${msg}).`], bbox };
    }
    messages.push(`Cadastre service temporarily unavailable (${msg}). Showing ${stored.length} previously saved NSW parcels.`);
    return { parcels: stored.map(parcelFromRow), cadastreStatus: "cached", planningStatus: "cached", messages, bbox };
  }

  let planningStatus: ParcelQueryResult["planningStatus"] = "live";
  let controls = new Map<string, PlanningControls>();
  try {
    // Pass REAL parcel geometries so FSR is intersected against the official EPI layer.
    controls = await nswPlanningProvider.getControlsForParcels(
      bbox,
      base.map((p) => ({ id: p.externalParcelId, geometry: p.geometry })),
    );
    const sample = controls.values().next().value as PlanningControls | undefined;
    if (sample && Object.keys(sample.sources).length < 5) {
      planningStatus = "partial";
      messages.push("Some planning layers did not respond; missing fields are shown as unavailable.");
    }
  } catch (err) {
    planningStatus = "unavailable";
    messages.push(`Planning service temporarily unavailable (${err instanceof Error ? err.message : "error"}).`);
    stored = await storedParcelsInBBox(bbox);
  }
  const storedById = new Map((stored ?? []).map((r) => [r.externalParcelId, r]));

  const parcels: ParcelData[] = base.map((p) => {
    const live = controls.get(p.externalParcelId);
    if (live) return { ...p, planning: live, planningStatus: Object.keys(live.sources).length < 5 ? "partial" : "ok" };
    const row = storedById.get(p.externalParcelId);
    if (row?.planningCheckedAt) {
      const cached = parcelFromRow(row);
      return { ...p, planning: cached.planning, planningStatus: "partial", planningMessage: `Planning from saved snapshot (${row.planningCheckedAt.toISOString().slice(0, 10)})` };
    }
    return { ...p, planning: null, planningStatus: "unavailable", planningMessage: "Planning service temporarily unavailable." };
  });

  return { parcels, cadastreStatus, planningStatus, messages, bbox };
}

/**
 * Load parcels by external ids (nsw-cadid:N).
 * Prefers stored rows; hydrates missing lots from NSW cadastre by cadid.
 */
export async function getParcelsByExternalIds(externalParcelIds: string[]): Promise<ParcelData[]> {
  const ids = [...new Set(externalParcelIds.filter((id) => /^nsw-cadid:\d+$/.test(id)))];
  if (!ids.length) return [];

  const stored = await prisma.parcel.findMany({ where: { externalParcelId: { in: ids } } });
  const byId = new Map(stored.map((r) => [r.externalParcelId, parcelFromRow(r)]));
  const missing = ids.filter((id) => !byId.has(id));

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
      // Property addresses via spatial match per lot bbox envelope of all lots
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

  // Attach planning where possible
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean) as ParcelData[];
  if (ordered.length) {
    try {
      const lngs = ordered.map((p) => p.centroid[0]);
      const lats = ordered.map((p) => p.centroid[1]);
      const bbox: BBox = {
        west: Math.min(...lngs),
        east: Math.max(...lngs),
        south: Math.min(...lats),
        north: Math.max(...lats),
      };
      const controls = await nswPlanningProvider.getControlsForParcels(
        bbox,
        ordered.map((p) => ({ id: p.externalParcelId, geometry: p.geometry })),
      );
      return ordered.map((p) => {
        const live = controls.get(p.externalParcelId);
        return live
          ? { ...p, planning: live, planningStatus: "ok" as const }
          : p;
      });
    } catch {
      return ordered;
    }
  }
  return ordered;
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
