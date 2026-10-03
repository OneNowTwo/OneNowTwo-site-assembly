import type { Polygon, MultiPolygon } from "geojson";
import type { Assumptions, OpportunityInputs, ScenarioAdjustment } from "./assumptions";
import { defaultUnitMix } from "./assumptions";
import { computeYield, type YieldResult } from "./yield";
import { acquisitionHeadroom, computeFeasibility, testPurchasePrice, type FeasibilityResult, type PriceTest } from "./feasibility";
import { computeAssemblyMetrics, officialParcelTheoreticalGfa, scoreAssembly, type AnalysisLot, type AssemblyMetrics, type OpportunityScore } from "./assembly";
import { allocateOffers, type AllocationResult } from "./allocation";
import { analyseCriticalLots, type CriticalLotResult, type Economics } from "./critical";
import { analyseMarginalLots, type MarginalLotResult, type MarginalLotEconomics } from "./marginal";
import { buildAcquisitionSequence, type StrategyStep } from "./strategy";
import { buildAdjacency, type Adjacency } from "./geometry";
import { autoGenerateUnitMix, computeUnitMix, type UnitMixRow } from "./unit-mix";
import { summariseAssemblyValuation, type AssemblyValuationSummary, type AcquisitionViability } from "./valuation";

export interface OpportunityLot extends AnalysisLot {
  geometry: Polygon | MultiPolygon;
  included: boolean;
  maxAllocationOverride: number | null;
  openingOfferOverride: number | null;
  strategicWeight?: number | null;
  marketValueLow?: number | null;
  marketValueHigh?: number | null;
  marketValueSource?: string | null;
  marketValueConfidence?: string | null;
  marketValueProvider?: string | null;
  marketValueMethod?: string | null;
  marketValueCheckedAt?: string | null;
}

export type ScenarioKey = "BASE" | "UPSIDE" | "DOWNSIDE";

export interface ScenarioResult {
  key: ScenarioKey;
  adjustment: ScenarioAdjustment;
  assumptions: Assumptions;
  fsr: number;
  yield: YieldResult;
  feasibility: FeasibilityResult;
  combinedExistingValue: number;
  maxPayableToOwners: number;
  acquisitionHeadroom: number;
  acquisitionHeadroomPercent: number | null;
}

export type SiteFsrSource = "OFFICIAL" | "NO_MAPPED" | "OVERRIDE" | "STATE_PATHWAY";
/** CALCULABLE = a usable FSR exists; REQUIRES_PLANNING_INPUT = missing LEP FSR and no State pathway yet. */
export type YieldStatus = "CALCULABLE" | "REQUIRES_PLANNING_INPUT";

export interface SiteBasis {
  siteAreaSqm: number;
  siteAreaSource: "PARCELS" | "OVERRIDE";
  fsr: number;
  /**
   * OFFICIAL = mapped EPI FSR;
   * STATE_PATHWAY = current Housing SEPP / LMR (or similar) modelled control;
   * OVERRIDE = explicit user assumption;
   * NO_MAPPED = no LEP FSR and no pathway/override — NOT the same as FSR 0:1.
   */
  fsrSource: SiteFsrSource;
  yieldStatus: YieldStatus;
  fsrCertainty: string | null;
  /** Base LEP FSR — null when not mapped (never shown as 0). */
  lepFsr: number | null;
  statePathwayFsr: number | null;
  statePathwayName: string | null;
  lmrCentreName: string | null;
  lmrNearestDistanceM: number | null;
  lmrFurthestDistanceM: number | null;
  lmrProximityScreen: "PASS" | "FAIL" | "MIXED" | "NONE" | null;
  lmrProximityLabel: string | null;
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
  /** Trusted mid existing value only — null when any included lot lacks a trusted valuation. */
  combinedExistingValue: number | null;
  marketValueComplete: boolean;
  /** Rough screening total — labelled, not for acquisition decisions. */
  screeningExistingValue: number | null;
  valuation: AssemblyValuationSummary;
  viability: AcquisitionViability;
  /** False when yield cannot be calculated (missing FSR / pathway) — do not treat $0 GRV as a real result. */
  feasibilityCalculable: boolean;
  maxPayableToOwners: number;
  acquisitionHeadroom: number | null;
  acquisitionHeadroomPercent: number | null;
  /** Alias of acquisition headroom. */
  assemblyPremium: number | null;
  assemblyUplift: number | null;
  unitMix: UnitMixRow[];
  priceTests: { atMarketValue: PriceTest; atOpeningOffers: PriceTest; atMaximum: PriceTest };
  allocation: AllocationResult;
  critical: CriticalLotResult[];
  marginal: MarginalLotResult[];
  strategy: StrategyStep[];
  /** Short conclusion for UI: planning vs economics. */
  conclusion: {
    planning: "NOT_PERMITTED" | "REQUIRES_CONFIRMATION" | "MODELLED_PATHWAY" | "LEP_CONTROLS";
    economics: "NOT_CALCULABLE" | "UNECONOMIC" | "MARGINAL" | "VIABLE";
    summary: string;
  };
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

function siteBasis(lots: OpportunityLot[], _a: Assumptions, inputs: OpportunityInputs): SiteBasis {
  const parcelArea = lots.reduce((s, l) => s + l.areaSqm, 0);
  // Per-parcel official mapped FSR only — no silent height/fallback assumption.
  const gfaAtControls = lots.reduce((s, l) => s + officialParcelTheoreticalGfa(l), 0);
  const heights = lots.map((l) => l.heightM).filter((h): h is number => h != null);
  const anyUnmapped = lots.some((l) => l.fsr == null && !(l.fsrControls && l.fsrControls.length));
  const officialFsr = parcelArea > 0 ? gfaAtControls / parcelArea : 0;
  const heightLimitM = inputs.heightOverrideM ?? (heights.length ? Math.min(...heights) : null);
  const heightSource: SiteBasis["heightSource"] = inputs.heightOverrideM ? "OVERRIDE" : heights.length ? "OFFICIAL" : "NONE";
  const siteAreaSqm = inputs.siteAreaOverride ?? parcelArea;
  const siteAreaSource: SiteBasis["siteAreaSource"] = inputs.siteAreaOverride ? "OVERRIDE" : "PARCELS";

  const snap = inputs.pathwaySnapshot;
  const lepFsr = snap?.lepFsr ?? (anyUnmapped && officialFsr <= 0 ? null : officialFsr > 0 ? officialFsr : null);

  if (inputs.fsrOverride != null) {
    const fromScan = inputs.fsrOverrideKind === "SCAN_MODELLED";
    return {
      siteAreaSqm,
      siteAreaSource,
      fsr: inputs.fsrOverride,
      // Persisted scan/State pathway — not a silent invent, and not “user typed a number”.
      fsrSource: fromScan ? "STATE_PATHWAY" : "OVERRIDE",
      yieldStatus: "CALCULABLE",
      fsrCertainty: inputs.fsrOverrideCertainty ?? (fromScan ? "REQUIRES_PLANNING_CONFIRMATION" : null),
      lepFsr,
      statePathwayFsr: snap?.statePathwayFsr ?? (fromScan ? inputs.fsrOverride : null),
      statePathwayName: snap?.statePathwayName ?? (fromScan ? "Low & Mid-Rise Housing (Housing SEPP)" : null),
      lmrCentreName: snap?.lmrCentre ?? null,
      lmrNearestDistanceM: snap?.nearestDistanceM ?? null,
      lmrFurthestDistanceM: snap?.furthestDistanceM ?? null,
      lmrProximityScreen: snap?.proximityScreen ?? (fromScan ? "PASS" : null),
      lmrProximityLabel: snap?.proximityLabel ?? (fromScan ? "PASS — ESTIMATED" : null),
      heightLimitM,
      heightSource,
    };
  }

  // Missing LEP FSR must NOT become a fake 0:1 development control.
  if (anyUnmapped && officialFsr <= 0) {
    return {
      siteAreaSqm,
      siteAreaSource,
      fsr: 0,
      fsrSource: "NO_MAPPED",
      yieldStatus: "REQUIRES_PLANNING_INPUT",
      fsrCertainty: null,
      lepFsr: null,
      statePathwayFsr: null,
      statePathwayName: null,
      lmrCentreName: snap?.lmrCentre ?? null,
      lmrNearestDistanceM: snap?.nearestDistanceM ?? null,
      lmrFurthestDistanceM: snap?.furthestDistanceM ?? null,
      lmrProximityScreen: snap?.proximityScreen ?? null,
      lmrProximityLabel: snap?.proximityLabel ?? null,
      heightLimitM,
      heightSource,
    };
  }

  return {
    siteAreaSqm,
    siteAreaSource,
    fsr: officialFsr,
    fsrSource: "OFFICIAL",
    yieldStatus: "CALCULABLE",
    fsrCertainty: "OFFICIAL_LEP",
    lepFsr: officialFsr,
    statePathwayFsr: null,
    statePathwayName: null,
    lmrCentreName: null,
    lmrNearestDistanceM: null,
    lmrFurthestDistanceM: null,
    lmrProximityScreen: null,
    lmrProximityLabel: null,
    heightLimitM,
    heightSource,
  };
}

function resolveUnitMix(inputs: OpportunityInputs, saleableArea: number, priceScale = 1): UnitMixRow[] {
  const raw = inputs.unitMix?.length ? inputs.unitMix : autoGenerateUnitMix(saleableArea, defaultUnitMix(), inputs.mixShares);
  return raw.map((r) => ({ ...r, salePricePerUnit: r.salePricePerUnit * priceScale }));
}

function runScenario(
  key: ScenarioKey,
  site: SiteBasis,
  lotCount: number,
  combinedExistingValue: number,
  a: Assumptions,
  adj: ScenarioAdjustment,
  inputs: OpportunityInputs,
): ScenarioResult {
  const sa = applyScenario(a, adj);
  const fsr = site.fsr * (1 + adj.fsrPct);
  const yProbe = computeYield({
    siteAreaSqm: site.siteAreaSqm,
    fsr,
    efficiency: sa.efficiency,
    siteCoverage: sa.siteCoverage,
    floorToFloorM: sa.floorToFloorM,
    avgDwellingSizeSqm: sa.avgDwellingSizeSqm,
    carSpacesPerDwelling: sa.carSpacesPerDwelling,
    heightLimitM: site.heightLimitM,
    planningAdjustment: sa.planningAdjustment,
    achievableGfaOverride: inputs.achievableGfaOverride,
  });
  const unitMix = resolveUnitMix(inputs, yProbe.saleableArea, 1 + adj.salePricePct);
  const mixTotals = computeUnitMix(unitMix);
  const y = computeYield({
    siteAreaSqm: site.siteAreaSqm,
    fsr,
    efficiency: sa.efficiency,
    siteCoverage: sa.siteCoverage,
    floorToFloorM: sa.floorToFloorM,
    avgDwellingSizeSqm: sa.avgDwellingSizeSqm,
    carSpacesPerDwelling: sa.carSpacesPerDwelling,
    heightLimitM: site.heightLimitM,
    planningAdjustment: sa.planningAdjustment,
    achievableGfaOverride: inputs.achievableGfaOverride,
    unitCountOverride: sa.revenueMode === "UNIT_MIX" && mixTotals.totalUnits > 0 ? mixTotals.totalUnits : null,
    saleableAreaOverride: sa.revenueMode === "UNIT_MIX" && mixTotals.totalSaleableArea > 0 ? mixTotals.totalSaleableArea : null,
  });
  const f = computeFeasibility({
    gfa: y.achievableGfa,
    saleableArea: y.saleableArea,
    dwellings: y.dwellings,
    lotCount,
    unitMix: sa.revenueMode === "UNIT_MIX" ? unitMix : undefined,
    a: sa,
  });
  const existing = combinedExistingValue * (1 + (adj.existingValuePct ?? 0));
  const head = acquisitionHeadroom(f.maxAcquisitionBudget, existing);
  return {
    key,
    adjustment: adj,
    assumptions: sa,
    fsr,
    yield: y,
    feasibility: f,
    combinedExistingValue: existing,
    maxPayableToOwners: f.maxPayableToOwners,
    acquisitionHeadroom: head.acquisitionHeadroom,
    acquisitionHeadroomPercent: head.acquisitionHeadroomPercent,
  };
}

/** Full opportunity analysis — pure, shared by API (persisted summary) and UI (live recalculation). */
export function analyseOpportunity(allLots: OpportunityLot[], a: Assumptions, inputs: OpportunityInputs, adjacency?: Adjacency): OpportunityAnalysis {
  const lots = allLots.filter((l) => l.included);
  const adj = adjacency ?? buildAdjacency(allLots.map((l) => ({ id: l.id, geometry: l.geometry })));
  const site = siteBasis(lots, a, inputs);
  const combinedMarketValue = lots.reduce((s, l) => s + (l.marketValue ?? 0), 0);
  const marketValueComplete = lots.length > 0 && lots.every((l) => (l.marketValue ?? 0) > 0);
  const metricsProbe = computeAssemblyMetrics(lots, a, adj);
  const unitMix = resolveUnitMix(inputs, metricsProbe.saleableArea);
  const metrics = computeAssemblyMetrics(lots, a, adj, a.revenueMode === "UNIT_MIX" ? unitMix : undefined);

  // Max payable comes from development feasibility — independent of existing property values.
  const scenarios = {
    BASE: runScenario("BASE", site, lots.length, marketValueComplete ? combinedMarketValue : 0, a, inputs.scenarios.BASE, inputs),
    UPSIDE: runScenario("UPSIDE", site, lots.length, marketValueComplete ? combinedMarketValue : 0, a, inputs.scenarios.UPSIDE, inputs),
    DOWNSIDE: runScenario("DOWNSIDE", site, lots.length, marketValueComplete ? combinedMarketValue : 0, a, inputs.scenarios.DOWNSIDE, inputs),
  };
  const base = scenarios.BASE;
  const feasibilityCalculable = site.yieldStatus === "CALCULABLE";
  // Do not clamp negative residual to $0 when yield ran — that hides “uneconomic”.
  // When yield is not calculable, budget/headroom must stay non-decision numbers.
  const budget = feasibilityCalculable ? base.feasibility.maxAcquisitionBudget : 0;
  const existingValue = marketValueComplete ? combinedMarketValue : null;
  const head =
    feasibilityCalculable && existingValue != null ? acquisitionHeadroom(budget, existingValue) : null;
  const valuation = feasibilityCalculable
    ? summariseAssemblyValuation(lots, budget, a.existingValuePerSqm)
    : {
        ...summariseAssemblyValuation(lots, 0, a.existingValuePerSqm),
        headroomMid: null,
        headroomLow: null,
        headroomHigh: null,
        viability: "REQUIRES_PLANNING_INPUT" as const,
      };
  // Critical first (for allocation weights), then allocate, then marginal.
  const baseEcon: Economics = {
    areaSqm: site.siteAreaSqm,
    gfa: base.yield.achievableGfa,
    budget,
    grv: base.feasibility.grv,
    headroom: head?.acquisitionHeadroom ?? 0,
  };
  const parcelArea = lots.reduce((s, l) => s + l.areaSqm, 0) || 1;
  const economicsFor = (ids: string[]): Economics => {
    const subset = lots.filter((l) => ids.includes(l.id));
    const subArea = subset.reduce((s, l) => s + l.areaSqm, 0);
    const scaledSite: SiteBasis = {
      ...siteBasis(subset, a, { ...inputs, siteAreaOverride: null, fsrOverride: inputs.fsrOverride, heightOverrideM: inputs.heightOverrideM }),
      siteAreaSqm: (site.siteAreaSqm * subArea) / parcelArea,
    };
    const subComplete = subset.every((l) => (l.marketValue ?? 0) > 0);
    const subMv = subset.reduce((s, l) => s + (l.marketValue ?? 0), 0);
    const r = runScenario("BASE", scaledSite, subset.length, subComplete ? subMv : 0, a, inputs.scenarios.BASE, inputs);
    return {
      areaSqm: scaledSite.siteAreaSqm,
      gfa: r.yield.achievableGfa,
      budget: r.feasibility.maxAcquisitionBudget,
      grv: r.feasibility.grv,
      headroom: subComplete ? r.acquisitionHeadroom : 0,
    };
  };
  const critical = analyseCriticalLots(
    lots.map((l) => ({ id: l.id, areaSqm: l.areaSqm, marketValue: l.marketValue ?? null })),
    adj,
    baseEcon,
    economicsFor,
    { minViableSiteAreaSqm: a.minViableSiteAreaSqm },
  );
  const critById = new Map(critical.map((c) => [c.id, c]));

  const allocation = allocateOffers(
    budget,
    lots.map((l) => {
      const c = critById.get(l.id);
      return {
        id: l.id,
        marketValue: l.marketValue ?? null,
        areaSqm: l.areaSqm,
        maxOverride: l.maxAllocationOverride,
        openingOverride: l.openingOfferOverride,
        criticalityScore: c ? (c.status === "CRITICAL" ? 1 : 0.2) + (c.connector ? 0.3 : 0) : 0,
        connectivityScore: c?.degree ?? 0,
        strategicWeight: l.strategicWeight ?? null,
      };
    }),
    a.openingOfferPct,
    a.existingValuePerSqm,
    { marketValueWeight: a.marketValueWeight, criticalityWeight: a.criticalityWeight, connectivityWeight: a.connectivityWeight },
  );

  const baseMarginal: MarginalLotEconomics = {
    areaSqm: site.siteAreaSqm,
    theoreticalGfa: base.yield.theoreticalGfa,
    achievableGfa: base.yield.achievableGfa,
    grv: base.feasibility.grv,
    maxPayable: budget,
    combinedExistingValue: existingValue ?? 0,
    acquisitionHeadroom: head?.acquisitionHeadroom ?? 0,
  };
  const marginal = analyseMarginalLots(
    lots.map((l) => ({ id: l.id, marketValue: l.marketValue ?? null, label: l.label })),
    baseMarginal,
    (id) => {
      const e = economicsFor(lots.filter((l) => l.id !== id).map((l) => l.id));
      return {
        areaSqm: e.areaSqm,
        theoreticalGfa: e.gfa / (a.planningAdjustment || 1),
        achievableGfa: e.gfa,
        grv: e.grv ?? 0,
        maxPayable: e.budget,
        combinedExistingValue: Math.max(0, (existingValue ?? 0) - (lots.find((l) => l.id === id)?.marketValue ?? 0)),
        acquisitionHeadroom: e.headroom ?? 0,
      };
    },
    { improvesConnectivity: (id) => critById.get(id)?.connector === true || (critById.get(id)?.degree ?? 0) >= 2 },
  );

  metrics.criticalLotCount = critical.filter((c) => c.status === "CRITICAL").length;
  // Refresh headroom fields on metrics from base analysis — never from suburb fallback.
  metrics.acquisitionHeadroom = head?.acquisitionHeadroom ?? null;
  metrics.acquisitionHeadroomPercent = head?.acquisitionHeadroomPercent ?? null;
  metrics.assemblyUplift = head?.assemblyUplift ?? null;
  metrics.financialValuationAvailable = marketValueComplete;
  metrics.maxPayableToOwners = budget;
  metrics.indicativeBudget = budget;
  metrics.grv = base.feasibility.grv;
  metrics.profit = base.feasibility.profit;
  metrics.marginOnCost = base.feasibility.marginOnCost;
  metrics.theoreticalGfa = base.yield.theoreticalGfa;
  metrics.achievableGfa = base.yield.achievableGfa;
  metrics.saleableArea = base.yield.saleableArea;
  metrics.dwellings = base.yield.dwellings;
  metrics.combinedValue = existingValue ?? 0;
  metrics.combinedValueEstimated = !marketValueComplete;
  metrics.upliftRatio = existingValue != null && existingValue > 0 ? budget / existingValue : 0;

  const score = scoreAssembly(metrics, a);
  const allocById = new Map(allocation.lots.map((l) => [l.id, l]));
  const strategy = buildAcquisitionSequence(
    lots.map((l) => ({ id: l.id, label: l.label, areaSqm: l.areaSqm, maximumPremium: allocById.get(l.id)?.maximumPremium ?? null })),
    critical,
  );

  const viability: AcquisitionViability = !feasibilityCalculable
    ? "REQUIRES_PLANNING_INPUT"
    : valuation.viability;

  const planningConclusion =
    site.fsrSource === "NO_MAPPED"
      ? "REQUIRES_CONFIRMATION"
      : site.fsrSource === "STATE_PATHWAY"
        ? site.fsrCertainty === "REQUIRES_PLANNING_CONFIRMATION"
          ? "REQUIRES_CONFIRMATION"
          : "MODELLED_PATHWAY"
        : "LEP_CONTROLS";
  const economicsConclusion = !feasibilityCalculable
    ? "NOT_CALCULABLE"
    : viability === "LIKELY_VIABLE"
      ? "VIABLE"
      : viability === "MARGINAL"
        ? "MARGINAL"
        : "UNECONOMIC";
  const conclusionSummary = !feasibilityCalculable
    ? "FEASIBILITY NOT YET CALCULABLE — no mapped LEP FSR and no modelled State pathway applied. Missing FSR is not FSR 0:1."
    : economicsConclusion === "UNECONOMIC" && existingValue != null
      ? `DEVELOPABLE UNDER MODELLED CONTROLS BUT UNECONOMIC — existing ~$${Math.round(existingValue / 1e5) / 10}m vs max payable ~$${Math.round(budget / 1e5) / 10}m.`
      : economicsConclusion === "VIABLE"
        ? "Modelled pathway looks financially workable under current assumptions."
        : economicsConclusion === "MARGINAL"
          ? "Modelled pathway is marginal under current assumptions."
          : "Review planning confirmation and assumptions before acquisition.";

  return {
    includedIds: lots.map((l) => l.id),
    excludedIds: allLots.filter((l) => !l.included).map((l) => l.id),
    metrics,
    score,
    site,
    scenarios,
    base,
    combinedMarketValue,
    combinedExistingValue: existingValue,
    marketValueComplete,
    screeningExistingValue: valuation.screeningMid,
    valuation,
    viability,
    feasibilityCalculable,
    maxPayableToOwners: budget,
    acquisitionHeadroom: head?.acquisitionHeadroom ?? null,
    acquisitionHeadroomPercent: head?.acquisitionHeadroomPercent ?? null,
    assemblyPremium: head?.acquisitionHeadroom ?? null,
    assemblyUplift: head?.assemblyUplift ?? null,
    unitMix,
    priceTests: {
      atMarketValue: testPurchasePrice(base.feasibility, existingValue ?? 0),
      atOpeningOffers: testPurchasePrice(base.feasibility, allocation.totalOpening),
      atMaximum: testPurchasePrice(base.feasibility, allocation.totalMaximum),
    },
    allocation,
    critical,
    marginal,
    strategy,
    conclusion: {
      planning: planningConclusion,
      economics: economicsConclusion,
      summary: conclusionSummary,
    },
  };
}
