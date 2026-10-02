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
