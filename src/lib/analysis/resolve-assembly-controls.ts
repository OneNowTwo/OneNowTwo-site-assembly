import type { ParcelData } from "@/lib/types";
import type { NominatedCentre } from "@/lib/data-sources/housing-sepp-lmr";
import { resolveEffectiveControls, type EffectiveDevelopmentControls } from "./effective-controls";

export interface AssemblyModelledControls {
  lepFsr: number | null;
  modelledFsr: number | null;
  modelledHeightM: number | null;
  certainty: EffectiveDevelopmentControls["modelled"]["certainty"];
  lmrCentre: string | null;
  lmrBand: string;
  developmentType: string | null;
  anyUnmappedLep: boolean;
  /** True when a State pathway supplied the modelled FSR (LEP missing or lower). */
  usedStatePathway: boolean;
  notes: string[];
}

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

/**
 * Resolve CURRENT LEP + State pathway controls for an assembly.
 * Missing LEP FSR is null — never coerced to 0 here.
 */
export function resolveAssemblyModelledControls(
  parcels: Array<Pick<ParcelData, "planning" | "centroid" | "areaSqm">>,
  centres: NominatedCentre[],
): AssemblyModelledControls {
  const effs = parcels.map((p) => resolveEffectiveControls(p.planning, p.centroid, centres));
  const lepFsrs = effs.map((e) => e.lep.fsr).filter((x): x is number => x != null);
  const modFsrs = effs.map((e) => e.modelled.fsr).filter((x): x is number => x != null);
  const modHeights = effs.map((e) => e.modelled.heightM).filter((x): x is number => x != null);
  const anyUnmappedLep = effs.some((e) => e.lep.fsr == null);
  const usedStatePathway = effs.some(
    (e) => e.statePolicy?.fsr != null && (e.lep.fsr == null || (e.statePolicy.fsr ?? 0) > (e.lep.fsr ?? 0)),
  );
  const certainty = effs.some((e) => e.modelled.certainty === "REQUIRES_PLANNING_CONFIRMATION")
    ? "REQUIRES_PLANNING_CONFIRMATION"
    : effs.find((e) => e.modelled.fsr != null)?.modelled.certainty ?? "NOT_APPLICABLE";

  const notes: string[] = [];
  if (anyUnmappedLep) notes.push("NO MAPPED LEP FSR on one or more lots — not the same as FSR 0:1");
  if (usedStatePathway) notes.push("CURRENT State pathway contributes modelled FSR");
  for (const e of effs) notes.push(...e.lmr.exclusionNotes);

  // Area-weighted modelled FSR when parcels differ.
  let modelledFsr = avg(modFsrs);
  const totalArea = parcels.reduce((s, p) => s + p.areaSqm, 0);
  if (totalArea > 0 && modFsrs.length === parcels.length) {
    const gfa = parcels.reduce((s, p, i) => s + p.areaSqm * (effs[i]!.modelled.fsr ?? 0), 0);
    modelledFsr = Math.round((gfa / totalArea) * 1000) / 1000;
  } else if (modelledFsr != null) {
    modelledFsr = Math.round(modelledFsr * 1000) / 1000;
  }

  return {
    lepFsr: lepFsrs.length ? Math.round((avg(lepFsrs) as number) * 1000) / 1000 : null,
    modelledFsr,
    modelledHeightM: modHeights.length ? Math.min(...modHeights) : null,
    certainty,
    lmrCentre: effs.find((e) => e.lmr.centreName)?.lmr.centreName ?? null,
    lmrBand: effs.find((e) => e.lmr.band !== "OUTSIDE")?.lmr.band ?? "OUTSIDE",
    developmentType: effs.find((e) => e.lmr.developmentType)?.lmr.developmentType ?? null,
    anyUnmappedLep,
    usedStatePathway,
    notes: [...new Set(notes)],
  };
}
