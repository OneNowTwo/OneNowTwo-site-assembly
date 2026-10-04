/**
 * Sync map/scan cards to the canonical Opportunity CalculationSnapshot.
 * Does not recalculate — only overlays stored analysed results onto scan candidates.
 */
import type { ScanCandidate } from "@/lib/analysis/area-scan";
import type { CalculationSnapshot } from "@/lib/analysis/calculation-snapshot";
import type { ScanCalculationSnapshot } from "@/lib/analysis/assembly-feasibility";

export interface CanonicalScanOverlay {
  opportunityId: string;
  assemblyKey: string;
  scanSessionId: string | null;
  /** Current analysed values (authoritative for display/ranking). */
  currentEffectiveFsr: number | null;
  currentEffectiveHeightM: number | null;
  currentMaxPayable: number | null;
  currentHeadroom: number | null;
  currentScore: number | null;
  currentGrv: number | null;
  currentTheoreticalGfa: number | null;
  currentAchievableGfa: number | null;
  /** Historical scan-era values (display only). */
  originalScanFsr: number | null;
  originalScanMaxPayable: number | null;
  originalScanHeadroom: number | null;
  originalScanScore: number | null;
  analysedAt: string;
}

export function canonicalFromOpportunity(input: {
  opportunityId: string;
  assemblyKey: string;
  scanSessionId?: string | null;
  calculation: Pick<
    CalculationSnapshot,
    "effectiveFsr" | "effectiveHeightM" | "maxPayable" | "headroom" | "score" | "grv" | "theoreticalGfa" | "achievableGfa"
  >;
  originalScan?: Partial<ScanCalculationSnapshot> | null;
  analysedAt?: string;
}): CanonicalScanOverlay {
  const orig = input.originalScan ?? null;
  return {
    opportunityId: input.opportunityId,
    assemblyKey: input.assemblyKey,
    scanSessionId: input.scanSessionId ?? null,
    currentEffectiveFsr: input.calculation.effectiveFsr,
    currentEffectiveHeightM: input.calculation.effectiveHeightM,
    currentMaxPayable: input.calculation.maxPayable,
    currentHeadroom: input.calculation.headroom,
    currentScore: input.calculation.score,
    currentGrv: input.calculation.grv,
    currentTheoreticalGfa: input.calculation.theoreticalGfa,
    currentAchievableGfa: input.calculation.achievableGfa,
    originalScanFsr: orig?.modelledEffectiveFsr ?? null,
    originalScanMaxPayable: orig?.maxPayable ?? null,
    originalScanHeadroom: orig?.headroom ?? null,
    originalScanScore: orig?.score ?? null,
    analysedAt: input.analysedAt ?? new Date().toISOString(),
  };
}

/** Apply canonical overlay onto a scan candidate. Preserves original scan figures as history. */
export function applyCanonicalOverlay(candidate: ScanCandidate, overlay: CanonicalScanOverlay): ScanCandidate {
  if (candidate.key !== overlay.assemblyKey) return candidate;
  const originalFsr = candidate.originalScanFsr ?? candidate.effectiveFsr;
  const originalMax = candidate.originalScanMaxPayable ?? candidate.maxPayable;
  const originalHeadroom = candidate.originalScanHeadroom ?? candidate.headroom;
  const originalScore = candidate.originalScanScore ?? candidate.score.score;

  const nextScore = overlay.currentScore ?? candidate.score.score;
  return {
    ...candidate,
    effectiveFsr: overlay.currentEffectiveFsr ?? candidate.effectiveFsr,
    maxPayable: overlay.currentMaxPayable ?? candidate.maxPayable,
    headroom: overlay.currentHeadroom ?? candidate.headroom,
    financialRankingAvailable: overlay.currentMaxPayable != null,
    score: { ...candidate.score, score: nextScore },
    calculationSnapshot: {
      ...candidate.calculationSnapshot,
      modelledEffectiveFsr: overlay.currentEffectiveFsr ?? candidate.calculationSnapshot.modelledEffectiveFsr,
      effectiveHeightM: overlay.currentEffectiveHeightM ?? candidate.calculationSnapshot.effectiveHeightM,
      maxPayable: overlay.currentMaxPayable ?? candidate.calculationSnapshot.maxPayable,
      headroom: overlay.currentHeadroom ?? candidate.calculationSnapshot.headroom,
      score: nextScore,
      grv: overlay.currentGrv ?? candidate.calculationSnapshot.grv,
      theoreticalGfa: overlay.currentTheoreticalGfa ?? candidate.calculationSnapshot.theoreticalGfa,
      achievableGfa: overlay.currentAchievableGfa ?? candidate.calculationSnapshot.achievableGfa,
      calculatedAt: overlay.analysedAt,
    },
    originalScanFsr: originalFsr,
    originalScanMaxPayable: originalMax,
    originalScanHeadroom: originalHeadroom,
    originalScanScore: originalScore,
    canonicalOpportunityId: overlay.opportunityId,
    canonicalAnalysedAt: overlay.analysedAt,
  };
}

/** Rerank candidates by score then headroom after canonical overlays — no full suburb rescan. */
export function rerankScanCandidates(candidates: ScanCandidate[]): ScanCandidate[] {
  const sorted = [...candidates].sort(
    (a, b) => b.score.score - a.score.score || (b.headroom ?? -Infinity) - (a.headroom ?? -Infinity),
  );
  return sorted.map((c, i) => ({ ...c, rank: i + 1 }));
}

export function syncCandidatesWithCanonical(
  candidates: ScanCandidate[],
  overlays: CanonicalScanOverlay[],
): ScanCandidate[] {
  const byKey = new Map(overlays.map((o) => [o.assemblyKey, o]));
  const next = candidates.map((c) => {
    const o = byKey.get(c.key);
    return o ? applyCanonicalOverlay(c, o) : c;
  });
  return rerankScanCandidates(next);
}
