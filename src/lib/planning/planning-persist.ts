/**
 * Merge / restore helpers for parcel planning evidence.
 * Successful layer lookups (source present) stay distinguishable from failed layers
 * (source absent) — including successful "no mapped control" (null value + source).
 */

import type { FsrControl, FsrMappedStatus, FieldSource, PlanningControls } from "@/lib/types";

export type PlanningFieldKey = "zone" | "fsr" | "heightM" | "minLotSizeSqm" | "heritage";

const FIELD_KEYS: PlanningFieldKey[] = ["zone", "fsr", "heightM", "minLotSizeSqm", "heritage"];

export function emptyPlanningControls(): PlanningControls {
  return {
    zone: null,
    zoneName: null,
    fsr: null,
    fsrStatus: "UNAVAILABLE",
    fsrControls: [],
    heightM: null,
    minLotSizeSqm: null,
    heritage: null,
    planningInstrument: null,
    lga: null,
    sources: {},
  };
}

/** True when the live response successfully retrieved this layer (even if value is null / NO_MAPPED). */
export function layerSucceeded(live: PlanningControls, field: PlanningFieldKey): boolean {
  return live.sources[field] != null;
}

/**
 * Reconstruct PlanningControls from a stored PlanningSnapshot.data JSON,
 * falling back to denormalised Parcel columns only when snapshot is missing.
 */
export function planningControlsFromSnapshot(
  snapData: unknown,
  row?: {
    zone: string | null;
    zoneName: string | null;
    fsr: number | null;
    heightM: number | null;
    minLotSizeSqm: number | null;
    heritage: string | null;
    planningInstrument: string | null;
    lga: string | null;
    planningCheckedAt: Date | string | null;
  } | null,
): PlanningControls | null {
  const r = snapData && typeof snapData === "object" && !Array.isArray(snapData) ? (snapData as Record<string, unknown>) : null;
  if (r && (r.sources || r.fsrStatus || r.fsrControls || r.zone != null || r.fsr != null || r.heightM != null)) {
    const sources = (r.sources ?? {}) as PlanningControls["sources"];
    const fsrStatus = (typeof r.fsrStatus === "string" ? r.fsrStatus : null) as FsrMappedStatus | null;
    const fsrControls = Array.isArray(r.fsrControls) ? (r.fsrControls as FsrControl[]) : [];
    const fsr = typeof r.fsr === "number" ? r.fsr : r.fsr == null ? null : Number(r.fsr);
    return {
      zone: typeof r.zone === "string" ? r.zone : r.zone == null ? null : String(r.zone),
      zoneName: typeof r.zoneName === "string" ? r.zoneName : null,
      fsr: Number.isFinite(fsr as number) ? (fsr as number) : null,
      fsrStatus:
        fsrStatus ??
        (sources.fsr
          ? fsr != null
            ? "MAPPED"
            : "NO_MAPPED"
          : "UNAVAILABLE"),
      fsrControls,
      heightM: typeof r.heightM === "number" ? r.heightM : r.heightM == null ? null : Number(r.heightM),
      minLotSizeSqm:
        typeof r.minLotSizeSqm === "number" ? r.minLotSizeSqm : r.minLotSizeSqm == null ? null : Number(r.minLotSizeSqm),
      heritage: typeof r.heritage === "string" ? r.heritage : null,
      planningInstrument: typeof r.planningInstrument === "string" ? r.planningInstrument : null,
      lga: typeof r.lga === "string" ? r.lga : null,
      sources,
    };
  }
  if (!row?.planningCheckedAt) return null;
  // Legacy rows without snapshot evidence — cannot invent sources or FSR polygons.
  return {
    zone: row.zone,
    zoneName: row.zoneName,
    fsr: row.fsr,
    fsrStatus: row.fsr != null ? "MAPPED" : "NO_MAPPED",
    fsrControls: [],
    heightM: row.heightM,
    minLotSizeSqm: row.minLotSizeSqm,
    heritage: row.heritage,
    planningInstrument: row.planningInstrument,
    lga: row.lga,
    sources: {},
  };
}

/**
 * Merge live planning into previously verified controls.
 * Only overwrite fields whose live response includes a source (layer succeeded).
 * Preserve previous values + FieldSource.retrievedAt for failed layers.
 */
export function mergePlanningControls(
  previous: PlanningControls | null | undefined,
  live: PlanningControls,
): PlanningControls {
  const prev = previous ?? emptyPlanningControls();
  const merged: PlanningControls = {
    zone: prev.zone,
    zoneName: prev.zoneName,
    fsr: prev.fsr,
    fsrStatus: prev.fsrStatus,
    fsrControls: prev.fsrControls ?? [],
    heightM: prev.heightM,
    minLotSizeSqm: prev.minLotSizeSqm,
    heritage: prev.heritage,
    planningInstrument: prev.planningInstrument,
    lga: prev.lga,
    sources: { ...prev.sources },
  };

  if (layerSucceeded(live, "zone")) {
    merged.zone = live.zone;
    merged.zoneName = live.zoneName;
    merged.sources.zone = live.sources.zone;
  }
  if (layerSucceeded(live, "fsr")) {
    merged.fsr = live.fsr;
    merged.fsrStatus = live.fsrStatus;
    merged.fsrControls = live.fsrControls ?? [];
    merged.sources.fsr = live.sources.fsr;
  }
  if (layerSucceeded(live, "heightM")) {
    merged.heightM = live.heightM;
    merged.sources.heightM = live.sources.heightM;
  }
  if (layerSucceeded(live, "minLotSizeSqm")) {
    merged.minLotSizeSqm = live.minLotSizeSqm;
    merged.sources.minLotSizeSqm = live.sources.minLotSizeSqm;
  }
  if (layerSucceeded(live, "heritage")) {
    merged.heritage = live.heritage;
    merged.sources.heritage = live.sources.heritage;
  }

  // Instrument / LGA: update when any spatial layer succeeded this round.
  if (FIELD_KEYS.some((k) => layerSucceeded(live, k))) {
    if (live.planningInstrument) merged.planningInstrument = live.planningInstrument;
    if (live.lga) merged.lga = live.lga;
  }

  return merged;
}

/** Earliest successful field retrieval timestamp in sources (ISO), else null. */
export function earliestSourceRetrievedAt(controls: PlanningControls | null | undefined): string | null {
  if (!controls?.sources) return null;
  let earliest: string | null = null;
  for (const src of Object.values(controls.sources) as Array<FieldSource | undefined>) {
    if (!src?.retrievedAt) continue;
    if (!earliest || src.retrievedAt < earliest) earliest = src.retrievedAt;
  }
  return earliest;
}

/** Latest successful field retrieval timestamp in sources (ISO), else null. */
export function latestSourceRetrievedAt(controls: PlanningControls | null | undefined): string | null {
  if (!controls?.sources) return null;
  let latest: string | null = null;
  for (const src of Object.values(controls.sources) as Array<FieldSource | undefined>) {
    if (!src?.retrievedAt) continue;
    if (!latest || src.retrievedAt > latest) latest = src.retrievedAt;
  }
  return latest;
}

/** Parcel column patch: only write fields that succeeded on this live response. */
export function parcelColumnsFromMerged(
  previousRow: {
    zone: string | null;
    zoneName: string | null;
    fsr: number | null;
    heightM: number | null;
    minLotSizeSqm: number | null;
    heritage: string | null;
    planningInstrument: string | null;
    lga: string | null;
  },
  live: PlanningControls,
  merged: PlanningControls,
  retrievedAt: Date,
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    planningCheckedAt: retrievedAt,
  };
  // Always write the merged (successful + preserved) denormalised columns.
  data.zone = merged.zone;
  data.zoneName = merged.zoneName;
  data.fsr = merged.fsr;
  data.heightM = merged.heightM;
  data.minLotSizeSqm = merged.minLotSizeSqm;
  data.heritage = merged.heritage;
  data.planningInstrument = merged.planningInstrument ?? previousRow.planningInstrument;
  data.lga = merged.lga ?? previousRow.lga;
  // Silence unused live lint when callers only need merged columns.
  void live;
  return data;
}
