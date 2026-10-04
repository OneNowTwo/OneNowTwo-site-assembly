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
  const zone = included.find((l) => l.zone)?.zone ?? null;

  const snap = input.inputs.pathwaySnapshot;
  const band = bandFromPersisted(snap?.lmrBand, snap?.nearestDistanceM ?? null);
  const inferredPathwayHeight = snap?.modelledHeightM ?? inferStatePathwayHeightM(zone, band);
  const lepFsr = snap?.lepFsr ?? (anyUnmapped && officialFsr <= 0 ? null : officialFsr > 0 ? officialFsr : null);

  let fsrSource: PlanningFsrSource;
  let yieldStatus: PlanningYieldStatus;
  let effectiveFsr: number;
  let effectiveHeightM: number | null;
  let statePathwayFsr: number | null;
  let statePathwayName: string | null;

  if (input.inputs.fsrOverride != null) {
    const fromScan = input.inputs.fsrOverrideKind === "SCAN_MODELLED";
    fsrSource = fromScan ? "STATE_PATHWAY" : "OVERRIDE";
    yieldStatus = "CALCULABLE";
    effectiveFsr = input.inputs.fsrOverride;
    statePathwayFsr = snap?.statePathwayFsr ?? (fromScan ? input.inputs.fsrOverride : null);
    statePathwayName =
      snap?.statePathwayName ?? (fromScan ? "Low & Mid-Rise Housing (Housing SEPP)" : null);
    effectiveHeightM = fromScan
      ? (input.inputs.heightOverrideM ?? inferredPathwayHeight ?? lepHeightM)
      : (input.inputs.heightOverrideM ?? lepHeightM);
  } else if (anyUnmapped && officialFsr <= 0) {
    fsrSource = "NO_MAPPED";
    yieldStatus = "REQUIRES_PLANNING_INPUT";
    effectiveFsr = 0;
    statePathwayFsr = snap?.statePathwayFsr ?? null;
    statePathwayName = snap?.statePathwayName ?? null;
    effectiveHeightM = input.inputs.heightOverrideM ?? lepHeightM;
  } else {
    fsrSource = "OFFICIAL";
    yieldStatus = "CALCULABLE";
    effectiveFsr = officialFsr;
    statePathwayFsr = null;
    statePathwayName = null;
    effectiveHeightM = input.inputs.heightOverrideM ?? lepHeightM;
  }

  const site: PlanningSiteBasis = {
    siteAreaSqm: input.inputs.siteAreaOverride ?? parcelArea,
    fsr: effectiveFsr,
    fsrSource,
    yieldStatus,
    lepFsr,
    statePathwayFsr,
    statePathwayName,
    lmrCentreName: snap?.lmrCentre ?? null,
    lmrNearestDistanceM: snap?.nearestDistanceM ?? null,
    lmrFurthestDistanceM: snap?.furthestDistanceM ?? null,
    lmrProximityLabel: snap?.proximityLabel ?? (fsrSource === "STATE_PATHWAY" ? "PASS — ESTIMATED" : null),
    heightLimitM: effectiveHeightM,
  };

  return buildPlanningSnapshot({
    lots: input.lots,
    site,
    statePathwayHeightM: fsrSource === "STATE_PATHWAY" ? (inferredPathwayHeight ?? effectiveHeightM) : null,
    pendingChanges: input.pendingChanges,
    pendingChangesCheckedAt: input.pendingChangesCheckedAt,
    pendingChangesSource: input.pendingChangesSource,
    checkedAt: input.checkedAt,
  });
}
