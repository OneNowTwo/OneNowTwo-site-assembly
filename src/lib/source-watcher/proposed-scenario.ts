/**
 * MODEL PROPOSED SCENARIO — runs proposed FSR/height through the existing
 * CalculationSnapshot pipeline WITHOUT overwriting CURRENT opportunity inputs
 * or the live PlanningSnapshot-backed analysis.
 *
 * Recalculates dependent outputs via analyseOpportunity (GFA, yield/unit mix,
 * GRV, costs, max payable, headroom, score) — not a display-only FSR swap.
 */

import {
  analyseOpportunity,
  type OpportunityAnalysis,
  type OpportunityLot,
} from "@/lib/analysis/opportunity";
import type { Assumptions, OpportunityInputs } from "@/lib/analysis/assumptions";
import type { CalculationSnapshot } from "@/lib/analysis/calculation-snapshot";
import type { Adjacency } from "@/lib/analysis/geometry";

export interface ProposedScenarioInput {
  proposedFsr: number;
  proposedHeightM?: number | null;
  label?: string;
  source?: string;
}

/** Dependent financial / yield outputs from the engine (not display-only). */
export interface ProposedScenarioEngineOutputs {
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
  effectiveFsr: number | null;
  effectiveHeightM: number | null;
  calculable: boolean;
  unitMixRows: number;
  yieldSaleableArea: number;
  yieldDwellingCount: number;
}

export interface ProposedScenarioResult {
  label: string;
  source: string;
  /** Proposed controls used — never written into CURRENT PlanningSnapshot. */
  proposedFsr: number;
  proposedHeightM: number | null;
  current: CalculationSnapshot;
  proposed: CalculationSnapshot;
  currentOutputs: ProposedScenarioEngineOutputs;
  proposedOutputs: ProposedScenarioEngineOutputs;
  uplift: {
    maxPayable: number;
    headroom: number | null;
    fsr: number;
    grv: number;
    dwellings: number;
    theoreticalGfa: number;
    score: number;
  };
  /** Disclaimer for UI. */
  disclaimer: string;
}

function engineOutputs(analysis: OpportunityAnalysis): ProposedScenarioEngineOutputs {
  const c = analysis.calculation;
  const y = analysis.base.yield;
  return {
    theoreticalGfa: c.theoreticalGfa,
    achievableGfa: c.achievableGfa,
    saleableArea: c.saleableArea,
    dwellings: c.dwellings,
    grv: c.grv,
    totalCost: c.totalCost,
    maxPayable: c.maxPayable,
    headroom: c.headroom,
    headroomPercent: c.headroomPercent,
    score: c.score,
    effectiveFsr: c.effectiveFsr,
    effectiveHeightM: c.effectiveHeightM,
    calculable: c.calculable,
    unitMixRows: analysis.unitMix?.length ?? 0,
    yieldSaleableArea: y?.saleableArea ?? c.saleableArea,
    yieldDwellingCount: y?.dwellings ?? c.dwellings,
  };
}

/**
 * Build a separate CalculationSnapshot using USER-style overrides for the
 * proposed scenario only. Caller must not persist these overrides onto the
 * opportunity unless the user explicitly chooses to adopt them.
 */
export function modelProposedScenario(input: {
  lots: OpportunityLot[];
  assumptions: Assumptions;
  opportunityInputs: OpportunityInputs;
  adjacency: Adjacency;
  currentAnalysis: OpportunityAnalysis;
  proposed: ProposedScenarioInput;
}): ProposedScenarioResult {
  const scenarioInputs: OpportunityInputs = {
    ...input.opportunityInputs,
    fsrOverride: input.proposed.proposedFsr,
    fsrOverrideKind: "USER",
    fsrOverrideCertainty: "PROPOSED_SCENARIO_ONLY",
    heightOverrideM: input.proposed.proposedHeightM ?? input.opportunityInputs.heightOverrideM,
  };

  const scenarioAnalysis = analyseOpportunity(
    input.lots,
    input.assumptions,
    scenarioInputs,
    input.adjacency,
  );

  const current = input.currentAnalysis.calculation;
  const proposed = scenarioAnalysis.calculation;
  const currentOutputs = engineOutputs(input.currentAnalysis);
  const proposedOutputs = engineOutputs(scenarioAnalysis);
  const currentFsr = current.effectiveFsr ?? 0;

  return {
    label: input.proposed.label ?? "PROPOSED SCENARIO",
    source: input.proposed.source ?? "Source Watcher proposed controls",
    proposedFsr: input.proposed.proposedFsr,
    proposedHeightM: input.proposed.proposedHeightM ?? null,
    current,
    proposed,
    currentOutputs,
    proposedOutputs,
    uplift: {
      maxPayable: proposed.maxPayable - current.maxPayable,
      headroom:
        proposed.headroom != null && current.headroom != null
          ? proposed.headroom - current.headroom
          : null,
      fsr: input.proposed.proposedFsr - currentFsr,
      grv: proposed.grv - current.grv,
      dwellings: proposed.dwellings - current.dwellings,
      theoreticalGfa: proposed.theoreticalGfa - current.theoreticalGfa,
      score: proposed.score - current.score,
    },
    disclaimer:
      "PROPOSED SCENARIO only — full engine recalculation (GFA / yield / GRV / costs / max payable / headroom / score). Does not overwrite CURRENT feasibility or PlanningSnapshot. Not current LEP law.",
  };
}
