import { describe, expect, it } from "vitest";
import { allocateOffers } from "@/lib/analysis/allocation";

describe("offer allocation", () => {
  it("weights the budget by market value and applies the opening %", () => {
    const r = allocateOffers(
      10_000_000,
      [
        { id: "a", marketValue: 1_000_000, areaSqm: 600 },
        { id: "b", marketValue: 1_500_000, areaSqm: 600 },
        { id: "c", marketValue: 2_500_000, areaSqm: 600 },
      ],
      0.85,
      2000,
    );
    expect(r.lots.map((l) => l.maximumOffer)).toEqual([2_000_000, 3_000_000, 5_000_000]);
    expect(r.lots[0].openingOffer).toBeCloseTo(1_700_000);
    expect(r.lots[0].openingPremium).toBeCloseTo(0.7);
    expect(r.lots[0].maximumPremium).toBeCloseTo(1.0);
    expect(r.totalMaximum).toBeCloseTo(10_000_000);
    expect(r.unallocated).toBeCloseTo(0);
  });

  it("honours manual overrides and shares the remainder pro rata", () => {
    const r = allocateOffers(
      9_000_000,
      [
        { id: "a", marketValue: 1_000_000, areaSqm: 500, maxOverride: 3_000_000 },
        { id: "b", marketValue: 1_000_000, areaSqm: 500 },
        { id: "c", marketValue: 2_000_000, areaSqm: 500, openingOverride: 2_500_000 },
      ],
      0.85,
      2000,
    );
    expect(r.lots[0].maximumOffer).toBe(3_000_000);
    expect(r.lots[1].maximumOffer).toBeCloseTo(2_000_000);
    expect(r.lots[2].maximumOffer).toBeCloseTo(4_000_000);
    expect(r.lots[2].openingOffer).toBe(2_500_000);
    expect(r.lots[2].openingPremium).toBeCloseTo(0.25);
  });

  it("falls back to area × $/sqm weighting when value is missing", () => {
    const r = allocateOffers(4_000_000, [{ id: "a", marketValue: null, areaSqm: 1000 }, { id: "b", marketValue: 1_000_000, areaSqm: 500 }], 0.85, 1000);
    expect(r.lots[0].weightEstimated).toBe(true);
    expect(r.lots[0].maximumOffer).toBeCloseTo(2_000_000);
    expect(r.lots[0].openingPremium).toBeNull();
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});
