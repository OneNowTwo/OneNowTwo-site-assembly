/**
 * Input provenance for MVP feasibility — sources beside assumptions.
 * Not a primary “overall feasibility LOW” gate; Opportunity Score remains the ranking signal.
 */
import type { Assumptions } from "@/lib/analysis/assumptions";
import type { FeasibilityResult } from "@/lib/analysis/feasibility";
import type { YieldResult } from "@/lib/analysis/yield";
import type { UnitMixRow } from "@/lib/analysis/unit-mix";
import type { AcquisitionProperty } from "@/lib/analysis/acquisition-property";
import type { PlanningSnapshot } from "@/lib/planning/planning-snapshot";
import {
  constructionCostSourceLabel,
  constructionRateIncludesLiftAndBasement,
} from "@/lib/analysis/construction-benchmarks";

export type SourceType =
  | "MARKET_COMP_DERIVED"
  | "USER_ASSUMPTION"
  | "GLOBAL_DEFAULT"
  | "PUBLISHED_BENCHMARK"
  | "LOCAL_SALE_BENCHMARK"
  | "SYSTEM_ESTIMATE"
  | "INCLUDED_IN_BENCHMARK"
  | "OFFICIAL";

export interface ProvenanceLine {
  key: string;
  label: string;
  value: string;
  basis: string;
  sourceType: SourceType;
  sourceLabel: string;
}

export interface EconomicConfidence {
  /** @deprecated Kept for DTO compat — not shown as primary UX. */
  acquisitionValue: "HIGH" | "MEDIUM" | "LOW";
  /** @deprecated Kept for DTO compat — not shown as primary UX. */
  exitValue: "HIGH" | "MEDIUM" | "LOW";
  /** @deprecated Kept for DTO compat — not shown as primary UX. */
  developmentCost: "HIGH" | "MEDIUM" | "LOW";
  planning: "ESTIMATED" | "CONFIRMED";
  /** @deprecated Not shown in primary UX. */
  overall: "HIGH" | "MEDIUM" | "LOW";
  notes: string[];
  acquisitionProperties: AcquisitionProperty[];
  acquisitionValueMid: number | null;
  cadastralLotSumMid: number | null;
  inputSources: ProvenanceLine[];
  exit: {
    baseGrv: number;
    lowGrv: number | null;
    highGrv: number | null;
    impliedSaleableRate: number | null;
    crossCheckRate: number;
    status: "SUPPORTED" | "BENCHMARK";
    unitMix: {
      name: string;
      count: number;
      avgSaleableArea: number;
      salePricePerUnit: number;
      impliedRate: number | null;
      revenue: number;
      sourceType: SourceType;
      sourceLabel: string;
    }[];
  };
  costLines: ProvenanceLine[];
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
  exitPriceSources?: Record<string, string>;
}): EconomicConfidence {
  const notes: string[] = [];
  const props = input.acquisitionProperties;
  const acqComplete = props.length > 0 && props.every((p) => p.marketValue != null);
  for (const p of props) {
    if (p.note) notes.push(p.note);
  }

  const saleable = input.yield.saleableArea;
  const grv = input.feasibility.grv;
  const implied = saleable > 0 ? grv / saleable : null;
  const cross = input.assumptions.salePricePerSqm;

  const mixRows = input.unitMix.map((r) => {
    const rev = r.count * r.salePricePerUnit;
    const rate = r.avgSaleableArea > 0 ? r.salePricePerUnit / r.avgSaleableArea : null;
    const src = input.exitPriceSources?.[r.name];
    const sourceType: SourceType =
      src === "USER_OVERRIDE" || "salePricePerSqm" in input.overrides
        ? "USER_ASSUMPTION"
        : src?.startsWith("LOCAL")
          ? "LOCAL_SALE_BENCHMARK"
          : "GLOBAL_DEFAULT";
    const sourceLabel =
      src === "LOCAL_BEDROOM_MEDIAN"
        ? "LOCAL BEDROOM MEDIAN"
        : src === "LOCAL_UNIT_MEDIAN"
          ? "LOCAL UNIT MEDIAN"
          : src === "LOCAL_STRATA_BENCHMARK" || src === "LOCAL_STRATA_AREA_BAND"
            ? "LOCAL STRATA BENCHMARK"
            : src === "USER_OVERRIDE"
              ? "USER OVERRIDE"
              : src === "TEMPLATE_FALLBACK" || src === "TEMPLATE_DEFAULT"
                ? "TEMPLATE FALLBACK"
                : "DEFAULT MARKET VALUE";
    return {
      name: r.name,
      count: r.count,
      avgSaleableArea: r.avgSaleableArea,
      salePricePerUnit: r.salePricePerUnit,
      impliedRate: rate,
      revenue: rev,
      sourceType,
      sourceLabel,
    };
  });

  const buildOverridden = "constructionCostPerSqm" in input.overrides;
  const buildLabel = constructionCostSourceLabel(input.assumptions.constructionCostPerSqm, buildOverridden);
  const allIn = constructionRateIncludesLiftAndBasement(input.assumptions.constructionCostPerSqm);

  const costLines: ProvenanceLine[] = [
    {
      key: "constructionCostPerSqm",
      label: "Base construction",
      value: `$${input.assumptions.constructionCostPerSqm.toLocaleString("en-AU")}/sqm GFA`,
      basis: "Applied to achievable GFA",
      sourceType: buildOverridden ? "USER_ASSUMPTION" : allIn ? "PUBLISHED_BENCHMARK" : "GLOBAL_DEFAULT",
      sourceLabel: buildLabel,
    },
    {
      key: "basementParkingCost",
      label: "Basement / structured parking",
      value: input.assumptions.basementParkingCost === 0 ? "$0" : `$${input.assumptions.basementParkingCost.toLocaleString("en-AU")}`,
      basis: allIn && input.assumptions.basementParkingCost === 0 ? "Included in construction $/sqm" : "Fixed allowance",
      sourceType: allIn && input.assumptions.basementParkingCost === 0 ? "INCLUDED_IN_BENCHMARK" : "GLOBAL_DEFAULT",
      sourceLabel: allIn && input.assumptions.basementParkingCost === 0 ? "Included in BMT all-in rate" : "DEFAULT",
    },
    {
      key: "liftsCost",
      label: "Lifts",
      value: input.assumptions.liftsCost === 0 ? "$0" : `$${input.assumptions.liftsCost.toLocaleString("en-AU")}`,
      basis: allIn && input.assumptions.liftsCost === 0 ? "Included in construction $/sqm" : "Fixed allowance",
      sourceType: allIn && input.assumptions.liftsCost === 0 ? "INCLUDED_IN_BENCHMARK" : "GLOBAL_DEFAULT",
      sourceLabel: allIn && input.assumptions.liftsCost === 0 ? "Included in BMT all-in rate" : "DEFAULT",
    },
    {
      key: "demolitionPerLot",
      label: "Demolition",
      value: `$${input.assumptions.demolitionPerLot.toLocaleString("en-AU")}/lot`,
      basis: "Per included lot",
      sourceType: "GLOBAL_DEFAULT",
      sourceLabel: "DEFAULT",
    },
    {
      key: "consultantsPct",
      label: "Consultants",
      value: `${Math.round(input.assumptions.consultantsPct * 100)}%`,
      basis: "% of construction",
      sourceType: "GLOBAL_DEFAULT",
      sourceLabel: "DEFAULT",
    },
  ];

  const inputSources: ProvenanceLine[] = [
    {
      key: "existingProperty",
      label: "Existing property value",
      value:
        acqComplete && props.length
          ? `$${Math.round(props.reduce((s, p) => s + (p.marketValue as number), 0)).toLocaleString("en-AU")}`
          : "—",
      basis: props.map((p) => p.valueBasis).join(", ") || "INCOMPLETE",
      sourceType: props.some((p) => p.valueBasis.startsWith("PROPERTY_LEVEL") || p.valueBasis === "SINGLE_LOT")
        ? "MARKET_COMP_DERIVED"
        : "SYSTEM_ESTIMATE",
      sourceLabel: props.find((p) => p.sourceLabel)?.sourceLabel ?? "NSW registered comps / property estimate",
    },
    ...mixRows
      .filter((r) => r.count > 0)
      .map((r) => ({
        key: `exit:${r.name}`,
        label: `Exit — ${r.name}`,
        value: `$${r.salePricePerUnit.toLocaleString("en-AU")}/unit`,
        basis: `${r.count} dwellings`,
        sourceType: r.sourceType,
        sourceLabel: r.sourceLabel,
      })),
    ...costLines,
  ];

  const planning: EconomicConfidence["planning"] =
    input.planning.effectiveControls.fsrSource === "OFFICIAL" ? "CONFIRMED" : "ESTIMATED";

  return {
    acquisitionValue: "MEDIUM",
    exitValue: "MEDIUM",
    developmentCost: "MEDIUM",
    planning,
    overall: "MEDIUM",
    notes,
    acquisitionProperties: props,
    acquisitionValueMid: acqComplete ? props.reduce((s, p) => s + (p.marketValue as number), 0) : null,
    cadastralLotSumMid: input.cadastralLotSumMid,
    inputSources,
    exit: {
      baseGrv: grv,
      lowGrv: null,
      highGrv: null,
      impliedSaleableRate: implied,
      crossCheckRate: cross,
      status: "BENCHMARK",
      unitMix: mixRows,
    },
    costLines,
  };
}
