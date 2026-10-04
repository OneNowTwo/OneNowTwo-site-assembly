import type { Polygon, MultiPolygon } from "geojson";
import type { Assumptions, OpportunityInputs, ScenarioAdjustment } from "./assumptions";
import { defaultUnitMix } from "./assumptions";
import { computeYield, type YieldResult } from "./yield";
import { acquisitionHeadroom, computeFeasibility, testPurchasePrice, type FeasibilityResult, type PriceTest } from "./feasibility";
import { computeAssemblyMetrics, scoreAssembly, type AnalysisLot, type AssemblyMetrics, type OpportunityScore } from "./assembly";
import { allocateOffers, type AllocationResult } from "./allocation";
import { analyseCriticalLots, type CriticalLotResult, type Economics } from "./critical";
import { analyseMarginalLots, type MarginalLotResult, type MarginalLotEconomics } from "./marginal";
import { buildAcquisitionSequence, type StrategyStep } from "./strategy";
import { buildAdjacency, type Adjacency } from "./geometry";
import { autoGenerateUnitMix, computeUnitMix, type UnitMixRow } from "./unit-mix";
import { summariseAssemblyValuation, type AssemblyValuationSummary, type AcquisitionViability } from "./valuation";
import { resolvePlanning } from "@/lib/planning/resolve-planning";
import type { PlanningSnapshot } from "@/lib/planning/planning-snapshot";
import { calculationFromBase, type CalculationSnapshot } from "./calculation-snapshot";
import { acquisitionPropertyTotal, groupAcquisitionProperties } from "./acquisition-property";
import { assessEconomicConfidence, type EconomicConfidence } from "./economic-confidence";

export interface OpportunityLot extends AnalysisLot {
  externalParcelId?: string;
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
  /** Manual / researched owner name when known — never inferred from lot count. */
  ownerName?: string | null;
  planningInstrument?: string | null;
  planningCheckedAt?: string | null;
  /** Street address for acquisition-property grouping (shared address → one property). */
  address?: string | null;
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
export type SiteHeightSource = "OFFICIAL" | "OVERRIDE" | "STATE_PATHWAY" | "NONE";
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
  heightSource: SiteHeightSource;
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
  /**
   * Canonical planning position — Planning tab A/B/C, lot table, basis,
   * and the same effective FSR/height that drove Yield / Feasibility / score.
   * Only source of planning truth for the opportunity UI.
   */
  planningSnapshot: PlanningSnapshot;
  /** Canonical financial result from calculateOpportunity(PlanningSnapshot, …). */
  calculation: CalculationSnapshot;
  /** Data-quality confidence — distinct from opportunity score. */
  economicConfidence: EconomicConfidence;
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

/** @deprecated Independent siteBasis is de-authorised — use resolvePlanning → PlanningSnapshot. */
function siteBasisFromLots(lots: OpportunityLot[], inputs: OpportunityInputs): SiteBasis {
  const planning = resolvePlanning({
    lots: lots.map((l) => ({
      id: l.id,
      label: l.label,
      included: true,
      areaSqm: l.areaSqm,
      zone: l.zone,
      zoneName: l.zoneName,
      fsr: l.fsr,
      heightM: l.heightM,
      minLotSizeSqm: l.minLotSizeSqm,
      heritage: l.heritage,
      planningInstrument: l.planningInstrument ?? null,
      planningCheckedAt: l.planningCheckedAt ?? null,
    })),
    inputs,
  });
  return siteBasisFromPlanningSnapshot(planning, inputs);
}

/** Derive legacy SiteBasis view from the canonical PlanningSnapshot (not a second authority). */
export function siteBasisFromPlanningSnapshot(planning: PlanningSnapshot, inputs: OpportunityInputs): SiteBasis {
  const ec = planning.effectiveControls;
  const parcelArea = planning.lots.filter((l) => l.included).reduce((s, l) => s + l.areaSqm, 0);
  const calculable = ec.yieldStatus === "CALCULABLE" && (ec.effectiveFsr ?? 0) > 0;
  const lmr = planning.currentStatePathways.find((p) => p.kind === "LMR");
  return {
    siteAreaSqm: inputs.siteAreaOverride ?? parcelArea,
    siteAreaSource: inputs.siteAreaOverride ? "OVERRIDE" : "PARCELS",
    fsr: calculable ? (ec.effectiveFsr as number) : 0,
    fsrSource: ec.fsrSource,
    yieldStatus: ec.yieldStatus,
    fsrCertainty:
      ec.fsrSource === "STATE_PATHWAY"
        ? "REQUIRES_PLANNING_CONFIRMATION"
        : ec.fsrSource === "OFFICIAL"
          ? "OFFICIAL_LEP"
          : null,
    lepFsr: ec.baseFsr,
    statePathwayFsr: ec.stateFsr,
    statePathwayName: ec.statePathway,
    lmrCentreName: lmr?.centre ?? null,
    lmrNearestDistanceM: ec.proximityDistanceM,
    lmrFurthestDistanceM: ec.proximityDistanceMaxM,
    lmrProximityScreen:
      ec.fsrSource === "STATE_PATHWAY"
        ? "PASS"
        : ec.proximityBand === "OUTSIDE"
          ? "FAIL"
          : null,
    lmrProximityLabel: lmr ? (inputs.pathwaySnapshot?.proximityLabel ?? "PASS — ESTIMATED") : null,
    heightLimitM: ec.effectiveHeightM,
    heightSource:
      inputs.heightOverrideM != null
        ? "OVERRIDE"
        : ec.fsrSource === "STATE_PATHWAY" && ec.effectiveHeightM != null
          ? "STATE_PATHWAY"
          : ec.effectiveHeightM != null
            ? "OFFICIAL"
            : "NONE",
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

/**
 * Full opportunity analysis — thin orchestrator over the canonical pipeline:
 *   resolvePlanning → PlanningSnapshot
 *   calculateOpportunity(PlanningSnapshot, …) → CalculationSnapshot
 * Screens must consume planningSnapshot + calculation; site/metrics are derived views.
 */
export function analyseOpportunity(allLots: OpportunityLot[], a: Assumptions, inputs: OpportunityInputs, adjacency?: Adjacency): OpportunityAnalysis {
  const lots = allLots.filter((l) => l.included);
  const adj = adjacency ?? buildAdjacency(allLots.map((l) => ({ id: l.id, geometry: l.geometry })));

  const planningSnapshot = resolvePlanning({
    lots: allLots.map((l) => ({
      id: l.id,
      label: l.label,
      included: l.included,
      areaSqm: l.areaSqm,
      zone: l.zone,
      zoneName: l.zoneName,
      fsr: l.fsr,
      heightM: l.heightM,
      minLotSizeSqm: l.minLotSizeSqm,
      heritage: l.heritage,
      planningInstrument: l.planningInstrument ?? null,
      planningCheckedAt: l.planningCheckedAt ?? null,
    })),
    inputs,
  });
  const site = siteBasisFromPlanningSnapshot(planningSnapshot, inputs);
  const cadastralLotSumMid = lots.every((l) => (l.marketValue ?? 0) > 0)
    ? lots.reduce((s, l) => s + (l.marketValue as number), 0)
    : null;
  const acquisitionProperties = groupAcquisitionProperties(
    lots.map((l) => {
      const detail = inputs.lotValuationDetails?.[l.externalParcelId ?? l.id];
      const comps = (detail?.comps ?? []).map((c) => ({
        id: c.id,
        address: c.address,
        salePrice: c.salePrice,
        saleDate: c.saleDate,
        saleDateMs: c.saleDate ? Date.parse(c.saleDate) || null : null,
        landAreaSqm: c.landAreaSqm,
        distanceM: c.distanceM,
        strata: false,
        suburb: null as string | null,
        zone: l.zone ?? null,
        source: c.source,
        dealing: c.dealing ?? null,
      }));
      return {
        id: l.id,
        address: l.address ?? null,
        areaSqm: l.areaSqm,
        marketValue: l.marketValue ?? null,
        marketValueLow: l.marketValueLow ?? null,
        marketValueHigh: l.marketValueHigh ?? null,
        marketValueSource: l.marketValueSource ?? null,
        marketValueConfidence: l.marketValueConfidence ?? null,
        marketValueMethod: l.marketValueMethod ?? null,
        suburb: null,
        zone: l.zone ?? null,
        isStrata: l.isStrata,
        comps,
      };
    }),
  );
  // Prefer property-level acquisition value (shared address → one property, not sum of lot AVMs).
  const acqTotal = acquisitionPropertyTotal(acquisitionProperties);
  const hasSharedProperty = acquisitionProperties.some((p) => p.lotIds.length > 1);
  // A shared property estimate must enter economics once. Never fall back to summing
  // identical property-level values stamped on each cadastral parcel.
  const combinedMarketValue =
    acqTotal.mid ??
    (!hasSharedProperty ? (cadastralLotSumMid ?? lots.reduce((s, l) => s + (l.marketValue ?? 0), 0)) : 0);
  const marketValueComplete =
    acqTotal.complete || (!hasSharedProperty && lots.length > 0 && lots.every((l) => (l.marketValue ?? 0) > 0));

  // Allocate each acquisition-property estimate across its cadastral lots solely for
  // existing lot-level offer/criticality machinery. The allocations sum exactly to the
  // property value and are not presented as independent lot AVMs.
  const allocatedPropertyValues = new Map<
    string,
    { mid: number | null; low: number | null; high: number | null; shared: boolean }
  >();
  for (const property of acquisitionProperties) {
    const members = lots.filter((l) => property.lotIds.includes(l.id));
    const totalArea = members.reduce((sum, l) => sum + l.areaSqm, 0) || 1;
    for (const member of members) {
      const share = member.areaSqm / totalArea;
      allocatedPropertyValues.set(member.id, {
        mid: property.marketValue != null ? property.marketValue * share : null,
        low: property.marketValueLow != null ? property.marketValueLow * share : null,
        high: property.marketValueHigh != null ? property.marketValueHigh * share : null,
        shared: property.lotIds.length > 1,
      });
    }
  }
  const economicLots = lots.map((lot) => {
    const allocated = allocatedPropertyValues.get(lot.id);
    if (!allocated?.shared) return lot;
    return {
      ...lot,
      marketValue: allocated.mid,
      marketValueLow: allocated.low,
      marketValueHigh: allocated.high,
    };
  });
  // Probe saleable area from the SAME effective FSR used by yield/feasibility (not stale LEP-only metrics).
  const mixProbe = computeYield({
    siteAreaSqm: site.siteAreaSqm,
    fsr: site.fsr,
    efficiency: a.efficiency,
    siteCoverage: a.siteCoverage,
    floorToFloorM: a.floorToFloorM,
    avgDwellingSizeSqm: a.avgDwellingSizeSqm,
    carSpacesPerDwelling: a.carSpacesPerDwelling,
    heightLimitM: site.heightLimitM,
    planningAdjustment: a.planningAdjustment,
    achievableGfaOverride: inputs.achievableGfaOverride,
  });
  const unitMix = resolveUnitMix(inputs, site.yieldStatus === "CALCULABLE" ? mixProbe.saleableArea : 0);
  const metrics = computeAssemblyMetrics(economicLots, a, adj, a.revenueMode === "UNIT_MIX" ? unitMix : undefined);

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
    ? summariseAssemblyValuation(economicLots, budget, a.existingValuePerSqm)
    : {
        ...summariseAssemblyValuation(economicLots, 0, a.existingValuePerSqm),
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
    const subset = economicLots.filter((l) => ids.includes(l.id));
    const subArea = subset.reduce((s, l) => s + l.areaSqm, 0);
    const scaledSite: SiteBasis = {
      ...siteBasisFromLots(subset, { ...inputs, siteAreaOverride: null, fsrOverride: inputs.fsrOverride, heightOverrideM: inputs.heightOverrideM }),
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
    economicLots.map((l) => ({ id: l.id, areaSqm: l.areaSqm, marketValue: l.marketValue ?? null })),
    adj,
    baseEcon,
    economicsFor,
    { minViableSiteAreaSqm: a.minViableSiteAreaSqm },
  );
  const critById = new Map(critical.map((c) => [c.id, c]));

  const allocation = allocateOffers(
    budget,
    economicLots.map((l) => {
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
    economicLots.map((l) => ({ id: l.id, marketValue: l.marketValue ?? null, label: l.label })),
    baseMarginal,
    (id) => {
      const e = economicsFor(lots.filter((l) => l.id !== id).map((l) => l.id));
      return {
        areaSqm: e.areaSqm,
        theoreticalGfa: e.gfa / (a.planningAdjustment || 1),
        achievableGfa: e.gfa,
        grv: e.grv ?? 0,
        maxPayable: e.budget,
        combinedExistingValue: Math.max(0, (existingValue ?? 0) - (economicLots.find((l) => l.id === id)?.marketValue ?? 0)),
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
  // Metrics must reflect PlanningSnapshot effective controls — never LEP-unmapped → 0 as capacity.
  if (feasibilityCalculable && planningSnapshot.effectiveControls.effectiveFsr != null) {
    metrics.weightedFsr = planningSnapshot.effectiveControls.effectiveFsr;
    metrics.theoreticalGfa = base.yield.theoreticalGfa;
    metrics.fsrEstimated = false;
  } else if (planningSnapshot.effectiveControls.baseFsr == null) {
    // Unmapped ≠ 0 — leave weightedFsr unused for display; UI reads planningSnapshot.
    metrics.fsrEstimated = true;
  }
  if (planningSnapshot.effectiveControls.effectiveHeightM != null) {
    metrics.heightMinM = planningSnapshot.effectiveControls.effectiveHeightM;
    metrics.heightMaxM = planningSnapshot.effectiveControls.effectiveHeightM;
  }

  const ownerNames = lots
    .map((l) => l.ownerName?.trim() ?? "")
    .filter((n) => n.length > 0 && !/^unknown$/i.test(n) && !/^demo\s*[—-]\s*unknown$/i.test(n));
  const ownerCountKnown = ownerNames.length === lots.length && lots.length > 0;
  const ownerCount = ownerCountKnown ? new Set(ownerNames.map((n) => n.toLowerCase())).size : null;

  const score = scoreAssembly(metrics, a, {
    effectiveFsr: site.fsr,
    fsrSource: site.fsrSource,
    statePathwayName: site.statePathwayName,
    lepFsr: site.lepFsr,
    proximityLabel: site.lmrProximityLabel,
    ownerCountKnown,
    ownerCount,
  });
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

  const calculation = calculationFromBase({
    planning: planningSnapshot,
    siteAreaSqm: site.siteAreaSqm,
    theoreticalGfa: base.yield.theoreticalGfa,
    achievableGfa: base.yield.achievableGfa,
    saleableArea: base.yield.saleableArea,
    dwellings: base.yield.dwellings,
    grv: base.feasibility.grv,
    totalCost: base.feasibility.totalCost,
    maxPayable: budget,
    headroom: head?.acquisitionHeadroom ?? null,
    headroomPercent: head?.acquisitionHeadroomPercent ?? null,
    score: score.score,
  });

  const economicConfidence = assessEconomicConfidence({
    planning: planningSnapshot,
    assumptions: a,
    feasibility: base.feasibility,
    yield: base.yield,
    unitMix,
    acquisitionProperties,
    cadastralLotSumMid,
    overrides: inputs.overrides ?? {},
    exitPriceSources: inputs.exitPriceSources ?? {},
  });

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
    planningSnapshot,
    calculation,
    economicConfidence,
  };
}
