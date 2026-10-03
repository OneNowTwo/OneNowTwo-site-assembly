import { defaultUnitMix, type Assumptions } from "./assumptions";
import { autoGenerateUnitMix, computeUnitMix, type UnitMixRow } from "./unit-mix";
import { computeYield } from "./yield";
import { acquisitionHeadroom, computeFeasibility } from "./feasibility";
import { type Adjacency, isConnected } from "./geometry";
import type { FsrControl, FsrMappedStatus } from "@/lib/types";

export interface AnalysisLot {
  id: string;
  label: string;
  areaSqm: number;
  zone: string | null;
  zoneName: string | null;
  fsr: number | null;
  /** Official FSR controls from NSW Planning Portal intersection (when known). */
  fsrStatus?: FsrMappedStatus | null;
  fsrControls?: FsrControl[] | null;
  heightM: number | null;
  minLotSizeSqm: number | null;
  heritage: string | null;
  isStrata: boolean;
  planningKnown: boolean;
  marketValue?: number | null;
}

/** Zones where an assembled residential redevelopment is not realistic; excluded from automatic assembly. */
export const NON_DEVELOPABLE_ZONES = /^(RE\d|SP\d|C\d|W\d|RU\d|IN\d|E3|E4|E5|UR|DM)$/;
/** Zones that typically permit residential flat buildings or shop-top housing. */
export const APARTMENT_ZONES = /^(R1|R3|R4|MU1|MU|E1|E2|B\d)$/;

export function hasHeritage(h: string | null): boolean {
  return !!h && h !== "None mapped";
}
export function isHeritageItem(h: string | null): boolean {
  return hasHeritage(h) && /item/i.test(h!);
}

/**
 * Official theoretical GFA for one parcel from mapped FSR controls only.
 * Split parcels: Σ (intersection area × FSR). Unmapped residual contributes 0.
 * No silent generic fallback.
 */
export function officialParcelTheoreticalGfa(l: Pick<AnalysisLot, "areaSqm" | "fsr" | "fsrControls">): number {
  if (l.fsrControls && l.fsrControls.length > 0) {
    return l.fsrControls.reduce((s, c) => s + c.intersectionAreaSqm * c.fsr, 0);
  }
  if (l.fsr != null) return l.areaSqm * l.fsr;
  return 0;
}

/**
 * FSR used for analysis.
 * - OFFICIAL: mapped NSW EPI FSR (or weighted equivalent of split controls).
 * - HEIGHT_ESTIMATE / FALLBACK: only when `allowAssumption` is true (explicit discovery aid / labelled user path).
 * - NO_MAPPED: no official polygon intersects; fsr is 0 for official GFA maths.
 */
export function effectiveFsr(
  l: Pick<AnalysisLot, "fsr" | "heightM" | "zone" | "fsrControls">,
  a: Pick<Assumptions, "fallbackFsr" | "floorToFloorM" | "siteCoverage">,
  opts?: { allowAssumption?: boolean },
): { fsr: number; basis: "OFFICIAL" | "HEIGHT_ESTIMATE" | "FALLBACK" | "NO_MAPPED" } {
  if (l.fsrControls && l.fsrControls.length > 0) {
    if (l.fsr != null) return { fsr: l.fsr, basis: "OFFICIAL" };
    const gfa = l.fsrControls.reduce((s, c) => s + c.intersectionAreaSqm * c.fsr, 0);
    const area = l.fsrControls.reduce((s, c) => s + c.intersectionAreaSqm, 0);
    if (area > 0) return { fsr: Math.round((gfa / area) * 1000) / 1000, basis: "OFFICIAL" };
  }
  if (l.fsr != null) return { fsr: l.fsr, basis: "OFFICIAL" };
  if (!opts?.allowAssumption) return { fsr: 0, basis: "NO_MAPPED" };
  if (l.heightM != null && l.zone && APARTMENT_ZONES.test(l.zone)) {
    const storeys = Math.max(1, Math.floor(l.heightM / a.floorToFloorM));
    return { fsr: Math.round(storeys * a.siteCoverage * 100) / 100, basis: "HEIGHT_ESTIMATE" };
  }
  return { fsr: a.fallbackFsr, basis: "FALLBACK" };
}

export function isDevelopableLot(l: AnalysisLot): boolean {
  if (l.areaSqm < 80) return false;
  if (l.zone && NON_DEVELOPABLE_ZONES.test(l.zone)) return false;
  return true;
}

export interface AssemblyMetrics {
  lotIds: string[];
  lotCount: number;
  totalAreaSqm: number;
  zones: string[];
  zoneCompatible: boolean;
  /** Equivalent assembly FSR = official theoretical GFA ÷ site area (0 when no mapped FSR). */
  weightedFsr: number;
  /** True when at least one lot has no official mapped FSR. */
  fsrEstimated: boolean;
  /** Lots with no official mapped FSR control. */
  fsrUnmappedLots: number;
  /** Lots with split official FSR controls. */
  fsrSplitLots: number;
  heightMinM: number | null;
  heightMaxM: number | null;
  heritageLots: number;
  heritageItems: number;
  strataLots: number;
  minLotSizeIssues: string[];
  theoreticalGfa: number;
  achievableGfa: number;
  saleableArea: number;
  gfa: number;
  dwellings: number;
  grv: number;
  owners: number;
  combinedValue: number;
  combinedValueEstimated: boolean;
  /** Maximum payable to owners. */
  indicativeBudget: number;
  maxPayableToOwners: number;
  acquisitionHeadroom: number;
  acquisitionHeadroomPercent: number | null;
  assemblyUplift: number;
  profit: number;
  marginOnCost: number;
  upliftRatio: number;
  planningUnknownLots: number;
  connected: boolean;
  criticalLotCount: number;
}

export function computeAssemblyMetrics(lots: AnalysisLot[], a: Assumptions, adj?: Adjacency, unitMix?: UnitMixRow[]): AssemblyMetrics {
  const totalAreaSqm = lots.reduce((s, l) => s + l.areaSqm, 0);
  const zones = [...new Set(lots.map((l) => l.zone ?? "Unknown"))];
  const fsrUnmappedLots = lots.filter((l) => l.fsr == null && !(l.fsrControls && l.fsrControls.length)).length;
  const fsrSplitLots = lots.filter((l) => l.fsrStatus === "SPLIT" || (l.fsrControls != null && l.fsrControls.length > 1)).length;
  const fsrEstimated = fsrUnmappedLots > 0;
  // Per-parcel official FSR × area — never a silent generic fallback.
  const theoreticalFromLots = lots.reduce((s, l) => s + officialParcelTheoreticalGfa(l), 0);
  const weightedFsr = totalAreaSqm > 0 ? theoreticalFromLots / totalAreaSqm : 0;
  const heights = lots.map((l) => l.heightM).filter((h): h is number => h != null);
  const minLotSizes = lots.map((l) => l.minLotSizeSqm).filter((m): m is number => m != null);
  const minLotSizeIssues: string[] = [];
  const maxMinLot = minLotSizes.length ? Math.max(...minLotSizes) : null;
  if (maxMinLot != null && totalAreaSqm < maxMinLot) minLotSizeIssues.push(`Combined area below ${maxMinLot.toLocaleString("en-AU")} sqm minimum lot size`);
  const valueEstimated = lots.some((l) => !(l.marketValue && l.marketValue > 0));
  const combinedValue = lots.reduce((s, l) => s + (l.marketValue && l.marketValue > 0 ? l.marketValue : l.areaSqm * a.existingValuePerSqm), 0);
  const heightLimitM = heights.length ? Math.min(...heights) : null;
  const yProbe = computeYield({
    siteAreaSqm: totalAreaSqm,
    fsr: weightedFsr,
    efficiency: a.efficiency,
    siteCoverage: a.siteCoverage,
    floorToFloorM: a.floorToFloorM,
    avgDwellingSizeSqm: a.avgDwellingSizeSqm,
    carSpacesPerDwelling: a.carSpacesPerDwelling,
    heightLimitM,
    planningAdjustment: a.planningAdjustment,
  });
  // Same UNIT_MIX path as Opportunity analyseOpportunity/runScenario — one financial engine.
  let resolvedMix = unitMix;
  if (!resolvedMix && a.revenueMode === "UNIT_MIX") {
    resolvedMix = autoGenerateUnitMix(yProbe.saleableArea, defaultUnitMix());
  }
  const mixTotals = resolvedMix && a.revenueMode === "UNIT_MIX" ? computeUnitMix(resolvedMix) : null;
  const y = computeYield({
    siteAreaSqm: totalAreaSqm,
    fsr: weightedFsr,
    efficiency: a.efficiency,
    siteCoverage: a.siteCoverage,
    floorToFloorM: a.floorToFloorM,
    avgDwellingSizeSqm: a.avgDwellingSizeSqm,
    carSpacesPerDwelling: a.carSpacesPerDwelling,
    heightLimitM,
    planningAdjustment: a.planningAdjustment,
    unitCountOverride: mixTotals && mixTotals.totalUnits > 0 ? mixTotals.totalUnits : null,
    saleableAreaOverride: mixTotals && mixTotals.totalSaleableArea > 0 ? mixTotals.totalSaleableArea : null,
  });
  const f = computeFeasibility({
    gfa: y.achievableGfa,
    saleableArea: y.saleableArea,
    dwellings: y.dwellings,
    lotCount: lots.length,
    unitMix: a.revenueMode === "UNIT_MIX" ? resolvedMix : unitMix,
    a,
  });
  const headroom = acquisitionHeadroom(f.maxAcquisitionBudget, combinedValue);
  return {
    lotIds: lots.map((l) => l.id),
    lotCount: lots.length,
    totalAreaSqm,
    zones,
    zoneCompatible: zones.length === 1 && zones[0] !== "Unknown",
    weightedFsr,
    fsrEstimated,
    fsrUnmappedLots,
    fsrSplitLots,
    heightMinM: heights.length ? Math.min(...heights) : null,
    heightMaxM: heights.length ? Math.max(...heights) : null,
    heritageLots: lots.filter((l) => hasHeritage(l.heritage)).length,
    heritageItems: lots.filter((l) => isHeritageItem(l.heritage)).length,
    strataLots: lots.filter((l) => l.isStrata).length,
    minLotSizeIssues,
    theoreticalGfa: y.theoreticalGfa,
    achievableGfa: y.achievableGfa,
    saleableArea: y.saleableArea,
    gfa: y.achievableGfa,
    dwellings: y.dwellings,
    grv: f.grv,
    owners: lots.length,
    combinedValue,
    combinedValueEstimated: valueEstimated,
    indicativeBudget: f.maxAcquisitionBudget,
    maxPayableToOwners: f.maxAcquisitionBudget,
    acquisitionHeadroom: headroom.acquisitionHeadroom,
    acquisitionHeadroomPercent: headroom.acquisitionHeadroomPercent,
    assemblyUplift: headroom.assemblyUplift,
    profit: f.profit,
    marginOnCost: f.marginOnCost,
    upliftRatio: combinedValue > 0 ? f.maxAcquisitionBudget / combinedValue : 0,
    planningUnknownLots: lots.filter((l) => !l.planningKnown).length,
    connected: adj ? isConnected(
      lots.map((l) => l.id),
      adj,
    ) : true,
    criticalLotCount: 0,
  };
}

/**
 * Scoring heavily rewards acquisition headroom and assembly uplift (brief §19).
 * Weights are transparent and not hard-coded forever — exposed as SCORE_WEIGHTS.
 */
export const SCORE_WEIGHTS = {
  acquisitionHeadroom: 0.3,
  developmentUplift: 0.2,
  planningCapacity: 0.15,
  simplicity: 0.15,
  geometry: 0.1,
  planningRisk: 0.1,
} as const;

export interface ScoreFactor {
  sign: "+" | "-";
  text: string;
}
export interface OpportunityScore {
  score: number;
  components: Record<keyof typeof SCORE_WEIGHTS, number>;
  factors: ScoreFactor[];
  weights: typeof SCORE_WEIGHTS;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const sqm = (n: number) => `${Math.round(n).toLocaleString("en-AU")} sqm`;
const words = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight"];
const count = (n: number, noun: string) => `${words[n] ?? n} ${noun}${n === 1 ? "" : "s"}`;

/** Transparent 0–100 score: weighted rule-based components with the reasons that drove them. */
export function scoreAssembly(m: AssemblyMetrics, a: Assumptions): OpportunityScore {
  const factors: ScoreFactor[] = [];

  // Acquisition headroom $ — primary ranking signal
  const headroomScore = clamp01(m.acquisitionHeadroom / 8_000_000) * 70 + clamp01((m.acquisitionHeadroomPercent ?? 0) / 1.5) * 30;
  if (m.acquisitionHeadroom >= 1_000_000) {
    factors.push({
      sign: "+",
      text: `acquisition headroom $${(m.acquisitionHeadroom / 1e6).toFixed(1)}m (${m.acquisitionHeadroomPercent != null ? `${Math.round(m.acquisitionHeadroomPercent * 100)}%` : "—"} over existing value)`,
    });
  } else {
    factors.push({ sign: "-", text: `acquisition headroom only $${(m.acquisitionHeadroom / 1e6).toFixed(2)}m — limited room to overpay` });
  }

  const developmentUplift = clamp01((m.upliftRatio - 0.9) / (1.8 - 0.9)) * 100;
  if (m.upliftRatio >= 1.15)
    factors.push({
      sign: "+",
      text: `max payable ${m.upliftRatio.toFixed(1)}× existing property value${m.combinedValueEstimated ? " (estimated)" : ""}`,
    });
  else factors.push({ sign: "-", text: `max payable only ${m.upliftRatio.toFixed(2)}× existing value — little assembly uplift` });

  const planningCapacity = clamp01(m.weightedFsr / 2) * 80 + clamp01((m.heightMinM ?? 0) / 24) * 20;
  const fsrText =
    m.fsrUnmappedLots > 0
      ? `official FSR ${m.weightedFsr.toFixed(2)}:1 (${m.fsrUnmappedLots} lot${m.fsrUnmappedLots === 1 ? "" : "s"} with no mapped FSR)`
      : `official FSR ${m.weightedFsr.toFixed(2)}:1`;
  if (m.weightedFsr >= 1.2) factors.push({ sign: "+", text: `${fsrText} — ${Math.round(m.achievableGfa).toLocaleString("en-AU")} sqm achievable GFA` });
  else factors.push({ sign: "-", text: `${fsrText} limits apartment yield` });
  if (m.fsrSplitLots > 0) factors.push({ sign: "-", text: `${count(m.fsrSplitLots, "lot")} with split mapped FSR controls` });
  if (m.heightMinM != null && m.heightMinM >= 15) factors.push({ sign: "+", text: `${m.heightMinM} m height control` });

  let simplicity = 100 - (m.lotCount - 2) * 15 - m.strataLots * 25;
  simplicity = Math.max(0, Math.min(100, simplicity));
  if (m.lotCount <= 3) factors.push({ sign: "+", text: `only ${count(m.lotCount, "owner")} to negotiate` });
  else if (m.lotCount >= 5) factors.push({ sign: "-", text: `${count(m.lotCount, "owner")} to negotiate` });
  if (m.strataLots) {
    factors.push({ sign: "-", text: `${count(m.strataLots, "strata scheme")} (collective sale required)` });
    simplicity = Math.max(0, simplicity - 20 * m.strataLots);
  }
  if (m.totalAreaSqm >= a.minViableSiteAreaSqm) factors.push({ sign: "+", text: `${sqm(m.totalAreaSqm)} combined site` });
  else factors.push({ sign: "-", text: `${sqm(m.totalAreaSqm)} is below the ${sqm(a.minViableSiteAreaSqm)} minimum viable site` });

  let geometry = m.connected ? 85 : 20;
  if (!m.connected) factors.push({ sign: "-", text: "lots are not contiguous" });
  else factors.push({ sign: "+", text: "contiguous assembled site" });
  geometry = clamp01(geometry / 100) * 100;

  let planningRisk = 100;
  if (m.heritageItems) {
    planningRisk -= 50 * m.heritageItems;
    factors.push({ sign: "-", text: `${count(m.heritageItems, "heritage item")}` });
  }
  const conservation = m.heritageLots - m.heritageItems;
  if (conservation) {
    planningRisk -= 25 * conservation;
    factors.push({ sign: "-", text: `${count(conservation, "lot")} in a heritage conservation area` });
  }
  const lowDensity = m.zones.filter((z) => z !== "Unknown" && !APARTMENT_ZONES.test(z));
  if (lowDensity.length) {
    planningRisk -= 30;
    factors.push({ sign: "-", text: `${lowDensity.join(", ")} zoning generally does not permit apartments` });
  }
  if (!m.zoneCompatible) {
    planningRisk -= 25;
    factors.push({ sign: "-", text: `mixed or unknown zoning (${m.zones.join(", ")})` });
  } else factors.push({ sign: "+", text: `consistent ${m.zones[0]} zoning` });
  if (m.planningUnknownLots) {
    planningRisk -= 20;
    factors.push({ sign: "-", text: `planning data unavailable for ${count(m.planningUnknownLots, "lot")}` });
  }
  if (m.fsrUnmappedLots) {
    planningRisk -= 15;
    factors.push({ sign: "-", text: `no mapped FSR control for ${count(m.fsrUnmappedLots, "lot")} — enter a USER ASSUMPTION to model yield` });
  }
  for (const issue of m.minLotSizeIssues) {
    planningRisk -= 20;
    factors.push({ sign: "-", text: issue });
  }
  planningRisk = Math.max(0, planningRisk);

  const components = {
    acquisitionHeadroom: headroomScore,
    developmentUplift,
    planningCapacity,
    simplicity,
    geometry,
    planningRisk,
  };
  const score = Math.round((Object.keys(SCORE_WEIGHTS) as (keyof typeof SCORE_WEIGHTS)[]).reduce((s, k) => s + components[k] * SCORE_WEIGHTS[k], 0));
  return { score, components, factors, weights: SCORE_WEIGHTS };
}

export interface AssemblyCandidate {
  key: string;
  lotIds: string[];
  metrics: AssemblyMetrics;
  score: OpportunityScore;
}

export interface GenerateOptions {
  minSize?: number;
  maxSize?: number;
  /** Subsets kept per size level — bounds the search to O(maxSize × beam × degree). */
  beamWidth?: number;
  maxResults?: number;
  /** Sort key for ranking candidates (default score). */
  sortBy?: "score" | "headroom" | "profit" | "owners" | "area" | "moc";
}

function sortCandidates(list: AssemblyCandidate[], sortBy: GenerateOptions["sortBy"] = "score"): AssemblyCandidate[] {
  const cmp = (x: AssemblyCandidate, y: AssemblyCandidate) => {
    switch (sortBy) {
      case "headroom":
        return y.metrics.acquisitionHeadroom - x.metrics.acquisitionHeadroom;
      case "profit":
        return y.metrics.profit - x.metrics.profit;
      case "owners":
        return x.metrics.owners - y.metrics.owners || y.metrics.acquisitionHeadroom - x.metrics.acquisitionHeadroom;
      case "area":
        return y.metrics.totalAreaSqm - x.metrics.totalAreaSqm;
      case "moc":
        return y.metrics.marginOnCost - x.metrics.marginOnCost;
      default:
        return y.score.score - x.score.score || y.metrics.acquisitionHeadroom - x.metrics.acquisitionHeadroom;
    }
  };
  return [...list].sort(cmp);
}

/**
 * Connected assemblies of 2..maxSize lots containing `startId`, grown one neighbour at a time.
 * A beam keeps the best `beamWidth` subsets at each size so combinations never explode.
 */
export function generateAssemblies(
  lots: AnalysisLot[],
  adj: Adjacency,
  startId: string,
  a: Assumptions,
  opts: GenerateOptions = {},
): AssemblyCandidate[] {
  const minSize = opts.minSize ?? 2;
  const maxSize = Math.min(opts.maxSize ?? a.maxAssemblySize, 8);
  const beamWidth = opts.beamWidth ?? 40;
  const maxResults = opts.maxResults ?? 8;
  const byId = new Map(lots.map((l) => [l.id, l]));
  if (!byId.has(startId)) return [];
  // Strata schemes need a collective sale, so automatic expansion only uses ordinary lots.
  const eligible = (id: string) => {
    const l = byId.get(id);
    return !!l && isDevelopableLot(l) && !l.isStrata;
  };

  const all = new Map<string, AssemblyCandidate>();
  let frontier: string[][] = [[startId]];
  for (let size = 2; size <= maxSize; size++) {
    const next = new Map<string, AssemblyCandidate>();
    for (const subset of frontier) {
      const members = new Set(subset);
      for (const id of subset) {
        for (const n of adj.get(id) ?? []) {
          if (members.has(n) || !eligible(n)) continue;
          const ids = [...subset, n].sort();
          const key = ids.join("|");
          if (next.has(key) || all.has(key)) continue;
          const group = ids.map((i) => byId.get(i)!);
          const metrics = computeAssemblyMetrics(group, a, adj);
          next.set(key, { key, lotIds: ids, metrics, score: scoreAssembly(metrics, a) });
        }
      }
    }
    if (!next.size) break;
    const ranked = sortCandidates([...next.values()], "score");
    for (const c of ranked) if (size >= minSize) all.set(c.key, c);
    frontier = ranked.slice(0, beamWidth).map((c) => c.lotIds);
  }

  const sorted = sortCandidates([...all.values()], opts.sortBy ?? "score");
  // Guarantee the best option of each size is offered before filling with near-duplicates.
  const picked = new Map<string, AssemblyCandidate>();
  const sizes = new Set<number>();
  for (const c of sorted) {
    if (!sizes.has(c.metrics.lotCount)) {
      sizes.add(c.metrics.lotCount);
      picked.set(c.key, c);
    }
  }
  for (const c of sorted) {
    if (picked.size >= maxResults) break;
    picked.set(c.key, c);
  }
  return sortCandidates([...picked.values()], opts.sortBy ?? "score").slice(0, maxResults);
}

/** Compare candidates for the Assembly Comparison screen. */
export function compareAssemblies(candidates: AssemblyCandidate[], sortBy: GenerateOptions["sortBy"] = "headroom"): AssemblyCandidate[] {
  return sortCandidates(candidates, sortBy);
}
