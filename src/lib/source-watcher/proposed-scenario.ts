/**
 * MODEL PROPOSED SCENARIO — runs proposed FSR/height through the existing
 * CalculationSnapshot pipeline WITHOUT overwriting CURRENT opportunity inputs
 * or the live PlanningSnapshot-backed analysis.
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

export interface ProposedScenarioResult {
  label: string;
  source: string;
  /** Proposed controls used — never written into CURRENT PlanningSnapshot. */
  proposedFsr: number;
  proposedHeightM: number | null;
  current: CalculationSnapshot;
  proposed: CalculationSnapshot;
  uplift: {
    maxPayable: number;
    headroom: number | null;
    fsr: number;
  };
  /** Disclaimer for UI. */
  disclaimer: string;
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
    // Keep pathwaySnapshot for display of CURRENT; overrides drive the scenario run.
  };

  const scenarioAnalysis = analyseOpportunity(
    input.lots,
    input.assumptions,
    scenarioInputs,
    input.adjacency,
  );

  const current = input.currentAnalysis.calculation;
  const proposed = scenarioAnalysis.calculation;
  const currentFsr = current.effectiveFsr ?? 0;

  return {
    label: input.proposed.label ?? "PROPOSED SCENARIO",
    source: input.proposed.source ?? "Source Watcher proposed controls",
    proposedFsr: input.proposed.proposedFsr,
    proposedHeightM: input.proposed.proposedHeightM ?? null,
    current,
    proposed,
    uplift: {
      maxPayable: proposed.maxPayable - current.maxPayable,
      headroom:
        proposed.headroom != null && current.headroom != null
          ? proposed.headroom - current.headroom
          : null,
      fsr: input.proposed.proposedFsr - currentFsr,
    },
    disclaimer:
      "PROPOSED SCENARIO only — does not overwrite CURRENT feasibility or PlanningSnapshot. Not current LEP law.",
  };
}
