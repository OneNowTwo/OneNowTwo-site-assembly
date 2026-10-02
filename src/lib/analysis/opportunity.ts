import type { Polygon, MultiPolygon } from "geojson";
import type { Assumptions, OpportunityInputs, ScenarioAdjustment } from "./assumptions";
import { computeYield, type YieldResult } from "./yield";
import { computeFeasibility, testPurchasePrice, type FeasibilityResult, type PriceTest } from "./feasibility";
import { computeAssemblyMetrics, effectiveFsr, scoreAssembly, type AnalysisLot, type AssemblyMetrics, type OpportunityScore } from "./assembly";
import { allocateOffers, type AllocationResult } from "./allocation";
import { analyseCriticalLots, type CriticalLotResult, type Economics } from "./critical";
import { buildAcquisitionSequence, type StrategyStep } from "./strategy";
import { buildAdjacency, type Adjacency } from "./geometry";

export interface OpportunityLot extends AnalysisLot {
  geometry: Polygon | MultiPolygon;
  included: boolean;
  maxAllocationOverride: number | null;
  openingOfferOverride: number | null;
}

export type ScenarioKey = "BASE" | "UPSIDE" | "DOWNSIDE";

export interface ScenarioResult {
  key: ScenarioKey;
  adjustment: ScenarioAdjustment;
  assumptions: Assumptions;
  fsr: number;
  yield: YieldResult;
  feasibility: FeasibilityResult;
}

export interface SiteBasis {
  siteAreaSqm: number;
  siteAreaSource: "PARCELS" | "OVERRIDE";
  fsr: number;
  fsrSource: "OFFICIAL" | "MIXED_ESTIMATE" | "OVERRIDE";
  heightLimitM: number | null;
  heightSource: "OFFICIAL" | "OVERRIDE" | "NONE";
}

export interface OpportunityAnalysis {
  includedIds: string[];
  excludedIds: string[];
  metrics: AssemblyMetrics;
  score: OpportunityScore;
  site: SiteBasis;
  scenarios: Record<ScenarioKey, ScenarioResult>;
  base: ScenarioResult;
  combinedMarketValue: number;
  marketValueComplete: boolean;
  /** Maximum acquisition budget less combined market value — the value created by assembling. */
  assemblyPremium: number;
  priceTests: { atMarketValue: PriceTest; atOpeningOffers: PriceTest; atMaximum: PriceTest };
  allocation: AllocationResult;
  critical: CriticalLotResult[];
  strategy: StrategyStep[];
}

export function applyScenario(a: Assumptions, adj: ScenarioAdjustment): Assumptions {
  return {
    ...a,
    salePricePerSqm: a.salePricePerSqm * (1 + adj.salePricePct),
    avgDwellingPrice: a.avgDwellingPrice * (1 + adj.salePricePct),
    constructionCostPerSqm: a.constructionCostPerSqm * (1 + adj.buildCostPct),
    financePct: Math.max(0, a.financePct + adj.financePctPoints),
    landFinancePct: Math.max(0, a.landFinancePct + adj.financePctPoints),
    targetMarginOnCost: Math.max(0, a.targetMarginOnCost + adj.targetMarginPctPoints),
    targetMarginOnRevenue: Math.min(0.95, Math.max(0, a.targetMarginOnRevenue + adj.targetMarginPctPoints)),
  };
}

function siteBasis(lots: OpportunityLot[], a: Assumptions, inputs: OpportunityInputs): SiteBasis {
  const parcelArea = lots.reduce((s, l) => s + l.areaSqm, 0);
  const gfaAtControls = lots.reduce((s, l) => s + l.areaSqm * effectiveFsr(l, a).fsr, 0);
  const heights = lots.map((l) => l.heightM).filter((h): h is number => h != null);
  return {
    siteAreaSqm: inputs.siteAreaOverride ?? parcelArea,
    siteAreaSource: inputs.siteAreaOverride ? "OVERRIDE" : "PARCELS",
    fsr: inputs.fsrOverride ?? (parcelArea > 0 ? gfaAtControls / parcelArea : 0),
    fsrSource: inputs.fsrOverride ? "OVERRIDE" : lots.some((l) => l.fsr == null) ? "MIXED_ESTIMATE" : "OFFICIAL",
    heightLimitM: inputs.heightOverrideM ?? (heights.length ? Math.min(...heights) : null),
    heightSource: inputs.heightOverrideM ? "OVERRIDE" : heights.length ? "OFFICIAL" : "NONE",
  };
}

function runScenario(key: ScenarioKey, site: SiteBasis, lotCount: number, a: Assumptions, adj: ScenarioAdjustment): ScenarioResult {
  const sa = applyScenario(a, adj);
  const fsr = site.fsr * (1 + adj.fsrPct);
  const y = computeYield({
    siteAreaSqm: site.siteAreaSqm,
    fsr,
    efficiency: sa.efficiency,
    siteCoverage: sa.siteCoverage,
    floorToFloorM: sa.floorToFloorM,
    avgDwellingSizeSqm: sa.avgDwellingSizeSqm,
    carSpacesPerDwelling: sa.carSpacesPerDwelling,
    heightLimitM: site.heightLimitM,
  });
  const f = computeFeasibility({ gfa: y.gfa, saleableArea: y.saleableArea, dwellings: y.dwellings, lotCount, a: sa });
  return { key, adjustment: adj, assumptions: sa, fsr, yield: y, feasibility: f };
}

/** Full opportunity analysis — pure, shared by API (persisted summary) and UI (live recalculation). */
export function analyseOpportunity(allLots: OpportunityLot[], a: Assumptions, inputs: OpportunityInputs, adjacency?: Adjacency): OpportunityAnalysis {
  const lots = allLots.filter((l) => l.included);
  const adj = adjacency ?? buildAdjacency(allLots.map((l) => ({ id: l.id, geometry: l.geometry })));
  const metrics = computeAssemblyMetrics(lots, a, adj);
  const score = scoreAssembly(metrics, a);
  const site = siteBasis(lots, a, inputs);
  const scenarios = {
    BASE: runScenario("BASE", site, lots.length, a, inputs.scenarios.BASE),
    UPSIDE: runScenario("UPSIDE", site, lots.length, a, inputs.scenarios.UPSIDE),
    DOWNSIDE: runScenario("DOWNSIDE", site, lots.length, a, inputs.scenarios.DOWNSIDE),
  };
  const base = scenarios.BASE;
  const budget = Math.max(0, base.feasibility.maxAcquisitionBudget);

  const allocation = allocateOffers(
    budget,
    lots.map((l) => ({ id: l.id, marketValue: l.marketValue ?? null, areaSqm: l.areaSqm, maxOverride: l.maxAllocationOverride, openingOverride: l.openingOfferOverride })),
    a.openingOfferPct,
    a.existingValuePerSqm,
  );
  const combinedMarketValue = lots.reduce((s, l) => s + (l.marketValue ?? 0), 0);
  const marketValueComplete = lots.every((l) => (l.marketValue ?? 0) > 0);

  // Without-lot economics: subtract the lot's own area and its share of GFA under the site basis.
  const baseEcon: Economics = { areaSqm: site.siteAreaSqm, gfa: base.yield.gfa, budget };
  const parcelArea = lots.reduce((s, l) => s + l.areaSqm, 0) || 1;
  const economicsFor = (ids: string[]): Economics => {
    const subset = lots.filter((l) => ids.includes(l.id));
    const subArea = subset.reduce((s, l) => s + l.areaSqm, 0);
    const scaledSite: SiteBasis = {
      ...siteBasis(subset, a, { ...inputs, siteAreaOverride: null, fsrOverride: inputs.fsrOverride, heightOverrideM: inputs.heightOverrideM }),
      siteAreaSqm: (site.siteAreaSqm * subArea) / parcelArea,
    };
    const r = runScenario("BASE", scaledSite, subset.length, a, inputs.scenarios.BASE);
    return { areaSqm: scaledSite.siteAreaSqm, gfa: r.yield.gfa, budget: r.feasibility.maxAcquisitionBudget };
  };
  const critical = analyseCriticalLots(
    lots.map((l) => ({ id: l.id, areaSqm: l.areaSqm, marketValue: l.marketValue ?? null })),
    adj,
    baseEcon,
    economicsFor,
    { minViableSiteAreaSqm: a.minViableSiteAreaSqm },
  );
  const allocById = new Map(allocation.lots.map((l) => [l.id, l]));
  const strategy = buildAcquisitionSequence(
    lots.map((l) => ({ id: l.id, label: l.label, areaSqm: l.areaSqm, maximumPremium: allocById.get(l.id)?.maximumPremium ?? null })),
    critical,
  );

  return {
    includedIds: lots.map((l) => l.id),
    excludedIds: allLots.filter((l) => !l.included).map((l) => l.id),
    metrics,
    score,
    site,
    scenarios,
    base,
    combinedMarketValue,
    marketValueComplete,
    assemblyPremium: budget - (marketValueComplete ? combinedMarketValue : metrics.combinedValue),
    priceTests: {
      atMarketValue: testPurchasePrice(base.feasibility, combinedMarketValue),
      atOpeningOffers: testPurchasePrice(base.feasibility, allocation.totalOpening),
      atMaximum: testPurchasePrice(base.feasibility, allocation.totalMaximum),
    },
    allocation,
    critical,
    strategy,
  };
}
