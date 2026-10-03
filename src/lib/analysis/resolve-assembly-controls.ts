import type { ParcelData } from "@/lib/types";
import type { NominatedCentre } from "@/lib/data-sources/housing-sepp-lmr";
import { resolveEffectiveControls, type EffectiveDevelopmentControls } from "./effective-controls";

export type AssemblyProximityScreen = "PASS" | "FAIL" | "MIXED" | "NONE";

export interface AssemblyModelledControls {
  lepFsr: number | null;
  statePathwayFsr: number | null;
  statePathwayName: string | null;
  modelledFsr: number | null;
  modelledHeightM: number | null;
  certainty: EffectiveDevelopmentControls["modelled"]["certainty"];
  lmrCentre: string | null;
  lmrBand: string;
  developmentType: string | null;
  anyUnmappedLep: boolean;
  /** True when a State pathway supplied the modelled FSR (LEP missing or lower). */
  usedStatePathway: boolean;
  nearestDistanceM: number | null;
  furthestDistanceM: number | null;
  proximityScreen: AssemblyProximityScreen;
  proximityLabel: string | null;
  notes: string[];
}

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

/**
 * Resolve CURRENT LEP + State pathway controls for an assembly.
 * Missing LEP FSR is null — never coerced to 0 here.
 * LMR uses per-parcel 800 m straight-line screens (not assembly centroid alone).
 */
export function resolveAssemblyModelledControls(
  parcels: Array<Pick<ParcelData, "planning" | "centroid" | "areaSqm">>,
  centres: NominatedCentre[],
): AssemblyModelledControls {
  const effs = parcels.map((p) => resolveEffectiveControls(p.planning, p.centroid, centres));
  const lepFsrs = effs.map((e) => e.lep.fsr).filter((x): x is number => x != null);
  const stateFsrs = effs.map((e) => e.statePolicy?.fsr).filter((x): x is number => x != null);
  const modHeights = effs.map((e) => e.modelled.heightM).filter((x): x is number => x != null);
  const anyUnmappedLep = effs.some((e) => e.lep.fsr == null);
  const distances = effs.map((e) => e.lmr.straightLineDistanceM).filter((x): x is number => x != null);
  const nearestDistanceM = distances.length ? Math.min(...distances) : null;
  const furthestDistanceM = distances.length ? Math.max(...distances) : null;

  const screens = effs.map((e) => e.lmr.proximityScreen);
  let proximityScreen: AssemblyProximityScreen = "NONE";
  if (screens.every((s) => s === "PASS")) proximityScreen = "PASS";
  else if (screens.every((s) => s === "FAIL" || s === "NONE") && screens.some((s) => s === "FAIL")) proximityScreen = "FAIL";
  else if (screens.some((s) => s === "PASS") && screens.some((s) => s === "FAIL")) proximityScreen = "MIXED";
  else if (screens.some((s) => s === "PASS")) proximityScreen = "PASS";

  const proximityLabel =
    proximityScreen === "PASS"
      ? "ASSEMBLY PROXIMITY PASS — ESTIMATED"
      : proximityScreen === "MIXED"
        ? "MIXED LMR PROXIMITY — ESTIMATED"
        : proximityScreen === "FAIL"
          ? "LMR PROXIMITY SCREEN: FAIL — ESTIMATED"
          : null;

  // If any parcel fails / mixed, do not model LMR FSR for the assembly.
  const lmrOkForModel = proximityScreen === "PASS";
  const usedStatePathway =
    lmrOkForModel &&
    effs.some((e) => e.statePolicy?.fsr != null && (e.lep.fsr == null || (e.statePolicy.fsr ?? 0) > (e.lep.fsr ?? 0)));

  let modelledFsr: number | null = null;
  if (lmrOkForModel && usedStatePathway) {
    const totalArea = parcels.reduce((s, p) => s + p.areaSqm, 0);
    if (totalArea > 0) {
      const gfa = parcels.reduce((s, p, i) => {
        const e = effs[i]!;
        const f = e.modelled.fsr ?? e.lep.fsr ?? 0;
        return s + p.areaSqm * f;
      }, 0);
      modelledFsr = Math.round((gfa / totalArea) * 1000) / 1000;
    }
  } else if (lepFsrs.length === parcels.length) {
    const totalArea = parcels.reduce((s, p) => s + p.areaSqm, 0);
    if (totalArea > 0) {
      const gfa = parcels.reduce((s, p, i) => s + p.areaSqm * (effs[i]!.lep.fsr ?? 0), 0);
      modelledFsr = Math.round((gfa / totalArea) * 1000) / 1000;
    }
  } else if (lepFsrs.length) {
    modelledFsr = Math.round((avg(lepFsrs) as number) * 1000) / 1000;
  }

  const certainty: EffectiveDevelopmentControls["modelled"]["certainty"] = usedStatePathway
    ? "REQUIRES_PLANNING_CONFIRMATION"
    : modelledFsr != null
      ? "OFFICIAL_LEP"
      : "NOT_APPLICABLE";

  const notes: string[] = [];
  if (anyUnmappedLep) notes.push("BASE LEP FSR: Not mapped on one or more lots — not the same as FSR 0:1");
  if (usedStatePathway) {
    notes.push("CURRENT STATE PATHWAY — 800M PROXIMITY SCREEN PASSED — ESTIMATED");
    notes.push("REQUIRES PLANNING CONFIRMATION — ESTIMATED ELIGIBILITY — VERIFY BEFORE ACQUISITION / DA");
  }
  if (proximityScreen === "MIXED") notes.push("MIXED LMR PROXIMITY across lots — REQUIRES PLANNING CONFIRMATION");
  if (proximityScreen === "FAIL") notes.push("LMR removed from modelled pathway — outside 800 m straight-line screen");
  for (const e of effs) notes.push(...e.lmr.exclusionNotes);

  return {
    lepFsr: lepFsrs.length ? Math.round((avg(lepFsrs) as number) * 1000) / 1000 : null,
    statePathwayFsr: usedStatePathway && stateFsrs.length ? Math.round((avg(stateFsrs) as number) * 1000) / 1000 : null,
    statePathwayName: usedStatePathway ? "Low & Mid-Rise Housing (Housing SEPP)" : null,
    modelledFsr,
    modelledHeightM: modHeights.length ? Math.min(...modHeights) : null,
    certainty,
    lmrCentre: effs.find((e) => e.lmr.centreName)?.lmr.centreName ?? null,
    lmrBand: effs.find((e) => e.lmr.band !== "OUTSIDE")?.lmr.band ?? "OUTSIDE",
    developmentType: usedStatePathway ? (effs.find((e) => e.lmr.developmentType)?.lmr.developmentType ?? null) : null,
    anyUnmappedLep,
    usedStatePathway,
    nearestDistanceM,
    furthestDistanceM,
    proximityScreen,
    proximityLabel,
    notes: [...new Set(notes)],
  };
}
