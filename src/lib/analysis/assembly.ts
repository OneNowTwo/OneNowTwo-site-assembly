import type { Assumptions } from "./assumptions";
import { computeYield } from "./yield";
import { computeFeasibility } from "./feasibility";
import { type Adjacency, isConnected } from "./geometry";

export interface AnalysisLot {
  id: string;
  label: string;
  areaSqm: number;
  zone: string | null;
  zoneName: string | null;
  fsr: number | null;
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
 * FSR used for analysis when the LEP maps none (e.g. North Sydney residential zones are height-controlled):
 * apartment-capable zones get a SYSTEM ESTIMATE of storeys under the height control × site coverage;
 * other zones get the fallback assumption.
 */
export function effectiveFsr(l: Pick<AnalysisLot, "fsr" | "heightM" | "zone">, a: Pick<Assumptions, "fallbackFsr" | "floorToFloorM" | "siteCoverage">): { fsr: number; basis: "OFFICIAL" | "HEIGHT_ESTIMATE" | "FALLBACK" } {
  if (l.fsr != null) return { fsr: l.fsr, basis: "OFFICIAL" };
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
  weightedFsr: number;
  fsrEstimated: boolean;
  heightMinM: number | null;
  heightMaxM: number | null;
  heritageLots: number;
  heritageItems: number;
  strataLots: number;
  minLotSizeIssues: string[];
  gfa: number;
  dwellings: number;
  owners: number;
  combinedValue: number;
  combinedValueEstimated: boolean;
  indicativeBudget: number;
  upliftRatio: number;
  planningUnknownLots: number;
  connected: boolean;
}

export function computeAssemblyMetrics(lots: AnalysisLot[], a: Assumptions, adj?: Adjacency): AssemblyMetrics {
  const totalAreaSqm = lots.reduce((s, l) => s + l.areaSqm, 0);
  const zones = [...new Set(lots.map((l) => l.zone ?? "Unknown"))];
  const fsrEstimated = lots.some((l) => l.fsr == null);
  const gfa = lots.reduce((s, l) => s + l.areaSqm * effectiveFsr(l, a).fsr, 0);
  const weightedFsr = totalAreaSqm > 0 ? gfa / totalAreaSqm : 0;
  const heights = lots.map((l) => l.heightM).filter((h): h is number => h != null);
  const minLotSizes = lots.map((l) => l.minLotSizeSqm).filter((m): m is number => m != null);
  const minLotSizeIssues: string[] = [];
  const maxMinLot = minLotSizes.length ? Math.max(...minLotSizes) : null;
  if (maxMinLot != null && totalAreaSqm < maxMinLot) minLotSizeIssues.push(`Combined area below ${maxMinLot.toLocaleString("en-AU")} sqm minimum lot size`);
  const valueEstimated = lots.some((l) => !(l.marketValue && l.marketValue > 0));
  const combinedValue = lots.reduce((s, l) => s + (l.marketValue && l.marketValue > 0 ? l.marketValue : l.areaSqm * a.existingValuePerSqm), 0);
  const y = computeYield({
    siteAreaSqm: totalAreaSqm,
    fsr: weightedFsr,
    efficiency: a.efficiency,
    siteCoverage: a.siteCoverage,
    floorToFloorM: a.floorToFloorM,
    avgDwellingSizeSqm: a.avgDwellingSizeSqm,
    carSpacesPerDwelling: a.carSpacesPerDwelling,
    heightLimitM: heights.length ? Math.min(...heights) : null,
  });
  const f = computeFeasibility({ gfa: y.gfa, saleableArea: y.saleableArea, dwellings: y.dwellings, lotCount: lots.length, a });
  return {
    lotIds: lots.map((l) => l.id),
    lotCount: lots.length,
    totalAreaSqm,
    zones,
    zoneCompatible: zones.length === 1 && zones[0] !== "Unknown",
    weightedFsr,
    fsrEstimated,
    heightMinM: heights.length ? Math.min(...heights) : null,
    heightMaxM: heights.length ? Math.max(...heights) : null,
    heritageLots: lots.filter((l) => hasHeritage(l.heritage)).length,
    heritageItems: lots.filter((l) => isHeritageItem(l.heritage)).length,
    strataLots: lots.filter((l) => l.isStrata).length,
    minLotSizeIssues,
    gfa: y.gfa,
    dwellings: y.dwellings,
    owners: lots.length,
    combinedValue,
    combinedValueEstimated: valueEstimated,
    indicativeBudget: f.maxAcquisitionBudget,
    upliftRatio: combinedValue > 0 ? f.maxAcquisitionBudget / combinedValue : 0,
    planningUnknownLots: lots.filter((l) => !l.planningKnown).length,
    connected: adj ? isConnected(lots.map((l) => l.id), adj) : true,
  };
}

export const SCORE_WEIGHTS = { siteSize: 0.25, planningCapacity: 0.25, simplicity: 0.15, uplift: 0.25, constraints: 0.1 } as const;

export interface ScoreFactor {
  sign: "+" | "-";
  text: string;
}
export interface OpportunityScore {
  score: number;
  components: Record<keyof typeof SCORE_WEIGHTS, number>;
  factors: ScoreFactor[];
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const sqm = (n: number) => `${Math.round(n).toLocaleString("en-AU")} sqm`;
const words = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight"];
const count = (n: number, noun: string) => `${words[n] ?? n} ${noun}${n === 1 ? "" : "s"}`;

/** Transparent 0–100 score: weighted rule-based components with the reasons that drove them. */
export function scoreAssembly(m: AssemblyMetrics, a: Assumptions): OpportunityScore {
  const factors: ScoreFactor[] = [];

  const siteSize = clamp01((m.totalAreaSqm - 600) / (3000 - 600)) * 100;
  if (m.totalAreaSqm >= a.minViableSiteAreaSqm) factors.push({ sign: "+", text: `${sqm(m.totalAreaSqm)} combined site` });
  else factors.push({ sign: "-", text: `${sqm(m.totalAreaSqm)} is below the ${sqm(a.minViableSiteAreaSqm)} minimum viable site` });

  const planningCapacity = clamp01(m.weightedFsr / 2) * 80 + clamp01((m.heightMinM ?? 0) / 24) * 20;
  const fsrText = `FSR ${m.weightedFsr.toFixed(2)}:1${m.fsrEstimated ? " (estimated — no FSR mapped)" : ""}`;
  if (m.weightedFsr >= 1.2) factors.push({ sign: "+", text: `${fsrText} — ${Math.round(m.gfa).toLocaleString("en-AU")} sqm GFA` });
  else factors.push({ sign: "-", text: `${fsrText} limits apartment yield` });
  if (m.heightMinM != null && m.heightMinM >= 15) factors.push({ sign: "+", text: `${m.heightMinM} m height control` });

  let simplicity = 100 - (m.lotCount - 2) * 15 - m.strataLots * 25;
  simplicity = Math.max(0, Math.min(100, simplicity));
  if (m.lotCount <= 3) factors.push({ sign: "+", text: `only ${count(m.lotCount, "owner")} to negotiate` });
  else if (m.lotCount >= 5) factors.push({ sign: "-", text: `${count(m.lotCount, "owner")} to negotiate` });
  if (m.strataLots) factors.push({ sign: "-", text: `${count(m.strataLots, "strata scheme")} (collective sale required)` });

  const uplift = clamp01((m.upliftRatio - 0.9) / (1.8 - 0.9)) * 100;
  if (m.upliftRatio >= 1.15)
    factors.push({ sign: "+", text: `indicative land budget ${m.upliftRatio.toFixed(1)}× existing value${m.combinedValueEstimated ? " (estimated)" : ""}` });
  else factors.push({ sign: "-", text: `indicative land budget only ${m.upliftRatio.toFixed(2)}× existing value — little assembly premium` });

  let constraints = 100;
  if (m.heritageItems) {
    constraints -= 50 * m.heritageItems;
    factors.push({ sign: "-", text: `${count(m.heritageItems, "heritage item")}` });
  }
  const conservation = m.heritageLots - m.heritageItems;
  if (conservation) {
    constraints -= 25 * conservation;
    factors.push({ sign: "-", text: `${count(conservation, "lot")} in a heritage conservation area` });
  }
  const lowDensity = m.zones.filter((z) => z !== "Unknown" && !APARTMENT_ZONES.test(z));
  if (lowDensity.length) {
    constraints -= 30;
    factors.push({ sign: "-", text: `${lowDensity.join(", ")} zoning generally does not permit apartments` });
  }
  if (!m.zoneCompatible) {
    constraints -= 25;
    factors.push({ sign: "-", text: `mixed or unknown zoning (${m.zones.join(", ")})` });
  } else factors.push({ sign: "+", text: `consistent ${m.zones[0]} zoning` });
  if (m.planningUnknownLots) {
    constraints -= 20;
    factors.push({ sign: "-", text: `planning data unavailable for ${count(m.planningUnknownLots, "lot")}` });
  }
  for (const issue of m.minLotSizeIssues) {
    constraints -= 20;
    factors.push({ sign: "-", text: issue });
  }
  if (!m.connected) {
    constraints -= 40;
    factors.push({ sign: "-", text: "lots are not contiguous" });
  }
  constraints = Math.max(0, constraints);

  const components = { siteSize, planningCapacity, simplicity, uplift, constraints };
  const score = Math.round(
    (Object.keys(SCORE_WEIGHTS) as (keyof typeof SCORE_WEIGHTS)[]).reduce((s, k) => s + components[k] * SCORE_WEIGHTS[k], 0),
  );
  return { score, components, factors };
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
  const eligible = (id: string) => {
    const l = byId.get(id);
    return !!l && isDevelopableLot(l);
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
          const metrics = computeAssemblyMetrics(group, a);
          next.set(key, { key, lotIds: ids, metrics, score: scoreAssembly(metrics, a) });
        }
      }
    }
    if (!next.size) break;
    const ranked = [...next.values()].sort((x, y) => y.score.score - x.score.score || y.metrics.totalAreaSqm - x.metrics.totalAreaSqm);
    for (const c of ranked) if (size >= minSize) all.set(c.key, c);
    frontier = ranked.slice(0, beamWidth).map((c) => c.lotIds);
  }

  const sorted = [...all.values()].sort((x, y) => y.score.score - x.score.score || y.metrics.totalAreaSqm - x.metrics.totalAreaSqm);
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
  return [...picked.values()]
    .sort((x, y) => y.score.score - x.score.score || y.metrics.totalAreaSqm - x.metrics.totalAreaSqm)
    .slice(0, maxResults);
}
