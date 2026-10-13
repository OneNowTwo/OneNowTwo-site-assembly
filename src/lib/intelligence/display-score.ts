/**
 * Single user-facing display score rule for Today / Find / index cards.
 *
 * A. ACTIVE linked Opportunity with non-null Opportunity.score → DETAILED
 * B. Otherwise screening/strategy score, clamped 0–100 → SCREENING
 *
 * Never recompute Opportunity analysis here — use persisted score only.
 */

export type ScoreProvenance = "DETAILED" | "SCREENING";

export type DisplayScore = {
  score: number;
  provenance: ScoreProvenance;
};

/** Clamp screening/index scores into the user-facing 0–100 band. */
export function clampScreeningScore(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/**
 * Resolve the one score shown to users.
 * Never display >100 or <0 — clamp both DETAILED and SCREENING (does not mutate stored Opportunity.score).
 */
export function resolveDisplayScore(input: {
  screeningScore: number | null | undefined;
  opportunityScore?: number | null;
  opportunityId?: string | null;
}): DisplayScore {
  if (
    input.opportunityId &&
    input.opportunityScore != null &&
    Number.isFinite(input.opportunityScore)
  ) {
    return {
      score: clampScreeningScore(input.opportunityScore),
      provenance: "DETAILED",
    };
  }
  return {
    score: clampScreeningScore(input.screeningScore ?? 0),
    provenance: "SCREENING",
  };
}

/** Normalize strategy score maps on index write/read. */
export function clampStrategyScores(
  scores: Record<string, number> | null | undefined,
): Record<string, number> | null {
  if (!scores || typeof scores !== "object") return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(scores)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = clampScreeningScore(v);
  }
  return out;
}
