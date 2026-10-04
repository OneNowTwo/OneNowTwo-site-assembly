/**
 * Feasibility confidence is separate from Opportunity Score.
 * Trace provenance of acquisition / exit / cost inputs without inventing values.
 */
import type { Assumptions } from "@/lib/analysis/assumptions";
import type { FeasibilityResult } from "@/lib/analysis/feasibility";
import type { YieldResult } from "@/lib/analysis/yield";
import type { UnitMixRow } from "@/lib/analysis/unit-mix";
import type { AcquisitionProperty } from "@/lib/analysis/acquisition-property";
import type { PlanningSnapshot } from "@/lib/planning/planning-snapshot";

export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";
export type PlanningConfidence = "ESTIMATED" | "CONFIRMED";
export type SourceType =
  | "MARKET_COMP_DERIVED"
  | "USER_ASSUMPTION"
  | "GLOBAL_DEFAULT"
  | "SYSTEM_ESTIMATE"
  | "NOT_YET_MODELLED"
  | "CONFIRMED_ZERO"
  | "OFFICIAL";

export interface ProvenanceLine {
  key: string;
  label: string;
  value: string;
  basis: string;
  sourceType: SourceType;
  confidence: ConfidenceLevel;
}

export interface EconomicConfidence {
  acquisitionValue: ConfidenceLevel;
  exitValue: ConfidenceLevel;
  developmentCost: ConfidenceLevel;
  planning: PlanningConfidence;
  overall: ConfidenceLevel;
  notes: string[];
  acquisitionProperties: AcquisitionProperty[];
  acquisitionValueMid: number | null;
  /** Lot-sum mid for comparison when property grouping differs. */
  cadastralLotSumMid: number | null;
  exit: {
    baseGrv: number;
    lowGrv: number | null;
    highGrv: number | null;
    impliedSaleableRate: number | null;
    crossCheckRate: number;
    status: "SUPPORTED" | "EXIT_VALUE_VALIDATION_REQUIRED";
    unitMix: { name: string; count: number; avgSaleableArea: number; salePricePerUnit: number; impliedRate: number | null; revenue: number; sourceType: SourceType }[];
  };
  costLines: ProvenanceLine[];
}

function minConfidence(levels: ConfidenceLevel[]): ConfidenceLevel {
  if (levels.includes("LOW")) return "LOW";
  if (levels.includes("MEDIUM")) return "MEDIUM";
  return "HIGH";
}

export function assessEconomicConfidence(input: {
  planning: PlanningSnapshot;
  assumptions: Assumptions;
  feasibility: FeasibilityResult;
  yield: YieldResult;
  unitMix: UnitMixRow[];
  acquisitionProperties: AcquisitionProperty[];
  cadastralLotSumMid: number | null;
  overrides: Partial<Assumptions>;
}): EconomicConfidence {
  const notes: string[] = [];
  const props = input.acquisitionProperties;
  const acqComplete = props.length > 0 && props.every((p) => p.marketValue != null);
  const shared = props.some((p) => p.valueBasis === "MAX_OF_SHARED_ADDRESS");
  if (shared) notes.push(...props.map((p) => p.note).filter(Boolean) as string[]);

  let acquisitionValue: ConfidenceLevel = "LOW";
  if (acqComplete) {
    const confs = props.map((p) => (p.lotIds.length ? "MEDIUM" : "LOW") as ConfidenceLevel);
    // COMPARABLE_DERIVED without bedroom/quality → MEDIUM at best.
    acquisitionValue = shared ? "MEDIUM" : minConfidence(confs.length ? confs : ["MEDIUM"]);
  }

  const saleable = input.yield.saleableArea;
  const grv = input.feasibility.grv;
  const implied = saleable > 0 ? grv / saleable : null;
  const cross = input.assumptions.salePricePerSqm;
  const gap = implied != null && cross > 0 ? Math.abs(implied - cross) / cross : 0;
  const mixRows = input.unitMix.map((r) => {
    const rev = r.count * r.salePricePerUnit;
    const rate = r.avgSaleableArea > 0 ? r.salePricePerUnit / r.avgSaleableArea : null;
    const overridden = input.overrides && "salePricePerSqm" in input.overrides;
    return {
      name: r.name,
      count: r.count,
      avgSaleableArea: r.avgSaleableArea,
      salePricePerUnit: r.salePricePerUnit,
      impliedRate: rate,
      revenue: rev,
      sourceType: (overridden ? "USER_ASSUMPTION" : "GLOBAL_DEFAULT") as SourceType,
    };
  });

  let exitValue: ConfidenceLevel = "LOW";
  let exitStatus: EconomicConfidence["exit"]["status"] = "EXIT_VALUE_VALIDATION_REQUIRED";
  if (input.feasibility.grvCrossCheckWarning || gap > 0.15) {
    exitValue = "LOW";
    exitStatus = "EXIT_VALUE_VALIDATION_REQUIRED";
    notes.push("Unit-mix GRV diverges from salePricePerSqm cross-check — EXIT VALUE VALIDATION REQUIRED.");
  } else if (mixRows.every((r) => r.sourceType === "GLOBAL_DEFAULT")) {
    exitValue = "LOW";
    exitStatus = "EXIT_VALUE_VALIDATION_REQUIRED";
    notes.push("Exit prices are GLOBAL DEFAULT / SYSTEM ESTIMATE — not market-comp derived.");
  } else {
    exitValue = "MEDIUM";
    exitStatus = "SUPPORTED";
  }

  const costLines: ProvenanceLine[] = [
    {
      key: "constructionCostPerSqm",
      label: "Base construction",
      value: `$${input.assumptions.constructionCostPerSqm.toLocaleString("en-AU")}/sqm GFA`,
      basis: "Applied to achievable GFA",
      sourceType: "constructionCostPerSqm" in input.overrides ? "USER_ASSUMPTION" : "GLOBAL_DEFAULT",
      confidence: "LOW",
    },
    {
      key: "basementParkingCost",
      label: "Basement / structured parking",
      value: input.assumptions.basementParkingCost === 0 ? "$0" : `$${input.assumptions.basementParkingCost.toLocaleString("en-AU")}`,
      basis: input.assumptions.basementParkingCost === 0 ? "NOT YET MODELLED (not confirmed zero)" : "Fixed allowance",
      sourceType: input.assumptions.basementParkingCost === 0 ? "NOT_YET_MODELLED" : "GLOBAL_DEFAULT",
      confidence: "LOW",
    },
    {
      key: "liftsCost",
      label: "Lifts",
      value: input.assumptions.liftsCost === 0 ? "$0" : `$${input.assumptions.liftsCost.toLocaleString("en-AU")}`,
      basis: input.assumptions.liftsCost === 0 ? "NOT YET MODELLED (not confirmed zero)" : "Fixed allowance",
      sourceType: input.assumptions.liftsCost === 0 ? "NOT_YET_MODELLED" : "GLOBAL_DEFAULT",
      confidence: "LOW",
    },
    {
      key: "siteWorksCost",
      label: "Site works",
      value: input.assumptions.siteWorksCost === 0 ? "$0" : `$${input.assumptions.siteWorksCost.toLocaleString("en-AU")}`,
      basis: input.assumptions.siteWorksCost === 0 ? "NOT YET MODELLED" : "Fixed allowance",
      sourceType: input.assumptions.siteWorksCost === 0 ? "NOT_YET_MODELLED" : "GLOBAL_DEFAULT",
      confidence: "LOW",
    },
    {
      key: "remediationCost",
      label: "Remediation",
      value: input.assumptions.remediationCost === 0 ? "$0" : `$${input.assumptions.remediationCost.toLocaleString("en-AU")}`,
      basis: input.assumptions.remediationCost === 0 ? "NOT YET MODELLED" : "Fixed allowance",
      sourceType: input.assumptions.remediationCost === 0 ? "NOT_YET_MODELLED" : "GLOBAL_DEFAULT",
      confidence: "LOW",
    },
    {
      key: "demolitionPerLot",
      label: "Demolition",
      value: `$${input.assumptions.demolitionPerLot.toLocaleString("en-AU")}/lot`,
      basis: "Per included lot",
      sourceType: "GLOBAL_DEFAULT",
      confidence: "MEDIUM",
    },
    {
      key: "consultantsPct",
      label: "Consultants",
      value: `${Math.round(input.assumptions.consultantsPct * 100)}%`,
      basis: "% of construction",
      sourceType: "GLOBAL_DEFAULT",
      confidence: "MEDIUM",
    },
  ];

  if (input.feasibility.costInputIncomplete) {
    notes.push("Material cost lines are $0 / incomplete — DEVELOPMENT COST confidence LOW.");
  }
  const developmentCost: ConfidenceLevel = input.feasibility.costInputIncomplete || costLines.some((c) => c.sourceType === "NOT_YET_MODELLED")
    ? "LOW"
    : "MEDIUM";

  const planning: PlanningConfidence =
    input.planning.effectiveControls.fsrSource === "STATE_PATHWAY" ? "ESTIMATED" : input.planning.effectiveControls.fsrSource === "OFFICIAL" ? "CONFIRMED" : "ESTIMATED";

  const overall = minConfidence([acquisitionValue, exitValue, developmentCost]);

  const lowGrv = implied != null ? Math.round(saleable * Math.min(cross, implied) * 0.9) : null;
  const highGrv = implied != null ? Math.round(saleable * Math.max(cross, implied) * 1.05) : null;

  return {
    acquisitionValue,
    exitValue,
    developmentCost,
    planning,
    overall,
    notes,
    acquisitionProperties: props,
    acquisitionValueMid: acqComplete ? props.reduce((s, p) => s + (p.marketValue as number), 0) : null,
    cadastralLotSumMid: input.cadastralLotSumMid,
    exit: {
      baseGrv: grv,
      lowGrv,
      highGrv,
      impliedSaleableRate: implied,
      crossCheckRate: cross,
      status: exitStatus,
      unitMix: mixRows,
    },
    costLines,
  };
}
