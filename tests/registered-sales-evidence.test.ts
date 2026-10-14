import { describe, expect, it } from "vitest";
import {
  formatOfferVsMarket,
  provenanceLabelsForDetail,
  registeredSaleEvidenceId,
  summariseRegisteredSalesEvidence,
} from "@/lib/analysis/registered-sales-evidence";
import type { OpportunityInputs } from "@/lib/analysis/assumptions";

function comp(
  partial: Partial<NonNullable<NonNullable<OpportunityInputs["lotValuationDetails"]>[string]["comps"]>[number]> & {
    id: string;
    address: string;
    salePrice: number;
  },
) {
  return {
    saleDate: "2025-06-01",
    landAreaSqm: 280,
    distanceM: 100,
    similarity: 0.8,
    included: true,
    source: "NSW REGISTERED SALE",
    dealing: null as string | null,
    excludeReason: null as string | null,
    ...partial,
  };
}

/** Bexley-style 2-lot fixture — shared sale appears under both lots. */
function bexleyStyleDetails(): OpportunityInputs["lotValuationDetails"] {
  const shared = comp({
    id: "shared-1",
    dealing: "AS123456",
    address: "12 Sample Street, Bexley",
    salePrice: 1_050_000,
    included: true,
  });
  const lotAOnly = comp({
    id: "a-only",
    dealing: "AS111111",
    address: "1 Alpha Street, Bexley",
    salePrice: 980_000,
    included: true,
  });
  const lotBOnly = comp({
    id: "b-only",
    dealing: "AS222222",
    address: "2 Beta Street, Bexley",
    salePrice: 1_100_000,
    included: true,
  });
  const excludedShared = comp({
    id: "excl",
    dealing: "AS999999",
    address: "99 Outlier Rd, Bexley",
    salePrice: 2_500_000,
    included: false,
    excludeReason: "Price outlier",
  });

  return {
    "nsw-cadid:9a": {
      mid: 1_050_000,
      low: 980_000,
      high: 1_120_000,
      confidence: "MEDIUM",
      source: "COMPARABLE_DERIVED",
      provider: "NSW",
      numberOfComps: 10,
      valuationLabel: "COMPARABLE-DERIVED SCREENING ESTIMATE",
      subjectLastSale: {
        address: "9A Washington Street, Bexley",
        salePrice: 720_000,
        saleDate: "2018-03-12",
        landAreaSqm: 303,
        source: "NSW REGISTERED SALE",
      },
      comps: [shared, lotAOnly, excludedShared, ...Array.from({ length: 7 }, (_, i) =>
        comp({
          id: `a-${i}`,
          dealing: `AA${100000 + i}`,
          address: `${10 + i} Near A St, Bexley`,
          salePrice: 1_000_000 + i * 10_000,
        }),
      )],
    },
    "nsw-cadid:9": {
      mid: 1_090_000,
      low: 1_000_000,
      high: 1_180_000,
      confidence: "MEDIUM",
      source: "COMPARABLE_DERIVED",
      provider: "NSW",
      numberOfComps: 10,
      valuationLabel: "COMPARABLE-DERIVED SCREENING ESTIMATE",
      comps: [shared, lotBOnly, excludedShared, ...Array.from({ length: 7 }, (_, i) =>
        comp({
          id: `b-${i}`,
          dealing: `BB${100000 + i}`,
          address: `${20 + i} Near B St, Bexley`,
          salePrice: 1_050_000 + i * 10_000,
        }),
      )],
    },
  };
}

const bexleyLots = [
  {
    id: "lot-9a",
    label: "9A Washington Street",
    address: "9A Washington Street, Bexley",
    externalParcelId: "nsw-cadid:9a",
    included: true,
    marketValue: 1_050_000,
    marketValueSource: "COMPARABLE_DERIVED",
    marketValueProvider: "NSW",
  },
  {
    id: "lot-9",
    label: "9 Washington Street",
    address: "9 Washington Street, Bexley",
    externalParcelId: "nsw-cadid:9",
    included: true,
    marketValue: 1_090_000,
    marketValueSource: "COMPARABLE_DERIVED",
    marketValueProvider: "NSW",
  },
];

describe("registeredSaleEvidenceId", () => {
  it("prefers dealing, then falls back to address+date+price", () => {
    expect(registeredSaleEvidenceId({ dealing: "as123", id: "x", address: "1 St", saleDate: "2024-01-01", salePrice: 1 })).toBe(
      "dealing:AS123",
    );
    expect(registeredSaleEvidenceId({ dealing: null, id: "manual:1", address: "1 Test St", saleDate: "2024-01-01", salePrice: 500_000 })).toBe(
      "asp:1 test st|2024-01-01|500000",
    );
  });
});

describe("summariseRegisteredSalesEvidence", () => {
  it("dedupes the same registered sale appearing for two lots", () => {
    const summary = summariseRegisteredSalesEvidence(bexleyStyleDetails(), bexleyLots, {
      combinedExistingValue: 2_140_000,
    });
    // Each lot has 10 comps in the fixture arrays (shared + unique + excluded + 7)
    expect(summary.lotCards).toHaveLength(2);
    expect(summary.lotCards[0].mid).toBe(1_050_000);
    expect(summary.lotCards[1].mid).toBe(1_090_000);
    // Shared dealing AS123456 and excluded AS999999 counted once each
    expect(summary.rawCompMentions).toBeGreaterThan(summary.uniqueSaleCount);
    expect(summary.uniqueSaleCount).toBeLessThan(summary.rawCompMentions);
    // Unique = 1 shared + 1 A-only + 1 B-only + 1 excluded + 7 A + 7 B = 18
    expect(summary.uniqueSaleCount).toBe(18);
    // Included unique excludes the shared excluded dealing
    expect(summary.uniqueIncludedSaleCount).toBe(17);
  });

  it("reports unique evidence count for Bexley-style 2-lot summary", () => {
    const summary = summariseRegisteredSalesEvidence(bexleyStyleDetails(), bexleyLots, {
      combinedExistingValue: 2_140_000,
    });
    expect(summary.hasEvidence).toBe(true);
    expect(summary.combinedMid).toBe(2_140_000);
    expect(summary.summaryLine).toBe("Existing value based on 17 NSW registered sales");
    expect(summary.primarySourceLabel).toBe("NSW registered sales");
    expect(summary.dataQuality).toBe("OFFICIAL / LIVE NSW DATA");
    expect(summary.estimateKind).toContain("COMPARABLE-DERIVED");
  });

  it("keeps included vs excluded sale counts per lot", () => {
    const summary = summariseRegisteredSalesEvidence(bexleyStyleDetails(), bexleyLots);
    for (const card of summary.lotCards) {
      expect(card.excludedCompCount).toBe(1);
      expect(card.includedCompCount).toBe(9);
      expect(card.comps.some((c) => !c.included && c.excludeReason)).toBe(true);
      expect(card.comps.filter((c) => c.included).every((c) => c.included)).toBe(true);
    }
  });

  it("does not change existing value when transforming evidence for display", () => {
    const details = bexleyStyleDetails();
    const beforeMids = bexleyLots.map((l) => details[l.externalParcelId]!.mid);
    const summary = summariseRegisteredSalesEvidence(details, bexleyLots, { combinedExistingValue: 2_140_000 });
    expect(summary.lotCards.map((c) => c.mid)).toEqual(beforeMids);
    expect(summary.combinedMid).toBe(2_140_000);
    // Source object untouched
    expect(details["nsw-cadid:9a"]!.mid).toBe(1_050_000);
    expect(details["nsw-cadid:9"]!.mid).toBe(1_090_000);
  });

  it("truthful empty state when no registered evidence", () => {
    const summary = summariseRegisteredSalesEvidence({}, bexleyLots);
    expect(summary.hasEvidence).toBe(false);
    expect(summary.uniqueSaleCount).toBe(0);
    expect(summary.summaryLine).toMatch(/No registered-sales evidence/);
    expect(summary.primarySourceLabel).toBe("—");
  });

  it("keeps manual ComparableSale concept separate — summary ignores Prisma comps", () => {
    // Only lotValuationDetails drive registered evidence; empty details => empty evidence
    // even if a caller also has manual acquisition comps elsewhere.
    const summary = summariseRegisteredSalesEvidence(undefined, bexleyLots);
    expect(summary.hasEvidence).toBe(false);
    expect(summary.lotCards).toEqual([]);
  });
});

describe("provenanceLabelsForDetail", () => {
  it("labels NSW registered evidence correctly (not Manual / Demo / AVM)", () => {
    const labels = provenanceLabelsForDetail({
      mid: 1_000_000,
      source: "COMPARABLE_DERIVED",
      provider: "NSW",
      numberOfComps: 10,
      valuationLabel: "COMPARABLE-DERIVED SCREENING ESTIMATE",
      comps: [],
    });
    expect(labels.sourceLabel).toBe("NSW registered sales");
    expect(labels.dataQuality).toBe("OFFICIAL / LIVE NSW DATA");
    expect(labels.estimateKind).toContain("SYSTEM CALCULATION");
    expect(labels.dataQuality).not.toMatch(/Manual|Demo|AVM/i);
  });

  it("preserves demo label when demoFinancialData is true", () => {
    const labels = provenanceLabelsForDetail(
      { mid: 1, source: "COMPARABLE_DERIVED", provider: "NSW", comps: [] },
      { demoFinancialData: true },
    );
    expect(labels.dataQuality).toBe("Manual / demo");
    expect(labels.estimateKind).toBe("DEMO DATA");
  });
});

describe("formatOfferVsMarket", () => {
  it("renders negative premium as below market", () => {
    expect(formatOfferVsMarket(-0.79)).toBe("79% below market");
    expect(formatOfferVsMarket(0.12)).toBe("12% above market");
    expect(formatOfferVsMarket(0)).toBe("At market");
    expect(formatOfferVsMarket(null)).toBe("—");
  });
});
