import type { Assumptions } from "./assumptions";
import type { UnitMixRow } from "./unit-mix";
import { computeUnitMix } from "./unit-mix";
import { constructionCostSourceLabel, constructionRateIncludesLiftAndBasement } from "./construction-benchmarks";

export interface FeasibilityInputs {
  gfa: number;
  saleableArea: number;
  dwellings: number;
  lotCount: number;
  unitMix?: UnitMixRow[];
  a: Pick<
    Assumptions,
    | "targetBasis"
    | "targetMarginOnCost"
    | "targetMarginOnRevenue"
    | "revenueMode"
    | "salePricePerSqm"
    | "avgDwellingPrice"
    | "otherRevenue"
    | "constructionCostPerSqm"
    | "basementParkingCost"
    | "demolitionPerLot"
    | "siteWorksCost"
    | "remediationCost"
    | "difficultExcavationCost"
    | "premiumFacadeCost"
    | "liftsCost"
    | "publicDomainWorksCost"
    | "landscapingCost"
    | "otherFixedConstructionCost"
    | "consultantsPct"
    | "statutoryFeesPerDwelling"
    | "marketingPct"
    | "sellingCostPct"
    | "contingencyPct"
    | "financePct"
    | "landFinancePct"
    | "acquisitionCostPct"
    | "otherCosts"
  >;
}

export interface CostLine {
  key: string;
  label: string;
  amount: number;
  basis: string;
}

/** Material fixed-cost inputs that must not silently read as confirmed $0. */
export const MATERIAL_COST_INPUT_KEYS = [
  "basementParkingCost",
  "liftsCost",
  "siteWorksCost",
  "remediationCost",
] as const;

export type MaterialCostInputKey = (typeof MATERIAL_COST_INPUT_KEYS)[number];

export interface CostInputGap {
  key: MaterialCostInputKey;
  label: string;
}

export interface GrvCrossCheckWarning {
  unitMixImpliedRatePerSqm: number;
  crossCheckRatePerSqm: number;
  differencePct: number;
  /** Area basis used for the like-for-like comparison. */
  areaBasis: "INTERNAL" | "SALEABLE";
  areaSqm: number;
  status: "EXIT_VALUE_VALIDATION_REQUIRED";
}

export interface FeasibilityResult {
  grv: number;
  salesRevenue: number;
  /** Alternative GRV if the other revenue method were used (cross-check). */
  crossCheckGrv: number;
  crossCheckLabel: string;
  /** For UNIT_MIX: internal area used by the $/sqm sense-check. */
  crossCheckAreaSqm: number | null;
  crossCheckAreaBasis: "INTERNAL" | "SALEABLE" | null;
  blendedPricePerSqm: number | null;
  blendedPricePerInternalSqm: number | null;
  unitMixTotals: ReturnType<typeof computeUnitMix> | null;
  constructionCost: number;
  costLines: CostLine[];
  /** C — all development costs that do not depend on the land price. */
  nonLandCosts: number;
  /** k — land-price multiplier: purchase price × k = total land cost (price + duty/legal + land holding). */
  landCostMultiplier: number;
  /** Total cost the target margin allows: GRV ÷ (1 + M) on cost, or GRV × (1 − m) on revenue. */
  allowableTotalCost: number;
  /** L — residual land capacity: total land cost the project can carry (price + acquisition costs + land holding). */
  residualLandValue: number;
  /** P — Maximum Payable to Owners for the whole assembly: L ÷ k. */
  maxAcquisitionBudget: number;
  /** Alias used in product copy. */
  maxPayableToOwners: number;
  acquisitionCosts: number;
  landHoldingCosts: number;
  totalCost: number;
  profit: number;
  marginOnCost: number;
  marginOnRevenue: number;
  /** Display-consistent figures used by "How this was calculated" (same precision as UI). */
  display: {
    saleableArea: number;
    salePricePerSqm: number;
    gfa: number;
  };
  viable: boolean;
  /** True when material fixed-cost categories are still $0 (not confirmed no-cost). */
  costInputIncomplete: boolean;
  costInputGaps: CostInputGap[];
  /** Present when unit-mix implied $/sqm diverges materially from the $/sqm cross-check rate. */
  grvCrossCheckWarning: GrvCrossCheckWarning | null;
  steps: { label: string; formula: string; value: number; kind: "money" | "pct" | "ratio" }[];
}

export interface PriceTest {
  purchasePrice: number;
  totalLandCost: number;
  totalCost: number;
  profit: number;
  marginOnCost: number;
  marginOnRevenue: number;
}

/** Round money to the nearest dollar for display reconciliation. */
export function roundMoney(n: number): number {
  return Math.round(n);
}

/** Round area to 1 decimal for display so GRV = area × rate reconciles. */
export function roundArea(n: number): number {
  return Math.round(n * 10) / 10;
}

function fixedConstruction(a: FeasibilityInputs["a"]): { amount: number; lines: CostLine[] } {
  const allIn = constructionRateIncludesLiftAndBasement(a.constructionCostPerSqm);
  const items: CostLine[] = [
    {
      key: "basement",
      label: "Basement parking",
      amount: a.basementParkingCost,
      basis:
        allIn && a.basementParkingCost === 0
          ? "Included in BMT all-in $/sqm benchmark — $0 here avoids double counting"
          : "Fixed — user assumption",
    },
    { key: "siteWorks", label: "Site works", amount: a.siteWorksCost, basis: "Fixed — user assumption" },
    { key: "remediation", label: "Remediation", amount: a.remediationCost, basis: "Fixed — user assumption" },
    { key: "excavation", label: "Difficult excavation", amount: a.difficultExcavationCost, basis: "Fixed — user assumption" },
    { key: "facade", label: "Premium façade", amount: a.premiumFacadeCost, basis: "Fixed — user assumption" },
    {
      key: "lifts",
      label: "Lifts",
      amount: a.liftsCost,
      basis:
        allIn && a.liftsCost === 0
          ? "Included in BMT all-in $/sqm benchmark — $0 here avoids double counting"
          : "Fixed — user assumption",
    },
    { key: "publicDomain", label: "Public domain works", amount: a.publicDomainWorksCost, basis: "Fixed — user assumption" },
    { key: "landscaping", label: "Landscaping", amount: a.landscapingCost, basis: "Fixed — user assumption" },
    { key: "otherFixedBuild", label: "Other fixed construction", amount: a.otherFixedConstructionCost, basis: "Fixed — user assumption" },
  ];
  // Keep $0 basement/lift rows when the published all-in rate already includes them (transparency).
  const lines = items.filter(
    (x) => x.amount > 0 || (allIn && (x.key === "basement" || x.key === "lifts") && x.amount === 0),
  );
  return { amount: lines.reduce((s, x) => s + x.amount, 0), lines };
}

function costBreakdown(i: FeasibilityInputs) {
  const a = i.a;
  const displaySaleable = roundArea(i.saleableArea);
  const displayGfa = roundArea(i.gfa);
  const displayRate = roundMoney(a.salePricePerSqm);

  let salesRevenue: number;
  let unitMixTotals: ReturnType<typeof computeUnitMix> | null = null;
  let revenueFormula: string;
  let crossCheckGrv: number;
  let crossCheckLabel: string;
  let crossCheckAreaSqm: number | null = null;
  let crossCheckAreaBasis: "INTERNAL" | "SALEABLE" | null = null;

  if (a.revenueMode === "UNIT_MIX" && i.unitMix && i.unitMix.length) {
    unitMixTotals = computeUnitMix(i.unitMix);
    salesRevenue = unitMixTotals.totalRevenue;
    revenueFormula = `Unit mix (${unitMixTotals.totalUnits} dwellings)`;
    // $15,500/sqm-style benchmarks are internal floor-area rates — not saleable (internal+balcony).
    const internalArea = Math.round(unitMixTotals.totalInternalArea * 10) / 10;
    crossCheckAreaSqm = internalArea;
    crossCheckAreaBasis = "INTERNAL";
    crossCheckGrv = internalArea * displayRate + a.otherRevenue;
    crossCheckLabel = `${internalArea.toLocaleString("en-AU")} internal sqm × $${displayRate.toLocaleString("en-AU")}/internal sqm + other`;
  } else if (a.revenueMode === "PER_DWELLING") {
    salesRevenue = i.dwellings * a.avgDwellingPrice;
    revenueFormula = `${i.dwellings} dwellings × $${a.avgDwellingPrice.toLocaleString("en-AU")}`;
    crossCheckAreaSqm = displaySaleable;
    crossCheckAreaBasis = "SALEABLE";
    crossCheckGrv = displaySaleable * displayRate + a.otherRevenue;
    crossCheckLabel = `${displaySaleable.toLocaleString("en-AU")} sqm × $${displayRate.toLocaleString("en-AU")}/sqm + other`;
  } else {
    // PER_SQM — use displayed precision so the table reconciles exactly
    salesRevenue = displaySaleable * displayRate;
    revenueFormula = `${displaySaleable.toLocaleString("en-AU")} sqm × $${displayRate.toLocaleString("en-AU")}/sqm`;
    crossCheckAreaSqm = displaySaleable;
    crossCheckAreaBasis = "SALEABLE";
    crossCheckGrv = i.dwellings * a.avgDwellingPrice + a.otherRevenue;
    crossCheckLabel = `${i.dwellings} dwellings × $${a.avgDwellingPrice.toLocaleString("en-AU")} + other`;
  }

  const grv = salesRevenue + a.otherRevenue;
  const coreConstruction = displayGfa * a.constructionCostPerSqm;
  const fixed = fixedConstruction(a);
  const construction = coreConstruction + fixed.amount;
  const demolition = i.lotCount * a.demolitionPerLot;
  const consultants = construction * a.consultantsPct;
  const statutory = i.dwellings * a.statutoryFeesPerDwelling;
  const contingency = (construction + demolition + consultants) * a.contingencyPct;
  const marketing = grv * a.marketingPct;
  const selling = grv * a.sellingCostPct;
  const preFinance = construction + demolition + consultants + statutory + contingency + marketing + selling + a.otherCosts;
  const finance = preFinance * a.financePct;
  const buildSource = constructionCostSourceLabel(a.constructionCostPerSqm, false);
  const lines: CostLine[] = [
    {
      key: "construction",
      label: "Core construction (GFA × rate)",
      amount: coreConstruction,
      basis: `${displayGfa.toLocaleString("en-AU")} sqm × $${a.constructionCostPerSqm.toLocaleString("en-AU")}/sqm — ${buildSource}`,
    },
    ...fixed.lines,
    { key: "demolition", label: "Demolition & site preparation", amount: demolition, basis: `${i.lotCount} lots × $${a.demolitionPerLot.toLocaleString("en-AU")}` },
    { key: "consultants", label: "Consultants & design", amount: consultants, basis: `${(a.consultantsPct * 100).toFixed(1)}% of construction` },
    { key: "statutory", label: "Authority & statutory fees", amount: statutory, basis: `${i.dwellings} dwellings × $${a.statutoryFeesPerDwelling.toLocaleString("en-AU")}` },
    { key: "contingency", label: "Contingency", amount: contingency, basis: `${(a.contingencyPct * 100).toFixed(1)}% of construction, demolition, consultants` },
    { key: "marketing", label: "Marketing", amount: marketing, basis: `${(a.marketingPct * 100).toFixed(1)}% of GRV` },
    { key: "selling", label: "Selling costs", amount: selling, basis: `${(a.sellingCostPct * 100).toFixed(1)}% of GRV` },
    { key: "other", label: "Other costs", amount: a.otherCosts, basis: "Fixed allowance" },
    { key: "finance", label: "Development finance", amount: finance, basis: `${(a.financePct * 100).toFixed(1)}% of the above (not land holding)` },
  ];
  const blendedPricePerSqm =
    a.revenueMode === "UNIT_MIX" && unitMixTotals?.blendedPricePerSqm != null
      ? unitMixTotals.blendedPricePerSqm
      : displaySaleable > 0
        ? salesRevenue / displaySaleable
        : null;
  const blendedPricePerInternalSqm =
    a.revenueMode === "UNIT_MIX" ? (unitMixTotals?.blendedPricePerInternalSqm ?? null) : null;

  return {
    salesRevenue,
    grv,
    construction,
    lines,
    nonLandCosts: preFinance + finance,
    unitMixTotals,
    revenueFormula,
    crossCheckGrv,
    crossCheckLabel,
    crossCheckAreaSqm,
    crossCheckAreaBasis,
    blendedPricePerSqm,
    blendedPricePerInternalSqm,
    display: { saleableArea: displaySaleable, salePricePerSqm: displayRate, gfa: displayGfa },
  };
}

/**
 * Residual land value, solved in closed form so land-dependent costs are not double counted.
 *
 * Total land cost L = P × k, where P is the purchase price (Maximum Payable to Owners)
 * and k = 1 + acquisition cost % + land holding %.
 *  - Margin on cost:    GRV = (C + L)(1 + M)   ⇒  L = GRV ÷ (1 + M) − C
 *  - Margin on revenue: GRV − (C + L) = m·GRV  ⇒  L = GRV(1 − m) − C
 *  - Maximum Payable to Owners P = L ÷ k
 */
const MATERIAL_COST_LABELS: Record<MaterialCostInputKey, string> = {
  basementParkingCost: "Basement parking",
  liftsCost: "Lifts",
  siteWorksCost: "Site works",
  remediationCost: "Remediation",
};

/** Flag material cost categories that remain $0 (not confirmed zero — estimate not supplied). */
export function materialCostInputGaps(a: FeasibilityInputs["a"]): CostInputGap[] {
  // BMT 4–8 unit benchmark already includes lift + basement — do not flag those as missing.
  const includedInRate = constructionRateIncludesLiftAndBasement(a.constructionCostPerSqm);
  return MATERIAL_COST_INPUT_KEYS.filter((key) => {
    if ((a[key] ?? 0) > 0) return false;
    if (includedInRate && (key === "basementParkingCost" || key === "liftsCost")) return false;
    return true;
  }).map((key) => ({
    key,
    label: MATERIAL_COST_LABELS[key],
  }));
}

/** Material unit-mix vs $/sqm cross-check divergence (does not alter GRV). */
export function grvCrossCheckDiscrepancy(
  grv: number,
  areaSqm: number,
  crossCheckRatePerSqm: number,
  opts?: { materialPct?: number; areaBasis?: "INTERNAL" | "SALEABLE" },
): GrvCrossCheckWarning | null {
  const materialPct = opts?.materialPct ?? 0.1;
  const areaBasis = opts?.areaBasis ?? "INTERNAL";
  if (!(areaSqm > 0) || !(crossCheckRatePerSqm > 0) || !(grv > 0)) return null;
  const unitMixImpliedRatePerSqm = grv / areaSqm;
  const differencePct = (unitMixImpliedRatePerSqm - crossCheckRatePerSqm) / crossCheckRatePerSqm;
  if (Math.abs(differencePct) < materialPct) return null;
  return {
    unitMixImpliedRatePerSqm,
    crossCheckRatePerSqm,
    differencePct,
    areaBasis,
    areaSqm,
    status: "EXIT_VALUE_VALIDATION_REQUIRED",
  };
}

export function computeFeasibility(i: FeasibilityInputs): FeasibilityResult {
  const a = i.a;
  const {
    salesRevenue,
    grv,
    construction,
    lines,
    nonLandCosts,
    unitMixTotals,
    revenueFormula,
    crossCheckGrv,
    crossCheckLabel,
    crossCheckAreaSqm,
    crossCheckAreaBasis,
    blendedPricePerSqm,
    blendedPricePerInternalSqm,
    display,
  } = costBreakdown(i);
  const k = 1 + a.acquisitionCostPct + a.landFinancePct;
  const allowableTotalCost = a.targetBasis === "REVENUE" ? grv * (1 - a.targetMarginOnRevenue) : grv / (1 + a.targetMarginOnCost);
  const residualLandValue = allowableTotalCost - nonLandCosts;
  const maxAcquisitionBudget = residualLandValue / k;
  const acquisitionCosts = maxAcquisitionBudget * a.acquisitionCostPct;
  const landHoldingCosts = maxAcquisitionBudget * a.landFinancePct;
  const totalCost = nonLandCosts + residualLandValue;
  const profit = grv - totalCost;
  const marginOnCost = totalCost > 0 ? profit / totalCost : 0;
  const marginOnRevenue = grv > 0 ? profit / grv : 0;
  const target = a.targetBasis === "REVENUE" ? a.targetMarginOnRevenue : a.targetMarginOnCost;
  const costInputGaps = materialCostInputGaps(a);
  const grvCrossCheckWarning =
    a.revenueMode === "UNIT_MIX" && crossCheckAreaSqm != null && crossCheckAreaBasis
      ? grvCrossCheckDiscrepancy(grv, crossCheckAreaSqm, display.salePricePerSqm, { areaBasis: crossCheckAreaBasis })
      : null;

  const steps: FeasibilityResult["steps"] = [
    { label: "Gross realisation value (GRV)", formula: revenueFormula + (a.otherRevenue ? " + other revenue" : ""), value: grv, kind: "money" },
    { label: "Non-land development costs (C)", formula: "Sum of construction, fees, contingency, marketing, selling, development finance", value: nonLandCosts, kind: "money" },
    {
      label: "Allowable total cost",
      formula: a.targetBasis === "REVENUE" ? `GRV × (1 − ${(target * 100).toFixed(1)}%)` : `GRV ÷ (1 + ${(target * 100).toFixed(1)}%)`,
      value: allowableTotalCost,
      kind: "money",
    },
    { label: "Residual land capacity (L)", formula: "Allowable total cost − C", value: residualLandValue, kind: "money" },
    { label: "Land cost multiplier (k)", formula: `1 + ${(a.acquisitionCostPct * 100).toFixed(1)}% acquisition + ${(a.landFinancePct * 100).toFixed(1)}% land holding`, value: k, kind: "ratio" },
    { label: "Maximum payable to owners (P)", formula: "L ÷ k — total payable to all owners", value: maxAcquisitionBudget, kind: "money" },
    { label: "Profit at maximum land price", formula: "GRV − C − L", value: profit, kind: "money" },
    {
      label: a.targetBasis === "REVENUE" ? "Margin on revenue" : "Margin on cost (MOC)",
      formula: a.targetBasis === "REVENUE" ? "Profit ÷ GRV" : "Profit ÷ (C + L)",
      value: a.targetBasis === "REVENUE" ? marginOnRevenue : marginOnCost,
      kind: "pct",
    },
  ];

  return {
    grv,
    salesRevenue,
    crossCheckGrv,
    crossCheckLabel,
    crossCheckAreaSqm,
    crossCheckAreaBasis,
    blendedPricePerSqm,
    blendedPricePerInternalSqm,
    unitMixTotals,
    constructionCost: construction,
    costLines: lines,
    nonLandCosts,
    landCostMultiplier: k,
    allowableTotalCost,
    residualLandValue,
    maxAcquisitionBudget,
    maxPayableToOwners: maxAcquisitionBudget,
    acquisitionCosts,
    landHoldingCosts,
    totalCost,
    profit,
    marginOnCost,
    marginOnRevenue,
    display,
    viable: maxAcquisitionBudget > 0,
    costInputIncomplete: costInputGaps.length > 0,
    costInputGaps,
    grvCrossCheckWarning,
    steps,
  };
}

/** Acquisition Headroom = Maximum Payable to Owners − Combined Existing Property Value. */
export function acquisitionHeadroom(maxPayableToOwners: number, combinedExistingValue: number) {
  const headroom = maxPayableToOwners - combinedExistingValue;
  const headroomPercent = combinedExistingValue > 0 ? headroom / combinedExistingValue : null;
  return {
    maxPayableToOwners,
    combinedExistingValue,
    acquisitionHeadroom: headroom,
    acquisitionHeadroomPercent: headroomPercent,
    /** Alias — financial value created by assembling before negotiation. */
    assemblyUplift: headroom,
  };
}

/** Profit and margins if the assembly is bought for a given total purchase price. */
export function testPurchasePrice(f: FeasibilityResult, purchasePrice: number): PriceTest {
  const totalLandCost = purchasePrice * f.landCostMultiplier;
  const totalCost = f.nonLandCosts + totalLandCost;
  const profit = f.grv - totalCost;
  return {
    purchasePrice,
    totalLandCost,
    totalCost,
    profit,
    marginOnCost: totalCost > 0 ? profit / totalCost : 0,
    marginOnRevenue: f.grv > 0 ? profit / f.grv : 0,
  };
}
