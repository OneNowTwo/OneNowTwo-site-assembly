import type { ParcelCompSale, ParcelData } from "@/lib/types";
import type { NominatedCentre } from "@/lib/data-sources/housing-sepp-lmr";
import { resolveEffectiveControls, type EffectiveDevelopmentControls, type WalkingDistanceHint } from "./effective-controls";
import {
  APARTMENT_ZONES,
  NON_DEVELOPABLE_ZONES,
  generateAssemblies,
  isHeritageItem,
  type AnalysisLot,
  type AssemblyCandidate,
} from "./assembly";
import type { Assumptions } from "./assumptions";
import { buildAdjacency, type Adjacency } from "./geometry";
import { parcelLabel } from "@/lib/parcel-analysis";
import {
  buildScanCalculationSnapshot,
  calculateAssemblyFeasibility,
  type ScanCalculationSnapshot,
} from "./assembly-feasibility";

export type RejectionReason =
  | "NON_RESIDENTIAL_ZONE"
  | "HERITAGE_ITEM"
  | "STRATA"
  | "TOO_SMALL"
  | "TOO_LARGE_ALREADY_DEVELOPED"
  | "NO_PLANNING"
  | "NO_UPLIFT_OR_CAPACITY"
  | "PUBLIC_OR_SPECIAL_USE";

export interface ParcelEligibility {
  id: string;
  eligible: boolean;
  reasons: RejectionReason[];
  effective: EffectiveDevelopmentControls;
  label: string;
}

export interface ScanAssemblyFamily {
  familyId: string;
  best: ScanCandidate;
  alternatives: ScanCandidate[];
}

export interface ScanCandidate {
  key: string;
  rank: number;
  lotIds: string[];
  locationLabel: string;
  lotCount: number;
  owners: number;
  siteAreaSqm: number;
  lepFsr: number | null;
  effectiveFsr: number | null;
  effectiveCertainty: EffectiveDevelopmentControls["modelled"]["certainty"];
  developmentType: string;
  indicativeUnits: number;
  existingValue: number;
  existingValueLow: number | null;
  existingValueHigh: number | null;
  existingValueEstimated: boolean;
  maxPayable: number | null;
  headroom: number | null;
  headroomLow: number | null;
  headroomHigh: number | null;
  headroomPercent: number | null;
  financialRankingAvailable: boolean;
  planningPotentialScore: number;
  constraints: string[];
  scoreFactors: { sign: "+" | "-"; text: string }[];
  lmrCentre: string | null;
  lmrBand: string;
  metrics: AssemblyCandidate["metrics"];
  score: AssemblyCandidate["score"];
  /** Exact snapshot used for Analyse — Opportunity must reproduce these figures. */
  calculationSnapshot: ScanCalculationSnapshot;
  /** Per-lot automatic valuations when Stage 4 completed. */
  lotValuations?: Record<
    string,
    {
      mid: number | null;
      low: number | null;
      high: number | null;
      confidence: string;
      source: string;
      provider: string | null;
      checkedAt: string | null;
      note?: string | null;
      numberOfComps?: number | null;
      comps?: ParcelCompSale[] | null;
      subjectLastSale?: NonNullable<NonNullable<ParcelData["valuation"]>["subjectLastSale"]> | null;
      valuationLabel?: string | null;
    }
  >;
}

export interface ScanFunnel {
  parcelsLoaded: number;
  parcelsConsidered: number;
  parcelsEligible: number;
  adjacencyEdges: number;
  generatedByLotCount: Record<string, number>;
  assembliesGenerated: number;
  assembliesAfterMinArea: number;
  financiallyModelled: number;
  familiesReturned: number;
  candidatesReturned: number;
  minAreaSqmUsed: number;
  partialScan: boolean;
}

export interface AreaScanResult {
  progress: string[];
  parcelsConsidered: number;
  parcelsEligible: number;
  rejections: Record<RejectionReason, number>;
  rejectionSamples: { id: string; label: string; reasons: RejectionReason[] }[];
  assembliesGenerated: number;
  funnel: ScanFunnel;
  families: ScanAssemblyFamily[];
  candidates: ScanCandidate[];
  centres: NominatedCentre[];
  messages: string[];
}

const RESIDENTIAL_ZONE = /^R[1-4]$/;

function streetKey(address: string | null): string {
  if (!address) return "Site";
  return address.replace(/^[\d\-/A-Za-z]+\s+/, "").replace(/,.*$/, "").trim() || "Site";
}

function financialLotsComplete(parcels: ParcelData[]): boolean {
  return parcels.length > 0 && parcels.every((p) => p.valuation?.mid != null && p.valuation.mid > 0);
}

export function assessParcelEligibility(
  p: ParcelData,
  centres: NominatedCentre[],
  walking?: WalkingDistanceHint | null,
): ParcelEligibility {
  const effective = resolveEffectiveControls(p.planning, p.centroid, centres, walking);
  const reasons: RejectionReason[] = [];
  const zone = p.planning?.zone ?? null;

  if (!p.planning) reasons.push("NO_PLANNING");
  if (zone && NON_DEVELOPABLE_ZONES.test(zone)) reasons.push("PUBLIC_OR_SPECIAL_USE");
  if (zone && !RESIDENTIAL_ZONE.test(zone) && !APARTMENT_ZONES.test(zone)) reasons.push("NON_RESIDENTIAL_ZONE");
  if (zone && /^(RE|SP|C|W)/.test(zone)) reasons.push("PUBLIC_OR_SPECIAL_USE");
  if (p.isStrata) reasons.push("STRATA");
  if (p.areaSqm < 200) reasons.push("TOO_SMALL");
  if (p.areaSqm > 2500 && (p.planning?.fsr ?? 0) >= 1.5) reasons.push("TOO_LARGE_ALREADY_DEVELOPED");
  if (isHeritageItem(p.planning?.heritage ?? null)) reasons.push("HERITAGE_ITEM");

  // Missing LEP FSR is null — do not coerce to 0 when testing capacity.
  const lepFsr = effective.lep.fsr;
  const modFsr = effective.modelled.fsr;
  const hasUplift =
    (modFsr != null && lepFsr != null && modFsr > lepFsr + 0.05) ||
    (modFsr != null && lepFsr == null && modFsr >= 0.5) ||
    ((lepFsr ?? 0) > 0 && p.areaSqm >= 400);
  const hasCapacity = (modFsr != null && modFsr >= 0.5) || (lepFsr != null && lepFsr >= 0.4) || (p.planning?.heightM ?? 0) >= 8;
  // Ordinary LEP residential lots remain discoverable without LMR.
  const ordinaryResidential = !!zone && RESIDENTIAL_ZONE.test(zone) && p.areaSqm >= 250 && (lepFsr != null || modFsr != null || (p.planning?.heightM ?? 0) >= 8);
  if (!hasUplift && !hasCapacity && !ordinaryResidential) reasons.push("NO_UPLIFT_OR_CAPACITY");

  // Soft: keep R1/R2 with LMR uplift even if LEP FSR looks weak.
  const lmrHelps = effective.lmr.zoneEligible && (effective.fsrUplift >= 0.2 || (lepFsr == null && (modFsr ?? 0) >= 0.5));
  const eligible =
    reasons.filter((r) => r !== "NO_UPLIFT_OR_CAPACITY").length === 0 &&
    (hasUplift || hasCapacity || lmrHelps || ordinaryResidential);

  if (!eligible && lmrHelps && reasons.length === 1 && reasons[0] === "NO_UPLIFT_OR_CAPACITY") {
    return { id: p.externalParcelId, eligible: true, reasons: [], effective, label: parcelLabel(p) };
  }

  return {
    id: p.externalParcelId,
    eligible,
    reasons: eligible ? [] : reasons,
    effective,
    label: parcelLabel(p),
  };
}

function toScanLot(p: ParcelData, el: ParcelEligibility): AnalysisLot {
  const mod = el.effective.modelled;
  return {
    id: p.externalParcelId,
    label: el.label,
    areaSqm: p.areaSqm,
    zone: p.planning?.zone ?? null,
    zoneName: p.planning?.zoneName ?? null,
    fsr: mod.fsr,
    fsrStatus: mod.fsr != null ? "MAPPED" : "NO_MAPPED",
    fsrControls:
      mod.fsr != null
        ? [
            {
              fsr: mod.fsr,
              epiName: el.effective.lmr.centreName ? `Modelled via ${el.effective.lmr.centreName}` : p.planning?.planningInstrument ?? null,
              lga: p.planning?.lga ?? null,
              layClass: el.effective.modelled.certainty,
              intersectionAreaSqm: p.areaSqm,
              intersectionShare: 1,
            },
          ]
        : [],
    heightM: mod.heightM,
    minLotSizeSqm: p.planning?.minLotSizeSqm ?? null,
    heritage: p.planning?.heritage ?? null,
    isStrata: p.isStrata,
    planningKnown: !!p.planning,
    marketValue: p.valuation?.mid != null && p.valuation.mid > 0 ? p.valuation.mid : undefined,
  };
}

/** Generate assemblies for an area without requiring a user-selected start parcel. */
export function generateAreaAssemblies(
  lots: AnalysisLot[],
  adj: Adjacency,
  a: Assumptions,
  opts?: { maxSeeds?: number; maxSize?: number; maxPerSeed?: number; minAreaSqm?: number },
): AssemblyCandidate[] {
  const maxSeeds = opts?.maxSeeds ?? 100;
  const maxSize = opts?.maxSize ?? Math.min(a.maxAssemblySize, 6);
  const maxPerSeed = opts?.maxPerSeed ?? 14;
  // Scan discovery uses a lower floor than acquisition “min viable” so 2–4 lot sites survive.
  const minArea = opts?.minAreaSqm ?? Math.min(a.minViableSiteAreaSqm, 800);

  // Seed lots with highest modelled FSR × area first (uplift / capacity).
  const seeds = [...lots]
    .filter((l) => !l.isStrata)
    .sort((x, y) => (y.fsr ?? 0) * y.areaSqm - (x.fsr ?? 0) * x.areaSqm || y.areaSqm - x.areaSqm)
    .slice(0, maxSeeds);

  const all = new Map<string, AssemblyCandidate>();
  for (const seed of seeds) {
    const found = generateAssemblies(lots, adj, seed.id, a, {
      minSize: 2,
      maxSize,
      maxResults: maxPerSeed,
      beamWidth: 32,
    });
    for (const c of found) {
      if (c.metrics.totalAreaSqm < minArea) continue;
      if (!all.has(c.key)) all.set(c.key, c);
    }
  }
  return [...all.values()];
}

function jaccard(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

/** Group overlapping assemblies; keep best as primary. */
export function groupAssemblyFamilies(candidates: ScanCandidate[], similarity = 0.55): ScanAssemblyFamily[] {
  const sorted = [...candidates].sort((a, b) => b.score.score - a.score.score || b.planningPotentialScore - a.planningPotentialScore || (b.headroom ?? -Infinity) - (a.headroom ?? -Infinity));
  const families: ScanAssemblyFamily[] = [];
  const used = new Set<string>();

  for (const c of sorted) {
    if (used.has(c.key)) continue;
    const alts: ScanCandidate[] = [];
    used.add(c.key);
    for (const other of sorted) {
      if (used.has(other.key)) continue;
      if (jaccard(c.lotIds, other.lotIds) >= similarity) {
        alts.push(other);
        used.add(other.key);
      }
    }
    const members = [c, ...alts].sort((a, b) => b.score.score - a.score.score || (b.headroom ?? -Infinity) - (a.headroom ?? -Infinity));
    families.push({ familyId: `family:${members[0]!.key}`, best: members[0]!, alternatives: members.slice(1) });
  }
  return families.sort((a, b) => b.best.score.score - a.best.score.score || (b.best.headroom ?? -Infinity) - (a.best.headroom ?? -Infinity));
}

function planningPotentialScore(c: AssemblyCandidate, effectiveById: Map<string, EffectiveDevelopmentControls>): number {
  const uplift = c.lotIds.reduce((s, id) => s + (effectiveById.get(id)?.fsrUplift ?? 0), 0) / Math.max(c.lotIds.length, 1);
  const area = Math.min(1, c.metrics.totalAreaSqm / 2000);
  const fsr = Math.min(1, (c.metrics.weightedFsr || 0) / 2.2);
  const ownersPenalty = Math.min(1, Math.max(0, c.metrics.owners - 2) / 6);
  const heritagePenalty = c.metrics.heritageItems * 0.25 + c.metrics.heritageLots * 0.08;
  const raw = 100 * (0.35 * Math.min(1, uplift / 0.8) + 0.25 * area + 0.25 * fsr + 0.15 * (1 - ownersPenalty) - heritagePenalty);
  return Math.max(0, Math.min(100, Math.round(raw)));
}

export function runAreaScan(input: {
  parcels: ParcelData[];
  centres: NominatedCentre[];
  assumptions: Assumptions;
  maxResults?: number;
  /** Optional pedestrian-route hints keyed by externalParcelId. */
  walkingByParcelId?: Map<string, WalkingDistanceHint>;
}): AreaScanResult {
  const progress: string[] = [];
  const messages: string[] = [];
  progress.push("Loading parcels");
  const parcels = input.parcels;
  progress.push("Applying planning controls");

  const eligibility = parcels.map((p) =>
    assessParcelEligibility(p, input.centres, input.walkingByParcelId?.get(p.externalParcelId) ?? null),
  );
  const rejections = {} as Record<RejectionReason, number>;
  const rejectionSamples: AreaScanResult["rejectionSamples"] = [];
  for (const e of eligibility) {
    for (const r of e.reasons) rejections[r] = (rejections[r] ?? 0) + 1;
    if (!e.eligible && rejectionSamples.length < 12) rejectionSamples.push({ id: e.id, label: e.label, reasons: e.reasons });
  }

  const eligibleIds = new Set(eligibility.filter((e) => e.eligible).map((e) => e.id));
  const eligibleParcels = parcels.filter((p) => eligibleIds.has(p.externalParcelId));
  const elById = new Map(eligibility.map((e) => [e.id, e]));
  const effectiveById = new Map(eligibility.map((e) => [e.id, e.effective]));

  progress.push("Generating assemblies");
  const lots = eligibleParcels.map((p) => toScanLot(p, elById.get(p.externalParcelId)!));
  const adj = buildAdjacency(eligibleParcels.map((p) => ({ id: p.externalParcelId, geometry: p.geometry })));
  let adjacencyEdges = 0;
  for (const [, ns] of adj) adjacencyEdges += ns.size;
  adjacencyEdges = Math.floor(adjacencyEdges / 2);
  const minAreaSqmUsed = Math.min(input.assumptions.minViableSiteAreaSqm, 800);
  const raw = generateAreaAssemblies(lots, adj, input.assumptions, { minAreaSqm: minAreaSqmUsed });
  const generatedByLotCount: Record<string, number> = {};
  for (const c of raw) {
    const k = String(c.metrics.lotCount);
    generatedByLotCount[k] = (generatedByLotCount[k] ?? 0) + 1;
  }
  progress.push("Running initial feasibility");

  const byParcel = new Map(parcels.map((p) => [p.externalParcelId, p]));
  const scanCandidates: ScanCandidate[] = raw.map((c) => {
    const memberParcels = c.lotIds.map((id) => byParcel.get(id)!).filter(Boolean);
    const feasibility = calculateAssemblyFeasibility({
      parcels: memberParcels,
      assumptions: input.assumptions,
      centres: input.centres,
      effectiveByParcelId: effectiveById,
      adjacency: adj,
    });
    const snapshot = buildScanCalculationSnapshot(feasibility, memberParcels);
    const streets = c.lotIds.map((id) => streetKey(byParcel.get(id)?.address ?? null));
    const street = streets.sort((a, b) => streets.filter((s) => s === b).length - streets.filter((s) => s === a).length)[0] ?? "Site";
    const suburb = c.lotIds.map((id) => byParcel.get(id)?.suburb).find(Boolean) ?? "NSW";
    const constraints: string[] = [];
    if (feasibility.metrics.heritageItems) constraints.push(`${feasibility.metrics.heritageItems} heritage item(s)`);
    if (feasibility.metrics.heritageLots) constraints.push(`${feasibility.metrics.heritageLots} heritage-affected lot(s)`);
    if (feasibility.metrics.fsrEstimated) constraints.push("Some lots lack official LEP FSR");
    if (feasibility.effectiveCertainty === "REQUIRES_PLANNING_CONFIRMATION") {
      constraints.push("LMR 800 m proximity screen PASS — ESTIMATED; requires planning confirmation");
    }
    if (feasibility.metrics.minLotSizeIssues.length) constraints.push(...feasibility.metrics.minLotSizeIssues);

    const candidateForScore: AssemblyCandidate = {
      key: c.key,
      lotIds: feasibility.lotIds,
      metrics: feasibility.metrics,
      score: feasibility.score,
    };
    const pps = planningPotentialScore(candidateForScore, effectiveById);
    const scored = feasibility.score;

    return {
      key: c.key,
      rank: 0,
      lotIds: feasibility.lotIds,
      locationLabel: `${street}, ${suburb}`,
      lotCount: feasibility.metrics.lotCount,
      owners: feasibility.metrics.owners,
      siteAreaSqm: feasibility.metrics.totalAreaSqm,
      lepFsr: feasibility.lepFsr,
      effectiveFsr: feasibility.effectiveFsr,
      effectiveCertainty: feasibility.effectiveCertainty,
      developmentType: feasibility.developmentType ?? "Residential redevelopment",
      indicativeUnits: feasibility.metrics.dwellings,
      existingValue: feasibility.metrics.financialValuationAvailable ? feasibility.metrics.combinedValue : 0,
      existingValueLow: null,
      existingValueHigh: null,
      existingValueEstimated: !feasibility.metrics.financialValuationAvailable,
      maxPayable: feasibility.metrics.maxPayableToOwners,
      headroom: feasibility.metrics.acquisitionHeadroom,
      headroomLow: null,
      headroomHigh: null,
      headroomPercent: feasibility.metrics.acquisitionHeadroomPercent,
      financialRankingAvailable: feasibility.metrics.financialValuationAvailable,
      planningPotentialScore: pps,
      constraints: feasibility.metrics.financialValuationAvailable
        ? constraints
        : [...constraints, "FINANCIAL RANKING PENDING PROPERTY VALUES"],
      scoreFactors: scored.factors.slice(0, 5),
      lmrCentre: feasibility.lmrCentre,
      lmrBand: feasibility.lmrBand,
      metrics: feasibility.metrics,
      // Without trusted values, rank on planning potential only — no fake headroom precision.
      score: {
        ...scored,
        score: feasibility.metrics.financialValuationAvailable
          ? Math.round(scored.score * 0.55 + pps * 0.45)
          : Math.round(pps * 0.85 + scored.components.planningCapacity * 0.1 + scored.components.geometry * 0.05),
      },
      calculationSnapshot: snapshot,
    };
  });

  // Trusted valuations → financial+planning score; otherwise planning potential first.
  scanCandidates.sort((a, b) => {
    if (a.financialRankingAvailable !== b.financialRankingAvailable) return a.financialRankingAvailable ? -1 : 1;
    if (a.financialRankingAvailable) return b.score.score - a.score.score || (b.headroom ?? -Infinity) - (a.headroom ?? -Infinity);
    return b.planningPotentialScore - a.planningPotentialScore || b.score.score - a.score.score;
  });
  scanCandidates.forEach((c, i) => {
    c.rank = i + 1;
  });

  progress.push("Ranking opportunities");
  const maxResults = input.maxResults ?? 20;
  const top = scanCandidates.slice(0, Math.max(maxResults * 4, 80));
  const families = groupAssemblyFamilies(top).slice(0, maxResults);
  const candidates = families.map((f, i) => ({ ...f.best, rank: i + 1 }));

  if (candidates.every((c) => !c.financialRankingAvailable)) {
    messages.push("FINANCIAL RANKING PENDING PROPERTY VALUES — suburb $/sqm fallback is screening only and does not drive acquisition headroom. Rankings emphasise planning uplift, site size, geometry and constraints.");
  }
  messages.push("LMR is one pathway — ordinary LEP capacity also qualifies. Negative headroom sites are kept in the ranking.");
  messages.push("LMR MVP screen: ≤800 m straight-line from nominated centre (ESTIMATED). Not a statutory walking-distance confirmation.");
  messages.push(
    `Scan funnel: ${parcels.length} considered → ${eligibleParcels.length} eligible → ${raw.length} assemblies (by size ${JSON.stringify(generatedByLotCount)}) → ${candidates.length} ranked (min area ${minAreaSqmUsed} sqm).`,
  );

  const funnel: ScanFunnel = {
    parcelsLoaded: parcels.length,
    parcelsConsidered: parcels.length,
    parcelsEligible: eligibleParcels.length,
    adjacencyEdges,
    generatedByLotCount,
    assembliesGenerated: raw.length,
    assembliesAfterMinArea: raw.length,
    financiallyModelled: scanCandidates.filter((c) => c.financialRankingAvailable).length,
    familiesReturned: families.length,
    candidatesReturned: candidates.length,
    minAreaSqmUsed,
    partialScan: false,
  };

  return {
    progress,
    parcelsConsidered: parcels.length,
    parcelsEligible: eligibleParcels.length,
    rejections,
    rejectionSamples,
    assembliesGenerated: raw.length,
    funnel,
    families,
    candidates,
    centres: input.centres,
    messages,
  };
}

/**
 * After automatic valuations are attached to parcels, rebuild financials for existing
 * scan candidates and rerank (planning score retained when values still missing).
 */
export function applyValuationsToScanResult(
  result: AreaScanResult,
  valuedParcels: ParcelData[],
  assumptions: Assumptions,
): AreaScanResult {
  const byParcel = new Map(valuedParcels.map((p) => [p.externalParcelId, p]));
  const adj = buildAdjacency(valuedParcels.map((p) => ({ id: p.externalParcelId, geometry: p.geometry })));
  const effectiveById = new Map(
    valuedParcels.map((p) => {
      const el = assessParcelEligibility(p, result.centres);
      return [p.externalParcelId, el.effective] as const;
    }),
  );

  const rebuild = (c: ScanCandidate): ScanCandidate => {
    const memberParcels = c.lotIds.map((id) => byParcel.get(id)).filter((p): p is ParcelData => !!p);
    if (!memberParcels.length) return c;
    const feasibility = calculateAssemblyFeasibility({
      parcels: memberParcels,
      assumptions,
      centres: result.centres,
      effectiveByParcelId: effectiveById,
      adjacency: adj,
    });
    const snapshot = buildScanCalculationSnapshot(feasibility, memberParcels);
    const lotValuations: NonNullable<ScanCandidate["lotValuations"]> = {};
    let existingLow = 0;
    let existingHigh = 0;
    const rangeComplete = financialLotsComplete(memberParcels);
    for (const p of memberParcels) {
      const v = p.valuation;
      if (!v) continue;
      lotValuations[p.externalParcelId] = {
        mid: v.mid,
        low: v.low,
        high: v.high,
        confidence: v.confidence,
        source: v.source,
        provider: v.provider,
        checkedAt: v.checkedAt,
        note: v.note,
        numberOfComps: v.numberOfComps ?? null,
        comps: v.comps ?? null,
        subjectLastSale: v.subjectLastSale ?? null,
        valuationLabel: v.valuationLabel ?? null,
      };
      if (v.mid != null && v.mid > 0) {
        existingLow += v.low != null && v.low > 0 ? v.low : v.mid * 0.9;
        existingHigh += v.high != null && v.high > 0 ? v.high : v.mid * 1.1;
      }
    }
    const candidateForScore: AssemblyCandidate = {
      key: c.key,
      lotIds: feasibility.lotIds,
      metrics: feasibility.metrics,
      score: feasibility.score,
    };
    const pps = planningPotentialScore(candidateForScore, effectiveById);
    const scored = feasibility.score;
    const financial = feasibility.metrics.financialValuationAvailable;
    const maxPay = feasibility.metrics.maxPayableToOwners;
    return {
      ...c,
      lotIds: feasibility.lotIds,
      lotCount: feasibility.metrics.lotCount,
      owners: feasibility.metrics.owners,
      siteAreaSqm: feasibility.metrics.totalAreaSqm,
      lepFsr: feasibility.lepFsr,
      effectiveFsr: feasibility.effectiveFsr,
      effectiveCertainty: feasibility.effectiveCertainty,
      indicativeUnits: feasibility.metrics.dwellings,
      existingValue: financial ? feasibility.metrics.combinedValue : 0,
      existingValueLow: financial && rangeComplete ? existingLow : null,
      existingValueHigh: financial && rangeComplete ? existingHigh : null,
      existingValueEstimated: !financial,
      maxPayable: maxPay,
      headroom: feasibility.metrics.acquisitionHeadroom,
      // High existing → lowest headroom; low existing → highest headroom.
      headroomLow: financial && rangeComplete && maxPay != null ? maxPay - existingHigh : null,
      headroomHigh: financial && rangeComplete && maxPay != null ? maxPay - existingLow : null,
      headroomPercent: feasibility.metrics.acquisitionHeadroomPercent,
      financialRankingAvailable: financial,
      planningPotentialScore: pps,
      constraints: financial
        ? c.constraints.filter((x) => x !== "FINANCIAL RANKING PENDING PROPERTY VALUES")
        : [...new Set([...c.constraints, "FINANCIAL RANKING PENDING PROPERTY VALUES"])],
      scoreFactors: scored.factors.slice(0, 5),
      metrics: feasibility.metrics,
      score: {
        ...scored,
        score: financial ? Math.round(scored.score * 0.55 + pps * 0.45) : Math.round(pps * 0.85 + scored.components.planningCapacity * 0.1 + scored.components.geometry * 0.05),
      },
      calculationSnapshot: snapshot,
      lotValuations,
    };
  };

  const candidates = result.candidates.map(rebuild);
  candidates.sort((a, b) => {
    if (a.financialRankingAvailable !== b.financialRankingAvailable) return a.financialRankingAvailable ? -1 : 1;
    if (a.financialRankingAvailable) return b.score.score - a.score.score || (b.headroom ?? -Infinity) - (a.headroom ?? -Infinity);
    return b.planningPotentialScore - a.planningPotentialScore || b.score.score - a.score.score;
  });
  candidates.forEach((c, i) => {
    c.rank = i + 1;
  });

  const families = result.families.map((f) => ({
    familyId: f.familyId,
    best: rebuild(f.best),
    alternatives: f.alternatives.map(rebuild),
  }));
  // Re-order families to match reranked candidates
  const byKey = new Map(candidates.map((c) => [c.key, c]));
  const orderedFamilies = candidates
    .map((c) => {
      const fam = families.find((f) => f.best.key === c.key || f.alternatives.some((a) => a.key === c.key));
      if (!fam) return { familyId: `family:${c.key}`, best: c, alternatives: [] as ScanCandidate[] };
      const best = byKey.get(fam.best.key) ?? rebuild(fam.best);
      return { ...fam, best, alternatives: fam.alternatives.map((a) => byKey.get(a.key) ?? a) };
    })
    .filter((f, i, arr) => arr.findIndex((x) => x.familyId === f.familyId) === i);

  const messages = [...result.messages];
  if (candidates.some((c) => c.financialRankingAvailable)) {
    messages.push("Property valuations applied — assemblies reranked with acquisition headroom where AVM data exists.");
  }

  return {
    ...result,
    progress: [...result.progress, "Valuing properties", "Running feasibility", "Ranking opportunities"],
    candidates,
    families: orderedFamilies.length ? orderedFamilies : families,
    funnel: {
      ...result.funnel,
      financiallyModelled: candidates.filter((c) => c.financialRankingAvailable).length,
      familiesReturned: (orderedFamilies.length ? orderedFamilies : families).length,
      candidatesReturned: candidates.length,
    },
    messages,
  };
}
