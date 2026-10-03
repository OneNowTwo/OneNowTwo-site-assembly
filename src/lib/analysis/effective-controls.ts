import type { PlanningControls } from "@/lib/types";
import {
  LMR_SOURCE_LABEL,
  lmrBandFromDistanceM,
  lmrRfbStandardForZone,
  nearestLmrCentre,
  type LmrBand,
  type NominatedCentre,
} from "@/lib/data-sources/housing-sepp-lmr";
import { isHeritageItem } from "./assembly";

export type ControlCertainty = "OFFICIAL_LEP" | "STATE_POLICY_CANDIDATE" | "REQUIRES_PLANNING_CONFIRMATION" | "NOT_APPLICABLE";

export interface ControlSnapshot {
  fsr: number | null;
  heightM: number | null;
  label: string;
  source: string;
  certainty: ControlCertainty;
}

export interface EffectiveDevelopmentControls {
  lep: ControlSnapshot;
  statePolicy: ControlSnapshot | null;
  modelled: ControlSnapshot;
  /** Planning uplift: modelled FSR − LEP FSR (0 when either missing). */
  fsrUplift: number;
  lmr: {
    centreName: string | null;
    band: LmrBand;
    distanceM: number | null;
    straightLineDistanceM: number | null;
    walkingDistanceM: number | null;
    distanceBasis: "PEDESTRIAN_ROUTE" | "STRAIGHT_LINE_APPROXIMATION" | "NONE";
    walkingStatus: "OK" | "FAILED" | "NOT_CHECKED";
    developmentType: string | null;
    zoneEligible: boolean;
    exclusionNotes: string[];
  };
}

export interface WalkingDistanceHint {
  walkingDistanceM: number | null;
  straightLineDistanceM: number;
  status: "OK" | "FAILED";
  provider?: string;
}

function maxNum(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}

/**
 * Resolve LEP base controls vs potential Housing SEPP LMR standards.
 * Never blindly takes the larger number without zone + band checks.
 * Straight-line proximity is only an approximate screen — modelled control is labelled REQUIRES_PLANNING_CONFIRMATION when LMR is the driver.
 */
export function resolveEffectiveControls(
  planning: PlanningControls | null,
  centroid: [number, number],
  centres: NominatedCentre[],
  walking?: WalkingDistanceHint | null,
): EffectiveDevelopmentControls {
  const lepFsr = planning?.fsr ?? null;
  const lepHeight = planning?.heightM ?? null;
  const lep: ControlSnapshot = {
    fsr: lepFsr,
    heightM: lepHeight,
    label: "LEP CONTROL",
    source: planning?.sources.fsr?.source ?? planning?.planningInstrument ?? "NSW Planning Portal — EPI Primary Planning Layers",
    certainty: "OFFICIAL_LEP",
  };

  const prox = nearestLmrCentre({ type: "Point", coordinates: centroid }, centres);
  const exclusionNotes: string[] = [];
  if (planning && isHeritageItem(planning.heritage)) {
    exclusionNotes.push("Heritage item mapped — LMR may be excluded or heavily constrained; confirm against Housing SEPP exclusion rules");
  }

  const straightM = walking?.straightLineDistanceM ?? (prox ? Math.round(prox.distanceM) : null);
  const walkingM = walking?.status === "OK" ? walking.walkingDistanceM : null;
  const distanceBasis = walking?.status === "OK" && walkingM != null ? "PEDESTRIAN_ROUTE" : prox ? "STRAIGHT_LINE_APPROXIMATION" : "NONE";
  const distanceForBand = distanceBasis === "PEDESTRIAN_ROUTE" && walkingM != null ? walkingM : straightM;
  const band = distanceForBand != null ? lmrBandFromDistanceM(distanceForBand) : prox?.band ?? "OUTSIDE";

  if (!prox || band === "OUTSIDE") {
    return {
      lep,
      statePolicy: null,
      modelled: {
        fsr: lepFsr,
        heightM: lepHeight,
        label: "MODELLED EFFECTIVE CONTROL",
        source: lep.source,
        certainty: lepFsr != null || lepHeight != null ? "OFFICIAL_LEP" : "NOT_APPLICABLE",
      },
      fsrUplift: 0,
      lmr: {
        centreName: prox?.centre.label ?? null,
        band,
        distanceM: distanceForBand,
        straightLineDistanceM: straightM,
        walkingDistanceM: walkingM,
        distanceBasis,
        walkingStatus: walking?.status ?? (prox ? "NOT_CHECKED" : "NOT_CHECKED"),
        developmentType: null,
        zoneEligible: false,
        exclusionNotes: [
          ...exclusionNotes,
          ...(walking && walking.status === "FAILED" ? ["WALKING DISTANCE NOT CONFIRMED — router failed; straight-line is screening only"] : []),
        ],
      },
    };
  }

  const std = lmrRfbStandardForZone(planning?.zone ?? null, band);
  const statePolicy: ControlSnapshot | null = std.applicable
    ? {
        fsr: std.fsr,
        heightM: std.heightM,
        label: "STATE POLICY CONTROL",
        source: `${LMR_SOURCE_LABEL} — ${std.developmentType}`,
        certainty: "STATE_POLICY_CANDIDATE",
      }
    : null;

  // Prefer larger FSR only when LMR zone-eligible.
  // Pedestrian route OK → still confirm exclusions; failed/missing walking → REQUIRES_PLANNING_CONFIRMATION.
  let modelled: ControlSnapshot;
  const walkingConfirmed = distanceBasis === "PEDESTRIAN_ROUTE" && walkingM != null && walkingM <= 800;
  if (statePolicy && std.zoneEligible && (statePolicy.fsr ?? 0) > (lepFsr ?? 0)) {
    modelled = {
      fsr: statePolicy.fsr,
      heightM: maxNum(lepHeight, statePolicy.heightM),
      label: "MODELLED EFFECTIVE CONTROL",
      source: statePolicy.source,
      certainty: walkingConfirmed ? "STATE_POLICY_CANDIDATE" : "REQUIRES_PLANNING_CONFIRMATION",
    };
    if (!walkingConfirmed) {
      exclusionNotes.push("WALKING DISTANCE NOT CONFIRMED — modelled FSR is provisional until pedestrian route ≤800 m is verified");
    }
  } else if (lepFsr != null || lepHeight != null) {
    modelled = {
      fsr: lepFsr,
      heightM: lepHeight,
      label: "MODELLED EFFECTIVE CONTROL",
      source: lep.source,
      certainty: "OFFICIAL_LEP",
    };
  } else {
    modelled = {
      fsr: null,
      heightM: null,
      label: "MODELLED EFFECTIVE CONTROL",
      source: "No LEP or applicable state policy control resolved",
      certainty: "NOT_APPLICABLE",
    };
  }

  const fsrUplift = modelled.fsr != null && lepFsr != null ? Math.round((modelled.fsr - lepFsr) * 1000) / 1000 : modelled.fsr != null && lepFsr == null ? modelled.fsr : 0;

  return {
    lep,
    statePolicy,
    modelled,
    fsrUplift: Math.max(0, fsrUplift),
    lmr: {
      centreName: prox.centre.label,
      band,
      distanceM: distanceForBand,
      straightLineDistanceM: straightM,
      walkingDistanceM: walkingM,
      distanceBasis,
      walkingStatus: walking?.status ?? "NOT_CHECKED",
      developmentType: std.developmentType,
      zoneEligible: std.zoneEligible,
      exclusionNotes,
    },
  };
}
