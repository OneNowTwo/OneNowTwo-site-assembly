/**
 * Published construction cost benchmarks for MVP defaults.
 * BMT figures are industry guide rates — editable assumptions, not QS advice.
 */

export type ConstructionFinishLevel = "LOW" | "MEDIUM" | "HIGH";

export interface ConstructionBenchmark {
  id: string;
  city: string;
  buildingType: "apartment";
  storeyRange: { min: number; max: number };
  finish: ConstructionFinishLevel;
  /** $/sqm GFA */
  costPerSqmGfa: number;
  /** True when the published rate already includes lifts and basement parking. */
  includesLiftAndBasement: boolean;
  sourceLabel: string;
  guideYear: number;
}

/** BMT 2026 — Sydney 4–8 level unit complex including lift + basement parking. */
export const BMT_SYDNEY_4_8_UNIT_2026: Record<ConstructionFinishLevel, ConstructionBenchmark> = {
  LOW: {
    id: "bmt-sydney-4-8-unit-2026-low",
    city: "Sydney",
    buildingType: "apartment",
    storeyRange: { min: 4, max: 8 },
    finish: "LOW",
    costPerSqmGfa: 3866,
    includesLiftAndBasement: true,
    sourceLabel: "BMT 2026 — Sydney 4–8 level unit complex (incl. lift + basement)",
    guideYear: 2026,
  },
  MEDIUM: {
    id: "bmt-sydney-4-8-unit-2026-medium",
    city: "Sydney",
    buildingType: "apartment",
    storeyRange: { min: 4, max: 8 },
    finish: "MEDIUM",
    costPerSqmGfa: 4154,
    includesLiftAndBasement: true,
    sourceLabel: "BMT 2026 — Sydney 4–8 level unit complex MEDIUM (incl. lift + basement)",
    guideYear: 2026,
  },
  HIGH: {
    id: "bmt-sydney-4-8-unit-2026-high",
    city: "Sydney",
    buildingType: "apartment",
    storeyRange: { min: 4, max: 8 },
    finish: "HIGH",
    costPerSqmGfa: 5053,
    includesLiftAndBasement: true,
    sourceLabel: "BMT 2026 — Sydney 4–8 level unit complex HIGH (incl. lift + basement)",
    guideYear: 2026,
  },
};

/** MVP base default — BMT Sydney 4–8 MEDIUM. */
export const MVP_CONSTRUCTION_DEFAULT = BMT_SYDNEY_4_8_UNIT_2026.MEDIUM;

export function constructionBenchmarkForRate(costPerSqmGfa: number): ConstructionBenchmark | null {
  for (const b of Object.values(BMT_SYDNEY_4_8_UNIT_2026)) {
    if (b.costPerSqmGfa === costPerSqmGfa) return b;
  }
  return null;
}

/** True when the selected $/sqm already includes lift + basement (do not flag those as missing). */
export function constructionRateIncludesLiftAndBasement(costPerSqmGfa: number): boolean {
  return constructionBenchmarkForRate(costPerSqmGfa)?.includesLiftAndBasement ?? false;
}

export function constructionCostSourceLabel(costPerSqmGfa: number, isUserOverride: boolean): string {
  if (isUserOverride) return "USER OVERRIDE";
  const b = constructionBenchmarkForRate(costPerSqmGfa);
  if (b) return b.sourceLabel;
  return "DEFAULT";
}
