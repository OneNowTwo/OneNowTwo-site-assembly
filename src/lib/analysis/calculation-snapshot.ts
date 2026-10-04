/**
 * Canonical financial calculation from a PlanningSnapshot.
 *
 * calculateOpportunity(PlanningSnapshot, …) → CalculationSnapshot
 * Every Yield / Feasibility / Acquisition / score consumer must read this —
 * not invent a separate FSR or re-run LEP-weighted metrics as capacity.
 */
import type { PlanningSnapshot } from "@/lib/planning/planning-snapshot";

export interface CalculationSnapshot {
  calculable: boolean;
  effectiveFsr: number | null;
  effectiveHeightM: number | null;
  siteAreaSqm: number;
  theoreticalGfa: number;
  achievableGfa: number;
  saleableArea: number;
  dwellings: number;
  grv: number;
  totalCost: number;
  maxPayable: number;
  headroom: number | null;
  headroomPercent: number | null;
  score: number;
  planningStatus: string;
  fsrSource: PlanningSnapshot["effectiveControls"]["fsrSource"];
}

export function calculationFromBase(input: {
  planning: PlanningSnapshot;
  siteAreaSqm: number;
  theoreticalGfa: number;
  achievableGfa: number;
  saleableArea: number;
  dwellings: number;
  grv: number;
  totalCost: number;
  maxPayable: number;
  headroom: number | null;
  headroomPercent: number | null;
  score: number;
}): CalculationSnapshot {
  const ec = input.planning.effectiveControls;
  const calculable = ec.yieldStatus === "CALCULABLE" && (ec.effectiveFsr ?? 0) > 0;
  return {
    calculable,
    effectiveFsr: calculable ? ec.effectiveFsr : null,
    effectiveHeightM: ec.effectiveHeightM,
    siteAreaSqm: input.siteAreaSqm,
    theoreticalGfa: calculable ? input.theoreticalGfa : 0,
    achievableGfa: calculable ? input.achievableGfa : 0,
    saleableArea: calculable ? input.saleableArea : 0,
    dwellings: calculable ? input.dwellings : 0,
    grv: calculable ? input.grv : 0,
    totalCost: calculable ? input.totalCost : 0,
    maxPayable: calculable ? input.maxPayable : 0,
    headroom: calculable ? input.headroom : null,
    headroomPercent: calculable ? input.headroomPercent : null,
    score: input.score,
    planningStatus: ec.status,
    fsrSource: ec.fsrSource,
  };
}
