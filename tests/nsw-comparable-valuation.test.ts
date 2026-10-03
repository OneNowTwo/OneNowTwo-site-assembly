import { describe, expect, it } from "vitest";
import { buildComparableValuation, scoreComparable, type CompSaleInput } from "@/lib/analysis/comparable-valuation";
import { parseNswSaleDate, parseAddressParts, haversineM } from "@/lib/data-sources/nsw-property-sales";

function sale(partial: Partial<CompSaleInput> & { id: string; salePrice: number; distanceM: number }): CompSaleInput {
  return {
    address: partial.address ?? `${partial.id} Test St`,
    saleDate: partial.saleDate ?? "2025-06-01",
    saleDateMs: partial.saleDateMs ?? Date.parse("2025-06-01T00:00:00Z"),
    landAreaSqm: partial.landAreaSqm ?? 280,
    strata: partial.strata ?? false,
    suburb: partial.suburb ?? "Neutral Bay",
    source: "NSW REGISTERED SALE",
    ...partial,
  };
}

describe("NSW sale helpers", () => {
  it("parses NSW sale_date strings", () => {
    expect(parseNswSaleDate("6 March 2020").iso).toBe("2020-03-06");
    expect(parseNswSaleDate("16 May 2026").ms).toBeTruthy();
  });

  it("parses address parts", () => {
    expect(parseAddressParts("5 Reserve Street, Neutral Bay")).toEqual({ houseNo: "5", street: "Reserve Street" });
  });

  it("haversine is ~0 for same point", () => {
    expect(haversineM(151.219, -33.837, 151.219, -33.837)).toBeLessThan(1);
  });
});

describe("comparable scoring + estimate", () => {
  const nowMs = Date.parse("2026-10-03T00:00:00Z");
  const subject = { areaSqm: 280, suburb: "Neutral Bay", zone: "R2", isStrata: false };

  it("scores closer / more similar land higher", () => {
    const near = scoreComparable(sale({ id: "a", salePrice: 3_000_000, distanceM: 50, landAreaSqm: 275 }), subject, { nowMs });
    const far = scoreComparable(sale({ id: "b", salePrice: 3_000_000, distanceM: 900, landAreaSqm: 400 }), subject, { nowMs });
    expect(near.similarity).toBeGreaterThan(far.similarity);
  });

  it("builds a mid/low/high screening estimate without suburb averaging", () => {
    const sales = [
      sale({ id: "1", address: "9 Reserve Street", salePrice: 2_830_000, distanceM: 20, landAreaSqm: 279, saleDateMs: Date.parse("2025-08-28Z") }),
      sale({ id: "2", address: "59 Undercliff Street", salePrice: 3_500_000, distanceM: 60, landAreaSqm: 247, saleDateMs: Date.parse("2026-05-16Z") }),
      sale({ id: "3", address: "65 Undercliff Street", salePrice: 2_490_000, distanceM: 80, landAreaSqm: 240, saleDateMs: Date.parse("2025-07-04Z") }),
      sale({ id: "4", address: "11 Yeo Street", salePrice: 3_085_000, distanceM: 120, landAreaSqm: 259, saleDateMs: Date.parse("2025-07-19Z") }),
      sale({ id: "5", address: "18 Yeo Street", salePrice: 3_740_000, distanceM: 200, landAreaSqm: 334, saleDateMs: Date.parse("2026-03-23Z") }),
      sale({ id: "6", address: "37A Spruson Street", salePrice: 2_700_000, distanceM: 265, landAreaSqm: 293, saleDateMs: Date.parse("2026-03-25Z") }),
      // distant outlier should be down-weighted / dropped
      sale({ id: "7", address: "Outlier Rd", salePrice: 8_500_000, distanceM: 400, landAreaSqm: 290, saleDateMs: Date.parse("2026-01-01Z") }),
    ];
    const result = buildComparableValuation(sales, subject, { nowMs });
    expect(result.mid).not.toBeNull();
    expect(result.low).not.toBeNull();
    expect(result.high).not.toBeNull();
    expect(result.low!).toBeLessThanOrEqual(result.mid!);
    expect(result.high!).toBeGreaterThanOrEqual(result.mid!);
    expect(result.numberOfComps).toBeGreaterThanOrEqual(3);
    expect(result.label).toBe("COMPARABLE-DERIVED SCREENING ESTIMATE");
    // Sanity: Neutral Bay house comps should land in low–mid $3m band, not ~$1.1m fallback territory
    expect(result.mid!).toBeGreaterThan(2_200_000);
    expect(result.mid!).toBeLessThan(4_800_000);
    // Outlier should not be included
    expect(result.comps.find((c) => c.id === "7")?.included).toBe(false);
  });

  it("honours user exclusions and recalculates", () => {
    const sales = [
      sale({ id: "1", salePrice: 2_800_000, distanceM: 40, landAreaSqm: 270 }),
      sale({ id: "2", salePrice: 3_000_000, distanceM: 50, landAreaSqm: 280 }),
      sale({ id: "3", salePrice: 3_200_000, distanceM: 60, landAreaSqm: 290 }),
      sale({ id: "4", salePrice: 3_100_000, distanceM: 70, landAreaSqm: 275 }),
      sale({ id: "5", salePrice: 5_500_000, distanceM: 80, landAreaSqm: 285 }),
    ];
    const withAll = buildComparableValuation(sales, subject, { nowMs });
    const withoutHigh = buildComparableValuation(sales, subject, { nowMs, excludedIds: new Set(["5"]) });
    expect(withoutHigh.mid).not.toBeNull();
    if (withAll.comps.find((c) => c.id === "5")?.included) {
      expect(withoutHigh.mid!).toBeLessThanOrEqual(withAll.mid!);
    }
    expect(withoutHigh.comps.find((c) => c.id === "5")?.included).toBe(false);
  });

  it("returns insufficient when too few comps", () => {
    const result = buildComparableValuation(
      [sale({ id: "1", salePrice: 3_000_000, distanceM: 40, landAreaSqm: 280 })],
      subject,
      { nowMs },
    );
    expect(result.mid).toBeNull();
    expect(result.confidence).toBe("LOW");
    expect(result.note).toMatch(/INSUFFICIENT/i);
  });
});
