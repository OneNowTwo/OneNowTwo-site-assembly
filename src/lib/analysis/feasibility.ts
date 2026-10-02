import type { Assumptions } from "./assumptions";

export interface FeasibilityInputs {
  gfa: number;
  saleableArea: number;
  dwellings: number;
  lotCount: number;
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
    | "demolitionPerLot"
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

export interface FeasibilityResult {
  grv: number;
  salesRevenue: number;
  constructionCost: number;
  costLines: CostLine[];
  /** C — all development costs that do not depend on the land price. */
  nonLandCosts: number;
  /** k — land-price multiplier: purchase price × k = total land cost (price + duty/legal + land holding). */
  landCostMultiplier: number;
  /** Total cost the target margin allows: GRV ÷ (1 + M) on cost, or GRV × (1 − m) on revenue. */
  allowableTotalCost: number;
  /** L — residual land value: total land cost the project can carry (price + acquisition costs + land holding). */
  residualLandValue: number;
  /** P — maximum purchase price payable to owners for the whole assembly: L ÷ k. */
  maxAcquisitionBudget: number;
  acquisitionCosts: number;
  landHoldingCosts: number;
  totalCost: number;
  profit: number;
  marginOnCost: number;
  marginOnRevenue: number;
  viable: boolean;
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

function costBreakdown(i: FeasibilityInputs) {
  const a = i.a;
  const salesRevenue = a.revenueMode === "PER_DWELLING" ? i.dwellings * a.avgDwellingPrice : i.saleableArea * a.salePricePerSqm;
  const grv = salesRevenue + a.otherRevenue;
  const construction = i.gfa * a.constructionCostPerSqm;
  const demolition = i.lotCount * a.demolitionPerLot;
  const consultants = construction * a.consultantsPct;
  const statutory = i.dwellings * a.statutoryFeesPerDwelling;
  const contingency = (construction + demolition + consultants) * a.contingencyPct;
  const marketing = grv * a.marketingPct;
  const selling = grv * a.sellingCostPct;
  const preFinance = construction + demolition + consultants + statutory + contingency + marketing + selling + a.otherCosts;
  const finance = preFinance * a.financePct;
  const lines: CostLine[] = [
    { key: "construction", label: "Construction", amount: construction, basis: `GFA × $${a.constructionCostPerSqm.toLocaleString("en-AU")}/sqm` },
    { key: "demolition", label: "Demolition & site preparation", amount: demolition, basis: `${i.lotCount} lots × $${a.demolitionPerLot.toLocaleString("en-AU")}` },
    { key: "consultants", label: "Consultants & design", amount: consultants, basis: `${(a.consultantsPct * 100).toFixed(1)}% of construction` },
    { key: "statutory", label: "Authority & statutory fees", amount: statutory, basis: `${i.dwellings} dwellings × $${a.statutoryFeesPerDwelling.toLocaleString("en-AU")}` },
    { key: "contingency", label: "Contingency", amount: contingency, basis: `${(a.contingencyPct * 100).toFixed(1)}% of construction, demolition, consultants` },
    { key: "marketing", label: "Marketing", amount: marketing, basis: `${(a.marketingPct * 100).toFixed(1)}% of GRV` },
    { key: "selling", label: "Selling costs", amount: selling, basis: `${(a.sellingCostPct * 100).toFixed(1)}% of GRV` },
    { key: "other", label: "Other costs", amount: a.otherCosts, basis: "Fixed allowance" },
    { key: "finance", label: "Development finance", amount: finance, basis: `${(a.financePct * 100).toFixed(1)}% of the above` },
  ];
  return { salesRevenue, grv, construction, lines, nonLandCosts: preFinance + finance };
}

/**
 * Residual land value, solved in closed form so land-dependent costs are not double counted.
 *
 * Total land cost L = P × k, where P is the purchase price and k = 1 + acquisition cost % + land holding %.
 *  - Margin on cost:    GRV = (C + L)(1 + M)   ⇒  L = GRV ÷ (1 + M) − C
 *  - Margin on revenue: GRV − (C + L) = m·GRV  ⇒  L = GRV(1 − m) − C
 *  - Maximum acquisition budget P = L ÷ k
 */
export function computeFeasibility(i: FeasibilityInputs): FeasibilityResult {
  const a = i.a;
  const { salesRevenue, grv, construction, lines, nonLandCosts } = costBreakdown(i);
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

  const steps: FeasibilityResult["steps"] = [
    { label: "Gross realisation value (GRV)", formula: a.revenueMode === "PER_DWELLING" ? "Dwellings × average price + other revenue" : "Saleable area × $/sqm + other revenue", value: grv, kind: "money" },
    { label: "Non-land development costs (C)", formula: "Sum of construction, fees, contingency, marketing, selling, finance", value: nonLandCosts, kind: "money" },
    {
      label: "Allowable total cost",
      formula: a.targetBasis === "REVENUE" ? `GRV × (1 − ${(target * 100).toFixed(1)}%)` : `GRV ÷ (1 + ${(target * 100).toFixed(1)}%)`,
      value: allowableTotalCost,
      kind: "money",
    },
    { label: "Residual land value (L)", formula: "Allowable total cost − C", value: residualLandValue, kind: "money" },
    { label: "Land cost multiplier (k)", formula: `1 + ${(a.acquisitionCostPct * 100).toFixed(1)}% acquisition + ${(a.landFinancePct * 100).toFixed(1)}% land holding`, value: k, kind: "ratio" },
    { label: "Maximum acquisition budget (P)", formula: "L ÷ k — total payable to all owners", value: maxAcquisitionBudget, kind: "money" },
    { label: "Profit at maximum budget", formula: "GRV − C − L", value: profit, kind: "money" },
    { label: a.targetBasis === "REVENUE" ? "Margin on revenue" : "Margin on cost", formula: a.targetBasis === "REVENUE" ? "Profit ÷ GRV" : "Profit ÷ (C + L)", value: a.targetBasis === "REVENUE" ? marginOnRevenue : marginOnCost, kind: "pct" },
  ];

  return {
    grv,
    salesRevenue,
    constructionCost: construction,
    costLines: lines,
    nonLandCosts,
    landCostMultiplier: k,
    allowableTotalCost,
    residualLandValue,
    maxAcquisitionBudget,
    acquisitionCosts,
    landHoldingCosts,
    totalCost,
    profit,
    marginOnCost,
    marginOnRevenue,
    viable: maxAcquisitionBudget > 0,
    steps,
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
