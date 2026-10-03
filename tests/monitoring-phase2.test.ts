import { describe, expect, it } from "vitest";
import {
  matchesWatchFilters,
  alertCriteriaSchema,
  watchFiltersSchema,
  opportunityMatchesCriteria,
} from "@/lib/monitoring/types";

describe("Phase 2 watch filters", () => {
  it("parses filter schema", () => {
    const f = watchFiltersSchema.parse({
      minSiteAreaSqm: 800,
      minHeadroom: 1_000_000,
      minScore: 75,
      pathway: "LMR",
      minLots: 3,
    });
    expect(f.minScore).toBe(75);
    expect(f.pathway).toBe("LMR");
  });

  it("matches and rejects assemblies against filters", () => {
    const row = {
      totalSiteArea: 2400,
      acquisitionHeadroom: 1_800_000,
      acquisitionHeadroomPercent: 0.25,
      score: 82,
      combinedMarketValue: 7_000_000,
      maxLandBudget: 8_800_000,
      lotCount: 4,
      pathway: "LMR",
    };
    expect(matchesWatchFilters(row, { minScore: 75, minHeadroom: 1_000_000, minLots: 3 })).toBe(true);
    expect(matchesWatchFilters(row, { minScore: 90 })).toBe(false);
    expect(matchesWatchFilters(row, { pathway: "TOD" })).toBe(false);
    expect(matchesWatchFilters(row, { pathway: "LMR" })).toBe(true);
  });
});

describe("Phase 2 alert criteria", () => {
  it("matches new high-score assemblies", () => {
    const criteria = alertCriteriaSchema.parse({
      suburb: "Manly Vale",
      minScore: 75,
      minHeadroom: 1_000_000,
      newAssembly: true,
    });
    expect(
      opportunityMatchesCriteria(
        {
          suburb: "Manly Vale",
          score: 82,
          acquisitionHeadroom: 1_500_000,
          lotCount: 4,
          isNew: true,
        },
        criteria,
      ),
    ).toBe(true);
    expect(
      opportunityMatchesCriteria(
        {
          suburb: "Mosman",
          score: 82,
          acquisitionHeadroom: 1_500_000,
          isNew: true,
        },
        criteria,
      ),
    ).toBe(false);
  });

  it("detects becomesViable transition", () => {
    const criteria = alertCriteriaSchema.parse({ becomesViable: true });
    expect(
      opportunityMatchesCriteria({ acquisitionHeadroom: 200_000, wasNonViable: true }, criteria),
    ).toBe(true);
    expect(
      opportunityMatchesCriteria({ acquisitionHeadroom: 200_000, wasNonViable: false }, criteria),
    ).toBe(false);
  });
});
