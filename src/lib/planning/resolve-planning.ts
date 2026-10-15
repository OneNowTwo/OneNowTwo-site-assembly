/**
 * Canonical planning resolution.
 *
 * ONE function → ONE PlanningSnapshot. UI and calculations must not re-infer
 * LEP / State pathway / effective FSR / height from any other source.
 *
 * Does not change planning rules — consolidates OpportunityInputs
 * (pathwaySnapshot / SCAN_MODELLED / USER) + lot statutory fields.
 */
import type { OpportunityInputs } from "@/lib/analysis/assumptions";
import { officialParcelTheoreticalGfa } from "@/lib/analysis/assembly";
import { lmrRfbStandardForZone, type LmrBand } from "@/lib/data-sources/housing-sepp-lmr";
import {
  buildPlanningSnapshot,
  inferStatePathwayHeightM,
  proximityBandFromDistanceM,
  type PlanningFsrSource,
  type PlanningSiteBasis,
  type PlanningSnapshot,
  type PlanningSnapshotLotInput,
  type PlanningYieldStatus,
  type ProximityBandLabel,
} from "@/lib/planning/planning-snapshot";

export interface ResolvePlanningInput {
  lots: PlanningSnapshotLotInput[];
  inputs: OpportunityInputs;
  pendingChanges?: PlanningSnapshot["proposedPendingChanges"];
  pendingChangesCheckedAt?: string | null;
  pendingChangesSource?: string;
  checkedAt?: string;
}

function bandFromPersisted(lmrBand: string | null | undefined, nearestM: number | null | undefined): ProximityBandLabel {
  if (lmrBand === "INNER_0_400" || lmrBand === "OUTER_400_800" || lmrBand === "OUTSIDE") {
    return lmrBand;
  }
  return proximityBandFromDistanceM(nearestM);
}

/**
 * Resolve the single PlanningSnapshot for an assembly.
 * Unmapped LEP FSR stays null — never coerced to 0.0 for display.
 */
export function resolvePlanning(input: ResolvePlanningInput): PlanningSnapshot {
  const included = input.lots.filter((l) => l.included);
  const parcelArea = included.reduce((s, l) => s + l.areaSqm, 0);
  const gfaAtControls = included.reduce(
    (s, l) => s + officialParcelTheoreticalGfa({ areaSqm: l.areaSqm, fsr: l.fsr, fsrControls: null }),
    0,
  );
  const anyUnmapped = included.some((l) => l.fsr == null);
  const officialFsr = parcelArea > 0 ? gfaAtControls / parcelArea : 0;
  const lepHeights = included.map((l) => l.heightM).filter((h): h is number => h != null);
  const lepHeightM = lepHeights.length ? Math.min(...lepHeights) : null;
  const indexSnap = input.inputs.indexPlanningSnapshot;
  // Precedence for known facts: live parcel → stored official index → unknown.
  // Never erase a stored official zone merely because Planning Portal is down.
  const zone = included.find((l) => l.zone)?.zone ?? indexSnap?.zone ?? null;

  const snap = input.inputs.pathwaySnapshot;
  const band = bandFromPersisted(snap?.lmrBand, snap?.nearestDistanceM ?? null);
  // Band+zone standard wins over stale persisted modelledHeightM (e.g. outer 17.5 left after inner screen).
  const bandHeight = inferStatePathwayHeightM(zone, band);
  const inferredPathwayHeight = bandHeight ?? snap?.modelledHeightM ?? null;
  const lepFsr = snap?.lepFsr ?? (anyUnmapped && officialFsr <= 0 ? null : officialFsr > 0 ? officialFsr : null);

  let fsrSource: PlanningFsrSource;
  let yieldStatus: PlanningYieldStatus;
  let effectiveFsr: number;
  let effectiveHeightM: number | null;
  let statePathwayFsr: number | null;
  let statePathwayName: string | null;

  const indexCurrentFsr =
    indexSnap?.currentFsr != null && indexSnap.currentFsr > 0 ? indexSnap.currentFsr : null;
  const indexHeightM =
    indexSnap?.heightM != null && indexSnap.heightM > 0
      ? indexSnap.heightM
      : indexSnap?.proposedHeightM != null && indexSnap.proposedHeightM > 0
        ? indexSnap.proposedHeightM
        : null;

  if (input.inputs.fsrOverride != null) {
    const fromScan = input.inputs.fsrOverrideKind === "SCAN_MODELLED";
    fsrSource = fromScan ? "STATE_PATHWAY" : "OVERRIDE";
    yieldStatus = "CALCULABLE";
    statePathwayName =
      snap?.statePathwayName ?? (fromScan ? "Low & Mid-Rise Housing (Housing SEPP)" : null);

    if (fromScan) {
      // De-authorise stale SCAN_MODELLED numbers when persisted proximity+zone imply a
      // different current LMR standard (e.g. outer 1.5/17.5 left behind after inner 2.2/22).
      const bandForStd = band === "UNKNOWN" ? "OUTSIDE" : (band as LmrBand);
      const std = lmrRfbStandardForZone(zone, bandForStd);
      const fromProximityFsr = std.applicable ? std.fsr : null;
      const fromProximityHeight = std.applicable ? std.heightM : null;
      statePathwayFsr = fromProximityFsr ?? snap?.statePathwayFsr ?? input.inputs.fsrOverride;
      effectiveFsr = statePathwayFsr;
      effectiveHeightM =
        fromProximityHeight ??
        input.inputs.heightOverrideM ??
        inferredPathwayHeight ??
        snap?.modelledHeightM ??
        lepHeightM;
    } else {
      effectiveFsr = input.inputs.fsrOverride;
      statePathwayFsr = snap?.statePathwayFsr ?? null;
      effectiveHeightM = input.inputs.heightOverrideM ?? lepHeightM;
    }
  } else if (!(anyUnmapped && officialFsr <= 0) && officialFsr > 0) {
    // 1. Parcel-level official LEP FSR when available.
    fsrSource = "OFFICIAL";
    yieldStatus = "CALCULABLE";
    effectiveFsr = officialFsr;
    statePathwayFsr = null;
    statePathwayName = null;
    effectiveHeightM = input.inputs.heightOverrideM ?? lepHeightM ?? indexHeightM;
  } else if (indexCurrentFsr != null) {
    // 2. Persisted INDEX planning snapshot — fallback when live parcel planning is missing.
    // Never erase this merely because Planning Portal failed at Analyse time.
    fsrSource = "INDEX_SNAPSHOT";
    yieldStatus = "CALCULABLE";
    effectiveFsr = indexCurrentFsr;
    statePathwayFsr = snap?.statePathwayFsr ?? null;
    statePathwayName = snap?.statePathwayName ?? null;
    effectiveHeightM = input.inputs.heightOverrideM ?? lepHeightM ?? indexHeightM;
  } else if (anyUnmapped && officialFsr <= 0) {
    // 3. No usable FSR — planning required (never coerce to a real 0 economics path).
    fsrSource = "NO_MAPPED";
    yieldStatus = "REQUIRES_PLANNING_INPUT";
    effectiveFsr = 0;
    statePathwayFsr = snap?.statePathwayFsr ?? null;
    statePathwayName = snap?.statePathwayName ?? null;
    effectiveHeightM = input.inputs.heightOverrideM ?? lepHeightM ?? indexHeightM;
  } else {
    fsrSource = "OFFICIAL";
    yieldStatus = "CALCULABLE";
    effectiveFsr = officialFsr;
    statePathwayFsr = null;
    statePathwayName = null;
    effectiveHeightM = input.inputs.heightOverrideM ?? lepHeightM ?? indexHeightM;
  }

  // When INDEX snapshot supplies LEP base, surface it as lepFsr for statutory display.
  const resolvedLepFsr =
    fsrSource === "INDEX_SNAPSHOT" ? indexCurrentFsr : lepFsr;

  const site: PlanningSiteBasis = {
    siteAreaSqm: input.inputs.siteAreaOverride ?? parcelArea,
    fsr: effectiveFsr,
    fsrSource,
    yieldStatus,
    lepFsr: resolvedLepFsr,
    statePathwayFsr,
    statePathwayName,
    lmrCentreName: snap?.lmrCentre ?? null,
    lmrNearestDistanceM: snap?.nearestDistanceM ?? null,
    lmrFurthestDistanceM: snap?.furthestDistanceM ?? null,
    lmrProximityLabel: snap?.proximityLabel ?? (fsrSource === "STATE_PATHWAY" ? "PASS — ESTIMATED" : null),
    heightLimitM: effectiveHeightM,
  };

  // Seed blank lot statutory fields from stored official index — never wipe known facts on outage.
  const lotsForSnapshot = input.lots.map((l) => {
    if (!indexSnap) return l;
    return {
      ...l,
      zone: l.zone ?? indexSnap.zone ?? null,
      zoneName: l.zoneName ?? indexSnap.zoneName ?? null,
      fsr: l.fsr ?? (indexSnap.currentFsr != null && indexSnap.currentFsr > 0 ? indexSnap.currentFsr : null),
      heightM: l.heightM ?? indexHeightM,
      minLotSizeSqm: l.minLotSizeSqm ?? indexSnap.minLotSizeSqm ?? null,
      heritage: l.heritage ?? indexSnap.heritage ?? null,
      planningInstrument: l.planningInstrument ?? indexSnap.lepName ?? null,
      planningCheckedAt: l.planningCheckedAt ?? indexSnap.indexedAt ?? null,
    };
  });

  return buildPlanningSnapshot({
    lots: lotsForSnapshot,
    site,
    statePathwayHeightM: fsrSource === "STATE_PATHWAY" ? (inferredPathwayHeight ?? effectiveHeightM) : null,
    pendingChanges: input.pendingChanges,
    pendingChangesCheckedAt: input.pendingChangesCheckedAt,
    pendingChangesSource: input.pendingChangesSource,
    checkedAt: input.checkedAt ?? indexSnap?.indexedAt ?? undefined,
  });
}
