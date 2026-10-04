import { lmrBandFromDistanceM, type LmrBand } from "@/lib/data-sources/housing-sepp-lmr";
import type { PlanningChangeRecord } from "@/lib/planning/types";

export type ProximityBandLabel = "INNER_0_400" | "OUTER_400_800" | "OUTSIDE" | "UNKNOWN";
export type PlanningFsrSource = "OFFICIAL" | "NO_MAPPED" | "OVERRIDE" | "STATE_PATHWAY";
export type PlanningYieldStatus = "CALCULABLE" | "REQUIRES_PLANNING_INPUT";

/** Minimal site controls fed into PlanningSnapshot — not a second planning authority. */
export interface PlanningSiteBasis {
  siteAreaSqm: number;
  fsr: number;
  fsrSource: PlanningFsrSource;
  yieldStatus: PlanningYieldStatus;
  lepFsr: number | null;
  statePathwayFsr: number | null;
  statePathwayName: string | null;
  lmrCentreName: string | null;
  lmrNearestDistanceM: number | null;
  lmrFurthestDistanceM: number | null;
  lmrProximityLabel: string | null;
  heightLimitM: number | null;
}

export interface PlanningLotRow {
  id: string;
  label: string;
  included: boolean;
  areaSqm: number;
  zone: string | null;
  zoneName: string | null;
  lepFsr: number | null;
  lepHeightM: number | null;
  minLotSizeSqm: number | null;
  heritage: string | null;
  planningInstrument: string | null;
  planningCheckedAt: string | null;
  statePathway: string | null;
  modelledFsr: number | null;
  modelledHeightM: number | null;
  planningStatus: string;
}

export interface PlanningStatePathwayCard {
  id: string;
  kind: "LMR" | "INFILL_AFFORDABLE_HOUSING" | "OTHER";
  title: string;
  status: string;
  policyStatus: "CURRENT_POLICY";
  zone: string | null;
  centre: string | null;
  proximityDistanceM: number | null;
  proximityDistanceMaxM: number | null;
  proximityBand: ProximityBandLabel;
  proximityBandLabel: string;
  stateFsr: number | null;
  stateHeightM: number | null;
  effectiveFsr: number | null;
  effectiveHeightM: number | null;
  summary: string;
  notes: string[];
}

export interface PlanningStatutorySummary {
  zone: string | null;
  zoneName: string | null;
  lepName: string | null;
  lepFsr: number | null;
  lepHeightM: number | null;
  minLotSizeSqm: number | null;
  heritage: string | null;
  otherConstraints: string[];
  source: string;
  retrievedAt: string | null;
}

export interface PlanningEffectiveControls {
  baseZone: string | null;
  baseFsr: number | null;
  baseHeightM: number | null;
  statePathway: string | null;
  proximityDistanceM: number | null;
  proximityDistanceMaxM: number | null;
  proximityBand: ProximityBandLabel;
  proximityBandLabel: string;
  stateFsr: number | null;
  stateHeightM: number | null;
  effectiveFsr: number | null;
  effectiveHeightM: number | null;
  status: string;
  source: string;
  fsrSource: PlanningFsrSource;
  yieldStatus: PlanningYieldStatus;
}

/** One coherent planning position for the whole Planning tab + financial model. */
export interface PlanningSnapshot {
  checkedAt: string;
  sources: string[];
  currentStatutoryControls: PlanningStatutorySummary;
  currentStatePathways: PlanningStatePathwayCard[];
  proposedPendingChanges: PlanningChangeRecord[];
  pendingChangesCheckedAt: string | null;
  pendingChangesSource: string;
  effectiveControls: PlanningEffectiveControls;
  lots: PlanningLotRow[];
}

export interface PlanningSnapshotLotInput {
  id: string;
  label: string;
  included: boolean;
  areaSqm: number;
  zone: string | null;
  zoneName: string | null;
  fsr: number | null;
  heightM: number | null;
  minLotSizeSqm: number | null;
  heritage: string | null;
  planningInstrument: string | null;
  planningCheckedAt: string | null;
}

function bandLabel(band: ProximityBandLabel): string {
  if (band === "INNER_0_400") return "INNER AREA SCREEN — 0–400m";
  if (band === "OUTER_400_800") return "OUTER AREA SCREEN — 400–800m";
  if (band === "OUTSIDE") return "OUTSIDE 800m SCREEN";
  return "UNKNOWN";
}

export function proximityBandFromDistanceM(distanceM: number | null | undefined): ProximityBandLabel {
  if (distanceM == null || !Number.isFinite(distanceM)) return "UNKNOWN";
  return lmrBandFromDistanceM(distanceM) as LmrBand;
}

/** Format LEP FSR for display — never "0.0:1" when unmapped. */
export function formatLepFsr(fsr: number | null | undefined): string {
  if (fsr == null || !(fsr > 0)) return "Not mapped";
  return `${fsr.toFixed(2)}:1`;
}

/**
 * Build the single PlanningSnapshot from the opportunity's resolved site basis
 * (same object Yield/Feasibility already use) plus lot statutory rows.
 * Pending changes are attached by the caller when available.
 */
export function buildPlanningSnapshot(input: {
  lots: PlanningSnapshotLotInput[];
  site: PlanningSiteBasis;
  /** Optional persisted pathway height when site.heightLimitM is the effective value. */
  statePathwayHeightM?: number | null;
  pendingChanges?: PlanningChangeRecord[];
  pendingChangesCheckedAt?: string | null;
  pendingChangesSource?: string;
  checkedAt?: string;
}): PlanningSnapshot {
  const included = input.lots.filter((l) => l.included);
  const zones = [...new Set(included.map((l) => l.zone).filter(Boolean))] as string[];
  const zoneNames = [...new Set(included.map((l) => l.zoneName).filter(Boolean))] as string[];
  const instruments = [...new Set(included.map((l) => l.planningInstrument).filter(Boolean))] as string[];
  const heritages = included.map((l) => l.heritage).filter((h) => h && h !== "None mapped" && h !== "Unknown");
  const lepHeights = included.map((l) => l.heightM).filter((h): h is number => h != null);
  const minLots = included.map((l) => l.minLotSizeSqm).filter((h): h is number => h != null);
  const anyLepFsr = included.some((l) => l.fsr != null && l.fsr > 0);
  const lepFsr = anyLepFsr ? input.site.lepFsr : null;
  const lepHeightM = lepHeights.length ? Math.min(...lepHeights) : null;
  const checkedAt =
    input.checkedAt ??
    included.map((l) => l.planningCheckedAt).filter(Boolean).sort().at(-1) ??
    new Date().toISOString();

  const nearest = input.site.lmrNearestDistanceM;
  const furthest = input.site.lmrFurthestDistanceM;
  const band = proximityBandFromDistanceM(nearest);
  const statePathwayActive = input.site.fsrSource === "STATE_PATHWAY";
  const stateFsr = statePathwayActive ? (input.site.statePathwayFsr ?? input.site.fsr) : input.site.statePathwayFsr;
  // Prefer explicit state pathway height; fall back to effective height when pathway is active.
  const stateHeightM =
    input.statePathwayHeightM ??
    (statePathwayActive ? input.site.heightLimitM : null);
  const effectiveFsr =
    input.site.yieldStatus === "CALCULABLE" && input.site.fsr > 0 ? input.site.fsr : statePathwayActive ? stateFsr : null;
  const effectiveHeightM = input.site.heightLimitM;

  const pathways: PlanningStatePathwayCard[] = [];
  if (statePathwayActive && (stateFsr != null || stateHeightM != null)) {
    pathways.push({
      id: "pathway:lmr",
      kind: "LMR",
      title: input.site.statePathwayName ?? "Low & Mid-Rise Housing (Housing SEPP)",
      status: "REQUIRES_PLANNING_CONFIRMATION",
      policyStatus: "CURRENT_POLICY",
      zone: zones[0] ?? null,
      centre: input.site.lmrCentreName,
      proximityDistanceM: nearest,
      proximityDistanceMaxM: furthest,
      proximityBand: band,
      proximityBandLabel: bandLabel(band),
      stateFsr: stateFsr ?? null,
      stateHeightM: stateHeightM ?? null,
      effectiveFsr: effectiveFsr ?? null,
      effectiveHeightM: effectiveHeightM ?? stateHeightM ?? null,
      summary:
        `LMR proximity ${input.site.lmrProximityLabel ?? "PASS — ESTIMATED"}` +
        (nearest != null
          ? ` · ${nearest}${furthest != null && furthest !== nearest ? `–${furthest}` : ""} m straight-line`
          : "") +
        (input.site.lmrCentreName ? ` to ${input.site.lmrCentreName}` : "") +
        ".",
      notes: [
        "ESTIMATED ELIGIBILITY — VERIFY BEFORE ACQUISITION / DA",
        "CURRENT POLICY — REQUIRES PLANNING CONFIRMATION",
      ],
    });
  }

  // Candidate AH pathway note when residential zones are present (not driving yield unless selected).
  if (zones.some((z) => /^R[1-4]$/.test(z))) {
    pathways.push({
      id: "pathway:infill-ah",
      kind: "INFILL_AFFORDABLE_HOUSING",
      title: "In-fill affordable housing (Housing SEPP)",
      status: "REQUIRES_PLANNING_CONFIRMATION",
      policyStatus: "CURRENT_POLICY",
      zone: zones[0] ?? null,
      centre: null,
      proximityDistanceM: null,
      proximityDistanceMaxM: null,
      proximityBand: "UNKNOWN",
      proximityBandLabel: "Eligibility not assessed in this snapshot",
      stateFsr: null,
      stateHeightM: null,
      effectiveFsr: null,
      effectiveHeightM: null,
      summary:
        "Potential +20–30% FSR/height where ~10–15% GFA is affordable housing. Candidate pathway only — not automatically stacked onto LMR.",
      notes: [
        "CURRENT POLICY — SUBJECT TO ELIGIBILITY",
        "Do not stack LMR + AH automatically unless legislation permits for this site",
      ],
    });
  }

  const lotRows: PlanningLotRow[] = input.lots.map((l) => ({
    id: l.id,
    label: l.label,
    included: l.included,
    areaSqm: l.areaSqm,
    zone: l.zone,
    zoneName: l.zoneName,
    lepFsr: l.fsr != null && l.fsr > 0 ? l.fsr : null,
    lepHeightM: l.heightM,
    minLotSizeSqm: l.minLotSizeSqm,
    heritage: l.heritage,
    planningInstrument: l.planningInstrument,
    planningCheckedAt: l.planningCheckedAt,
    statePathway: statePathwayActive ? "LMR" : null,
    modelledFsr: l.included ? effectiveFsr : null,
    modelledHeightM: l.included ? effectiveHeightM : null,
    planningStatus: statePathwayActive
      ? "Requires confirmation"
      : l.fsr == null
        ? "USER FSR REQUIRED if no State pathway"
        : "LEP controls",
  }));

  return {
    checkedAt,
    sources: [
      "NSW Planning Portal — EPI Primary Planning Layers",
      ...(statePathwayActive ? ["State Environmental Planning Policy (Housing) 2021 — Low and Mid-Rise Housing"] : []),
    ],
    currentStatutoryControls: {
      zone: zones[0] ?? null,
      zoneName: zoneNames[0] ?? null,
      lepName: instruments[0] ?? null,
      lepFsr,
      lepHeightM,
      minLotSizeSqm: minLots.length ? Math.max(...minLots) : null,
      heritage: heritages.length ? [...new Set(heritages)].join("; ") : "None mapped",
      otherConstraints: [],
      source: "NSW Planning Portal / applicable EPI",
      retrievedAt: checkedAt,
    },
    currentStatePathways: pathways,
    proposedPendingChanges: input.pendingChanges ?? [],
    pendingChangesCheckedAt: input.pendingChangesCheckedAt ?? null,
    pendingChangesSource: input.pendingChangesSource ?? "NSW Planning Proposal layers + curated watchlist",
    effectiveControls: {
      baseZone: zones[0] ?? null,
      baseFsr: lepFsr,
      baseHeightM: lepHeightM,
      statePathway: statePathwayActive ? (input.site.statePathwayName ?? "Low & Mid-Rise Housing") : null,
      proximityDistanceM: nearest,
      proximityDistanceMaxM: furthest,
      proximityBand: band,
      proximityBandLabel: bandLabel(band),
      stateFsr: stateFsr ?? null,
      stateHeightM: stateHeightM ?? null,
      effectiveFsr: effectiveFsr ?? null,
      effectiveHeightM: effectiveHeightM ?? null,
      status: statePathwayActive
        ? "Requires planning confirmation"
        : input.site.yieldStatus === "REQUIRES_PLANNING_INPUT"
          ? "USER FSR REQUIRED"
          : "LEP controls",
      source: statePathwayActive ? "STATE_PATHWAY" : input.site.fsrSource,
      fsrSource: input.site.fsrSource,
      yieldStatus: input.site.yieldStatus,
    },
    lots: lotRows,
  };
}

/** Infer State LMR height from proximity band + zone when not persisted (no planning-rule change). */
export function inferStatePathwayHeightM(zone: string | null, band: ProximityBandLabel): number | null {
  if (band === "OUTSIDE" || band === "UNKNOWN") return null;
  if (zone && /^R[34]$/.test(zone)) return band === "INNER_0_400" ? 22 : 17.5;
  if (zone && /^R[12]$/.test(zone)) return 17.5;
  return null;
}
