import { describe, expect, it } from "vitest";
import { groupAcquisitionProperties, estimateWholePropertyValue } from "@/lib/analysis/acquisition-property";
import type { CompSaleInput } from "@/lib/analysis/comparable-valuation";
import { DEFAULT_ASSUMPTIONS } from "@/lib/analysis/assumptions";
import { materialCostInputGaps, computeFeasibility } from "@/lib/analysis/feasibility";
import { MVP_CONSTRUCTION_DEFAULT, constructionRateIncludesLiftAndBasement } from "@/lib/analysis/construction-benchmarks";
import {
  applyExitBenchmarksToUnitMix,
  buildLocalExitBenchmarks,
  isTemplateDefaultSalePrice,
} from "@/lib/analysis/exit-benchmarks";
import { DEFAULT_UNIT_MIX_TEMPLATE } from "@/lib/analysis/unit-mix";
import { assessEconomicConfidence } from "@/lib/analysis/economic-confidence";
import { estimatePropertyLevelValue } from "@/lib/analysis/property-level-valuation";

function makeComp(partial: Partial<CompSaleInput> & { id: string; salePrice: number; landAreaSqm: number }): CompSaleInput {
  return {
    address: partial.address ?? "Nearby St",
    saleDate: "2025-06-01",
    saleDateMs: Date.parse("2025-06-01"),
    distanceM: partial.distanceM ?? 200,
    strata: false,
    suburb: "Manly Vale",
    zone: "R3",
    source: "NSW REGISTERED SALE",
    ...partial,
  };
}

describe("simplify MVP economics", () => {
  it("values shared-address lots as one property via land-rate × combined area (not max-of-lot)", () => {
    // Typical local house comps (~$2,400–$2,800/sqm on 450–780 sqm) — scarce same-size peers for 1,382 sqm.
    const comps = Array.from({ length: 12 }, (_, i) => {
      const land = 450 + i * 28;
      const rate = 2400 + (i % 5) * 80;
      return makeComp({
        id: `h${i}`,
        salePrice: Math.round(land * rate),
        landAreaSqm: land,
        distanceM: 150 + i * 40,
      });
    });
    const lots = [
      {
        id: "lot37",
        address: "66-68 Kenneth Road, Manly Vale",
        areaSqm: 909,
        marketValue: 1_897_061,
        marketValueLow: 1_500_000,
        marketValueHigh: 2_200_000,
        comps,
      },
      {
        id: "lot36",
        address: "66-68 Kenneth Road, Manly Vale",
        areaSqm: 473,
        marketValue: 1_631_517,
        marketValueLow: 1_400_000,
        marketValueHigh: 1_800_000,
        comps,
      },
    ];
    const whole = estimateWholePropertyValue(lots);
    expect(whole.valueBasis).toBe("PROPERTY_LEVEL_COMPS");
    expect(whole.mid).toBeGreaterThan(2_800_000);
    expect(whole.mid).toBeLessThan(5_500_000);
    // Must not be the max-of-lot AVM (~$1.90m).
    expect(whole.mid).toBeGreaterThan(1_897_061);

    const props = groupAcquisitionProperties(lots);
    expect(props).toHaveLength(1);
    expect(props[0]!.valueBasis).toBe("PROPERTY_LEVEL_COMPS");
    expect(props[0]!.marketValue).toBe(whole.mid);

    const direct = estimatePropertyLevelValue({ areaSqm: 1382, suburb: "Manly Vale", sales: comps, isStrata: false });
    expect(["LOCAL_LAND_RATE", "COMBINED_AREA_COMPS"]).toContain(direct.methodDetail);
    expect(direct.mid).toBeGreaterThan(2_800_000);
    expect(Math.abs((direct.mid ?? 0) - (whole.mid ?? 0))).toBeLessThan(50_000);
  });

  it("defaults construction to BMT Sydney 4–8 MEDIUM and does not flag lift/basement as missing", () => {
    expect(DEFAULT_ASSUMPTIONS.constructionCostPerSqm).toBe(MVP_CONSTRUCTION_DEFAULT.costPerSqmGfa);
    expect(DEFAULT_ASSUMPTIONS.constructionCostPerSqm).toBe(4154);
    expect(constructionRateIncludesLiftAndBasement(4154)).toBe(true);
    const gaps = materialCostInputGaps(DEFAULT_ASSUMPTIONS);
    expect(gaps.find((g) => g.key === "basementParkingCost")).toBeUndefined();
    expect(gaps.find((g) => g.key === "liftsCost")).toBeUndefined();

    const f = computeFeasibility({
      gfa: 2736,
      saleableArea: 2200,
      dwellings: 25,
      lotCount: 2,
      a: { ...DEFAULT_ASSUMPTIONS, revenueMode: "PER_SQM", salePricePerSqm: 15_500 },
    });
    const core = f.costLines.find((l) => l.key === "construction");
    expect(core?.basis).toMatch(/BMT 2026/);
    const basement = f.costLines.find((l) => l.key === "basement");
    expect(basement?.basis).toMatch(/Included in BMT/);
  });

  it("applies local unit/strata medians to template exit prices", () => {
    const benchmarks = buildLocalExitBenchmarks([
      { salePrice: 900_000, bedrooms: 1, strata: true },
      { salePrice: 950_000, bedrooms: 1, strata: true },
      { salePrice: 1_200_000, bedrooms: 2, strata: true },
      { salePrice: 1_250_000, bedrooms: 2, strata: true },
      { salePrice: 1_220_000, bedrooms: 2, strata: true },
      { salePrice: 1_600_000, bedrooms: 3, strata: true },
      { salePrice: 1_650_000, bedrooms: 3, strata: true },
    ]);
    expect(benchmarks.byUnitType["1 Bed"]!.source).toBe("LOCAL_BEDROOM_MEDIAN");
    expect(benchmarks.byUnitType["2 Bed"]!.pricePerUnit).toBe(1_220_000);

    const template = DEFAULT_UNIT_MIX_TEMPLATE.map((r) =>
      r.name === "1 Bed" ? { ...r, count: 8 } : r.name === "2 Bed" ? { ...r, count: 12 } : r,
    );
    expect(isTemplateDefaultSalePrice(template.find((r) => r.name === "1 Bed")!)).toBe(true);
    const applied = applyExitBenchmarksToUnitMix(template, benchmarks);
    expect(applied.applied).toBe(true);
    expect(applied.rows.find((r) => r.name === "1 Bed")!.salePricePerUnit).toBe(benchmarks.byUnitType["1 Bed"]!.pricePerUnit);
    expect(applied.sources["1 Bed"]).toBe("LOCAL_BEDROOM_MEDIAN");
  });

  it("exposes input sources without overall LOW feasibility theatre", () => {
    const f = computeFeasibility({
      gfa: 2736,
      saleableArea: 2200,
      dwellings: 25,
      lotCount: 2,
      a: { ...DEFAULT_ASSUMPTIONS, revenueMode: "PER_SQM", salePricePerSqm: 15_500 },
    });
    const ec = assessEconomicConfidence({
      planning: {
        effectiveControls: { fsrSource: "STATE_PATHWAY" },
      } as never,
      assumptions: DEFAULT_ASSUMPTIONS,
      feasibility: f,
      yield: { saleableArea: 2200 } as never,
      unitMix: [{ name: "2 Bed", count: 12, avgInternalArea: 80, avgExternalArea: 12, avgSaleableArea: 88, salePricePerUnit: 1_220_000 }],
      acquisitionProperties: [
        {
          id: "acq:x",
          label: "66-68",
          address: "66-68",
          lotIds: ["a", "b"],
          areaSqm: 1382,
          marketValue: 3_350_000,
          marketValueLow: 3_200_000,
          marketValueHigh: 3_500_000,
          valueBasis: "PROPERTY_LEVEL_COMPS",
          note: "shared",
          sourceLabel: "NSW registered comps — property-level",
        },
      ],
      cadastralLotSumMid: 3_528_578,
      overrides: {},
      exitPriceSources: { "2 Bed": "LOCAL_BEDROOM_MEDIAN" },
    });
    expect(ec.inputSources.some((s) => s.key === "constructionCostPerSqm" && s.sourceType === "PUBLISHED_BENCHMARK")).toBe(true);
    expect(ec.costLines.find((c) => c.key === "basementParkingCost")?.sourceType).toBe("INCLUDED_IN_BENCHMARK");
    expect(ec.exit.status).toBe("BENCHMARK");
    expect(ec.overall).not.toBe("LOW");
  });
});
