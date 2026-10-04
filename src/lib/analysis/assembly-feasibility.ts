/**
 * ONE shared calculation path for Area Scan, assembly cards, and Opportunity promotion.
 * Scan may use a “quick” parcel/planning dataset, but the maths must be identical.
 */
import type { ParcelData } from "@/lib/types";
import type { NominatedCentre } from "@/lib/data-sources/housing-sepp-lmr";
import { resolveEffectiveControls, type EffectiveDevelopmentControls } from "./effective-controls";
import {
  computeAssemblyMetrics,
  scoreAssembly,
  type AnalysisLot,
  type AssemblyCandidate,
  type AssemblyMetrics,
  type OpportunityScore,
} from "./assembly";
import type { Assumptions } from "./assumptions";
import { groupAcquisitionProperties } from "./acquisition-property";
import type { ExitBenchmarkSet } from "./exit-benchmarks";
import type { UnitMixRow } from "./unit-mix";
import { buildAdjacency, type Adjacency } from "./geometry";
import { parcelLabel } from "@/lib/parcel-analysis";

export const SCAN_CALCULATION_VERSION = "assembly-feasibility/v1";

export interface AssemblyFeasibilityInputs {
  parcels: ParcelData[];
  assumptions: Assumptions;
  centres?: NominatedCentre[];
  /** When set, use these modelled FSRs/heights instead of resolving from centres. */
  effectiveByParcelId?: Map<string, EffectiveDevelopmentControls>;
  adjacency?: Adjacency;
  /** Explicit unit mix (Analyse). When omitted, auto-generated from assumptions. */
  unitMix?: UnitMixRow[];
  /**
   * Local exit benchmarks for the scan area/suburb.
   * Applied to template-default unit prices so Area Scan matches Analyse economics.
   */
  exitBenchmarks?: ExitBenchmarkSet | null;
}

export interface AssemblyFeasibilityResult {
  lotIds: string[];
  metrics: AssemblyMetrics;
  score: OpportunityScore;
  lepFsr: number | null;
  effectiveFsr: number | null;
  effectiveHeightM: number | null;
  effectiveCertainty: EffectiveDevelopmentControls["modelled"]["certainty"];
  developmentType: string | null;
  lmrCentre: string | null;
  lmrBand: string;
  effectiveByLot: Record<string, EffectiveDevelopmentControls>;
  calculationVersion: string;
}

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

/** Build analysis lots using modelled effective FSR (not raw LEP-only). */
export function parcelsToEffectiveLots(
  parcels: ParcelData[],
  centres: NominatedCentre[],
  effectiveByParcelId?: Map<string, EffectiveDevelopmentControls>,
): { lots: AnalysisLot[]; effectiveByLot: Record<string, EffectiveDevelopmentControls> } {
  const effectiveByLot: Record<string, EffectiveDevelopmentControls> = {};
  const lots: AnalysisLot[] = parcels.map((p) => {
    const effective = effectiveByParcelId?.get(p.externalParcelId) ?? resolveEffectiveControls(p.planning, p.centroid, centres);
    effectiveByLot[p.externalParcelId] = effective;
    const mod = effective.modelled;
    return {
      id: p.externalParcelId,
      label: parcelLabel(p),
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
                epiName: effective.lmr.centreName ? `Modelled via ${effective.lmr.centreName}` : p.planning?.planningInstrument ?? null,
                lga: p.planning?.lga ?? null,
                layClass: mod.certainty,
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
  });
  return { lots, effectiveByLot };
}

/**
 * Shared-address whole-property estimates may be stamped onto every cadastral row.
 * Allocate by land area so computeAssemblyMetrics sums to the property total once
 * (same approach as analyseOpportunity).
 */
export function allocateSharedPropertyValuesForMetrics(
  lots: AnalysisLot[],
  parcels: ParcelData[],
): AnalysisLot[] {
  const byId = new Map(parcels.map((p) => [p.externalParcelId, p]));
  const properties = groupAcquisitionProperties(
    lots.map((lot) => {
      const p = byId.get(lot.id);
      return {
        id: lot.id,
        address: p?.address ?? null,
        areaSqm: lot.areaSqm,
        marketValue: lot.marketValue ?? null,
        marketValueLow: p?.valuation?.low ?? null,
        marketValueHigh: p?.valuation?.high ?? null,
        marketValueSource: p?.valuation?.source ?? null,
        marketValueMethod: p?.valuation?.method ?? null,
        suburb: p?.suburb ?? null,
        zone: lot.zone,
        isStrata: lot.isStrata,
      };
    }),
  );
  const allocated = new Map<string, number>();
  for (const property of properties) {
    if (property.marketValue == null || property.lotIds.length === 0) continue;
    if (property.lotIds.length === 1) {
      allocated.set(property.lotIds[0]!, property.marketValue);
      continue;
    }
    const totalArea = property.areaSqm || property.lotIds.reduce((s, id) => s + (byId.get(id)?.areaSqm ?? 0), 0) || 1;
    for (const id of property.lotIds) {
      const area = byId.get(id)?.areaSqm ?? 0;
      allocated.set(id, property.marketValue * (area / totalArea));
    }
  }
  return lots.map((lot) => {
    const mid = allocated.get(lot.id);
    return mid != null ? { ...lot, marketValue: mid } : lot;
  });
}

/** Canonical assembly feasibility — used by scan ranking and Analyse promotion. */
export function calculateAssemblyFeasibility(input: AssemblyFeasibilityInputs): AssemblyFeasibilityResult {
  const centres = input.centres ?? [];
  const { lots: rawLots, effectiveByLot } = parcelsToEffectiveLots(input.parcels, centres, input.effectiveByParcelId);
  const lots = allocateSharedPropertyValuesForMetrics(rawLots, input.parcels);
  const adj = input.adjacency ?? buildAdjacency(input.parcels.map((p) => ({ id: p.externalParcelId, geometry: p.geometry })));
  const metrics = computeAssemblyMetrics(
    lots,
    input.assumptions,
    adj,
    input.unitMix,
    input.unitMix ? null : input.exitBenchmarks,
  );
  const effs = Object.values(effectiveByLot);
  const lepFsr = avg(effs.map((e) => e.lep.fsr).filter((x): x is number => x != null));
  const modFsrs = effs.map((e) => e.modelled.fsr).filter((x): x is number => x != null);
  const modHeights = effs.map((e) => e.modelled.heightM).filter((x): x is number => x != null);
  const certainty = effs.some((e) => e.modelled.certainty === "REQUIRES_PLANNING_CONFIRMATION")
    ? "REQUIRES_PLANNING_CONFIRMATION"
    : effs[0]?.modelled.certainty ?? "OFFICIAL_LEP";
  const lmrCentre = effs.find((e) => e.lmr.centreName)?.lmr.centreName ?? null;
  const developmentType = effs.find((e) => e.lmr.developmentType)?.lmr.developmentType ?? null;
  const proximityLabel = effs.find((e) => e.lmr.proximityLabel)?.lmr.proximityLabel ?? null;
  const statePathway =
    certainty === "REQUIRES_PLANNING_CONFIRMATION" || certainty === "STATE_POLICY_CANDIDATE";
  const effectiveFsr =
    metrics.weightedFsr || (modFsrs.length ? Math.round((avg(modFsrs) as number) * 1000) / 1000 : null);
  // Same scoreAssembly options Analyse uses so scan cards do not inflate vs detailed analysis.
  const score = scoreAssembly(metrics, input.assumptions, {
    effectiveFsr,
    fsrSource: statePathway ? "STATE_PATHWAY" : metrics.fsrEstimated ? "NO_MAPPED" : "OFFICIAL",
    statePathwayName: statePathway ? "Low & Mid-Rise Housing (Housing SEPP)" : null,
    lepFsr,
    proximityLabel,
    ownerCountKnown: false,
    ownerCount: null,
  });

  return {
    lotIds: lots.map((l) => l.id),
    metrics,
    score,
    lepFsr: lepFsr != null ? Math.round(lepFsr * 1000) / 1000 : null,
    effectiveFsr,
    effectiveHeightM: modHeights.length ? Math.min(...modHeights) : null,
    effectiveCertainty: certainty,
    developmentType,
    lmrCentre,
    lmrBand: effs.find((e) => e.lmr.band !== "OUTSIDE")?.lmr.band ?? "OUTSIDE",
    effectiveByLot,
    calculationVersion: SCAN_CALCULATION_VERSION,
  };
}

export function toAssemblyCandidate(result: AssemblyFeasibilityResult): AssemblyCandidate {
  return {
    key: [...result.lotIds].sort().join("|"),
    lotIds: result.lotIds,
    metrics: result.metrics,
    score: result.score,
  };
}

/** Snapshot persisted when promoting a scan result to an Opportunity. */
export interface ScanCalculationSnapshot {
  version: string;
  calculatedAt: string;
  lotIds: string[];
  lepFsr: number | null;
  statePolicyFsr: number | null;
  modelledEffectiveFsr: number | null;
  effectiveCertainty: string;
  effectiveHeightM: number | null;
  existingValue: number;
  existingValueEstimated: boolean;
  maxPayable: number;
  headroom: number | null;
  headroomPercent: number | null;
  grv: number;
  theoreticalGfa: number;
  achievableGfa: number;
  dwellings: number;
  siteAreaSqm: number;
  score: number;
  lmrCentre: string | null;
  lmrBand: string;
  developmentType: string | null;
  perLot: Record<
    string,
    {
      lepFsr: number | null;
      statePolicyFsr: number | null;
      modelledFsr: number | null;
      modelledHeightM: number | null;
      certainty: string;
      zone: string | null;
      areaSqm: number;
    }
  >;
}

export function buildScanCalculationSnapshot(result: AssemblyFeasibilityResult, parcels: ParcelData[]): ScanCalculationSnapshot {
  const byId = new Map(parcels.map((p) => [p.externalParcelId, p]));
  const perLot: ScanCalculationSnapshot["perLot"] = {};
  for (const id of result.lotIds) {
    const e = result.effectiveByLot[id];
    const p = byId.get(id);
    perLot[id] = {
      lepFsr: e?.lep.fsr ?? null,
      statePolicyFsr: e?.statePolicy?.fsr ?? null,
      modelledFsr: e?.modelled.fsr ?? null,
      modelledHeightM: e?.modelled.heightM ?? null,
      certainty: e?.modelled.certainty ?? "NOT_APPLICABLE",
      zone: p?.planning?.zone ?? null,
      areaSqm: p?.areaSqm ?? 0,
    };
  }
  const stateFsrs = Object.values(perLot).map((x) => x.statePolicyFsr).filter((x): x is number => x != null);
  return {
    version: result.calculationVersion,
    calculatedAt: new Date().toISOString(),
    lotIds: result.lotIds,
    lepFsr: result.lepFsr,
    statePolicyFsr: stateFsrs.length ? Math.round((avg(stateFsrs) as number) * 1000) / 1000 : null,
    modelledEffectiveFsr: result.effectiveFsr,
    effectiveCertainty: result.effectiveCertainty,
    effectiveHeightM: result.effectiveHeightM,
    existingValue: result.metrics.combinedValue,
    existingValueEstimated: result.metrics.combinedValueEstimated,
    maxPayable: result.metrics.maxPayableToOwners,
    headroom: result.metrics.acquisitionHeadroom,
    headroomPercent: result.metrics.acquisitionHeadroomPercent,
    grv: result.metrics.grv,
    theoreticalGfa: result.metrics.theoreticalGfa,
    achievableGfa: result.metrics.achievableGfa,
    dwellings: result.metrics.dwellings,
    siteAreaSqm: result.metrics.totalAreaSqm,
    score: result.score.score,
    lmrCentre: result.lmrCentre,
    lmrBand: result.lmrBand,
    developmentType: result.developmentType,
    perLot,
  };
}
