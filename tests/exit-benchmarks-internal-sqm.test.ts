import { describe, expect, it } from "vitest";
import {
  applyExitBenchmarksToUnitMix,
  buildLocalExitBenchmarks,
  buildLocalExitBenchmarksFromNswSales,
  exitPriceSourceLabel,
  mergeExitBenchmarkSets,
  type ExitBenchmarkSet,
} from "@/lib/analysis/exit-benchmarks";
import {
  resolveAreaExitBenchmarks,
  suburbResultToExitBenchmarkSet,
  type ExitBenchmarkProvider,
} from "@/lib/analysis/exit-benchmark-provider";
import { DEFAULT_UNIT_MIX_TEMPLATE } from "@/lib/analysis/unit-mix";
import { computeUnitMix } from "@/lib/analysis/unit-mix";
import { computeFeasibility, grvCrossCheckDiscrepancy } from "@/lib/analysis/feasibility";
import { DEFAULT_ASSUMPTIONS, parseOpportunityInputs } from "@/lib/analysis/assumptions";
import { analyseOpportunity, siteBasisFromPlanningSnapshot } from "@/lib/analysis/opportunity";
import { calculateAssemblyFeasibility } from "@/lib/analysis/assembly-feasibility";
import { buildAdjacency } from "@/lib/analysis/geometry";
import type { ParcelData } from "@/lib/types";
import type { Polygon } from "geojson";
import { buildPlanningSnapshot } from "@/lib/planning/planning-snapshot";

const LOCAL_STRATA = [980_000, 1_000_000, 1_030_000, 1_050_000, 1_080_000, 1_100_000];

function bedroomProvider(medians: Record<string, number>, sampleSize = 40): ExitBenchmarkProvider {
  return {
    name: "test-bedroom-provider",
    async getSuburbUnitBenchmarks({ suburb }) {
      return {
        suburb,
        state: "NSW",
        checkedAt: "2026-10-04T00:00:00.000Z",
        source: "Test bedroom medians",
        overallUnitMedian: medians["2 Bed"] ?? null,
        overallSampleSize: sampleSize,
        byBedroom: Object.fromEntries(
          Object.entries(medians).map(([name, medianPrice]) => [
            name,
            { medianPrice, sampleSize, source: "Test bedroom medians" },
          ]),
        ),
      };
    },
  };
}

describe("exit benchmarks + internal $/sqm cross-check + height source", () => {
  it("A: bedroom-specific local median overrides weaker local strata/unit fallback", async () => {
    const nsw = buildLocalExitBenchmarksFromNswSales(
      LOCAL_STRATA.map((salePrice) => ({ salePrice, strata: true, landAreaSqm: 85 })),
    );
    expect(["LOCAL_UNIT_MEDIAN", "LOCAL_STRATA_BENCHMARK"]).toContain(nsw.byUnitType["2 Bed"]!.source);
    expect(nsw.byUnitType["2 Bed"]!.pricePerUnit).toBeLessThan(1_200_000);

    const resolved = await resolveAreaExitBenchmarks({
      suburb: "Manly Vale",
      nswSales: LOCAL_STRATA.map((salePrice) => ({ salePrice, strata: true, landAreaSqm: 85 })),
      bedroomProviders: [bedroomProvider({ "1 Bed": 820_000, "2 Bed": 1_250_000 })],
    });
    expect(resolved.byUnitType["1 Bed"]!.source).toBe("LOCAL_BEDROOM_MEDIAN");
    expect(resolved.byUnitType["1 Bed"]!.pricePerUnit).toBe(820_000);
    expect(resolved.byUnitType["2 Bed"]!.pricePerUnit).toBe(1_250_000);
    // Thin types without bedroom evidence keep NSW fallback — not invented premiums.
    expect(resolved.byUnitType["3 Bed"]!.source).not.toBe("LOCAL_BEDROOM_MEDIAN");
  });

  it("B: user override beats local bedroom median", () => {
    const benchmarks: ExitBenchmarkSet = suburbResultToExitBenchmarkSet({
      suburb: "Testville",
      state: "NSW",
      checkedAt: "2026-10-04T00:00:00.000Z",
      source: "test",
      overallUnitMedian: 1_250_000,
      overallSampleSize: 80,
      byBedroom: {
        "2 Bed": { medianPrice: 1_250_000, sampleSize: 80, source: "test" },
      },
    });
    const rows = DEFAULT_UNIT_MIX_TEMPLATE.map((r) =>
      r.name === "2 Bed" ? { ...r, count: 10, salePricePerUnit: 1_400_000 } : r,
    );
    const applied = applyExitBenchmarksToUnitMix(rows, benchmarks, { "2 Bed": "USER_OVERRIDE" });
    expect(applied.rows.find((r) => r.name === "2 Bed")!.salePricePerUnit).toBe(1_400_000);
    expect(applied.sources["2 Bed"]).toBe("USER_OVERRIDE");
  });

  it("C+D: $/sqm cross-check uses internal area, not saleable/balcony area", () => {
    const mix = [
      { name: "1 Bed", count: 8, avgInternalArea: 55, avgExternalArea: 8, avgSaleableArea: 58, salePricePerUnit: 820_000 },
      { name: "2 Bed", count: 12, avgInternalArea: 80, avgExternalArea: 12, avgSaleableArea: 88, salePricePerUnit: 1_250_000 },
      { name: "3 Bed", count: 4, avgInternalArea: 110, avgExternalArea: 15, avgSaleableArea: 125, salePricePerUnit: 1_529_000 },
      { name: "Penthouse", count: 1, avgInternalArea: 160, avgExternalArea: 40, avgSaleableArea: 180, salePricePerUnit: 2_622_000 },
    ];
    const totals = computeUnitMix(mix);
    expect(totals.totalInternalArea).toBe(8 * 55 + 12 * 80 + 4 * 110 + 160); // 2000
    expect(totals.totalSaleableArea).toBeGreaterThan(totals.totalInternalArea);

    const f = computeFeasibility({
      gfa: 2736,
      saleableArea: totals.totalSaleableArea,
      dwellings: totals.totalUnits,
      lotCount: 2,
      unitMix: mix,
      a: { ...DEFAULT_ASSUMPTIONS, revenueMode: "UNIT_MIX", salePricePerSqm: 15_500 },
    });
    expect(f.crossCheckAreaBasis).toBe("INTERNAL");
    expect(f.crossCheckAreaSqm).toBe(2000);
    expect(f.crossCheckGrv).toBeCloseTo(2000 * 15_500, 0);
    expect(f.crossCheckGrv).not.toBeCloseTo(totals.totalSaleableArea * 15_500, 0);

    const warn = grvCrossCheckDiscrepancy(f.grv, f.crossCheckAreaSqm!, 15_500, { areaBasis: "INTERNAL" });
    if (warn) {
      expect(warn.areaBasis).toBe("INTERNAL");
      expect(warn.areaSqm).toBe(2000);
    }
  });

  it("E: State pathway height is not labelled USER ASSUMPTION", () => {
    const snapshot = buildPlanningSnapshot({
      lots: [
        {
          id: "a",
          label: "Lot A",
          included: true,
          areaSqm: 700,
          zone: "R3",
          zoneName: "Medium Density",
          fsr: null,
          heightM: 8.5,
          minLotSizeSqm: 450,
          heritage: null,
          planningInstrument: "Test LEP",
          planningCheckedAt: "2026-10-04T00:00:00.000Z",
        },
      ],
      site: {
        siteAreaSqm: 700,
        fsr: 2.2,
        fsrSource: "STATE_PATHWAY",
        yieldStatus: "CALCULABLE",
        lepFsr: null,
        statePathwayFsr: 2.2,
        statePathwayName: "Low & Mid-Rise Housing (Housing SEPP)",
        lmrCentreName: "Test Centre",
        lmrNearestDistanceM: 200,
        lmrFurthestDistanceM: 200,
        lmrProximityLabel: "PASS — ESTIMATED",
        heightLimitM: 22,
      },
      statePathwayHeightM: 22,
    });
    const site = siteBasisFromPlanningSnapshot(snapshot, parseOpportunityInputs({}));
    expect(site.heightSource).toBe("STATE_PATHWAY");
    expect(site.heightSource).not.toBe("OVERRIDE");

    const overridden = siteBasisFromPlanningSnapshot(snapshot, parseOpportunityInputs({ heightOverrideM: 28 }));
    expect(overridden.heightSource).toBe("OVERRIDE");
  });

  it("F: scan and analyse produce the same GRV / max payable / headroom / score with bedroom benchmarks", async () => {
    const benchmarks = await resolveAreaExitBenchmarks({
      suburb: "Testville",
      nswSales: LOCAL_STRATA.map((salePrice) => ({ salePrice, strata: true, landAreaSqm: 85 })),
      bedroomProviders: [bedroomProvider({ "1 Bed": 820_000, "2 Bed": 1_250_000 })],
    });

    const origin = { lat: -33.78, lng: 151.26 };
    const mLat = 111_320;
    const mLng = mLat * Math.cos((origin.lat * Math.PI) / 180);
    const rect = (x: number, w: number, h: number): Polygon => {
      const p = (dx: number, dy: number) => [origin.lng + dx / mLng, origin.lat + dy / mLat];
      return { type: "Polygon", coordinates: [[p(x, 0), p(x + w, 0), p(x + w, h), p(x, h), p(x, 0)]] };
    };
    const parcels: ParcelData[] = [
      {
        externalParcelId: "lot-a",
        source: "LIVE_NSW",
        lot: "A",
        section: null,
        dp: "DP1",
        lotIdString: "A//DP1",
        address: "10 Test Street, Testville",
        suburb: "Testville",
        geometry: rect(0, 20, 35),
        centroid: [origin.lng + 10 / mLng, origin.lat + 17.5 / mLat],
        areaSqm: 700,
        isStrata: false,
        planning: {
          zone: "R3",
          zoneName: "Medium Density Residential",
          fsr: null,
          fsrStatus: "NO_MAPPED",
          fsrControls: [],
          heightM: 8.5,
          minLotSizeSqm: 450,
          heritage: "None mapped",
          planningInstrument: "Test LEP",
          lga: "TEST",
          sources: {},
        },
        planningStatus: "ok",
        retrievedAt: "2026-10-04T00:00:00.000Z",
        valuation: {
          mid: 3_357_840,
          low: 3_000_000,
          high: 3_700_000,
          status: "COMPARABLE_DERIVED",
          confidence: "MEDIUM",
          source: "COMPARABLE_DERIVED",
          provider: "NSW",
          method: "nsw_property_level_land_rate|property_level",
          checkedAt: "2026-10-04T00:00:00.000Z",
        },
      },
      {
        externalParcelId: "lot-b",
        source: "LIVE_NSW",
        lot: "B",
        section: null,
        dp: "DP1",
        lotIdString: "B//DP1",
        address: "10 Test Street, Testville",
        suburb: "Testville",
        geometry: rect(20, 20, 35),
        centroid: [origin.lng + 30 / mLng, origin.lat + 17.5 / mLat],
        areaSqm: 682,
        isStrata: false,
        planning: {
          zone: "R3",
          zoneName: "Medium Density Residential",
          fsr: null,
          fsrStatus: "NO_MAPPED",
          fsrControls: [],
          heightM: 8.5,
          minLotSizeSqm: 450,
          heritage: "None mapped",
          planningInstrument: "Test LEP",
          lga: "TEST",
          sources: {},
        },
        planningStatus: "ok",
        retrievedAt: "2026-10-04T00:00:00.000Z",
        valuation: {
          mid: 3_357_840,
          low: 3_000_000,
          high: 3_700_000,
          status: "COMPARABLE_DERIVED",
          confidence: "MEDIUM",
          source: "COMPARABLE_DERIVED",
          provider: "NSW",
          method: "nsw_property_level_land_rate|property_level",
          checkedAt: "2026-10-04T00:00:00.000Z",
        },
      },
    ];

    const effective = {
      lep: { fsr: null, heightM: 8.5, label: "LEP", source: "Test", certainty: "OFFICIAL_LEP" as const },
      statePolicy: {
        fsr: 2.2,
        heightM: 22,
        label: "STATE",
        source: "LMR",
        certainty: "REQUIRES_PLANNING_CONFIRMATION" as const,
      },
      modelled: {
        fsr: 2.2,
        heightM: 22,
        label: "MODELLED",
        source: "LMR",
        certainty: "REQUIRES_PLANNING_CONFIRMATION" as const,
      },
      fsrUplift: 2.2,
      lmr: {
        centreName: "Test",
        band: "INNER_0_400" as const,
        distanceM: 200,
        straightLineDistanceM: 200,
        walkingDistanceM: null,
        distanceBasis: "STRAIGHT_LINE_APPROXIMATION" as const,
        proximityScreen: "PASS" as const,
        proximityLabel: "PASS — ESTIMATED",
        walkingStatus: "NOT_USED" as const,
        developmentType: "Residential flat building",
        zoneEligible: true,
        exclusionNotes: [],
      },
    };
    const effectiveByParcelId = new Map(parcels.map((p) => [p.externalParcelId, effective]));
    const scan = calculateAssemblyFeasibility({
      parcels,
      assumptions: DEFAULT_ASSUMPTIONS,
      effectiveByParcelId,
      adjacency: buildAdjacency(parcels.map((p) => ({ id: p.externalParcelId, geometry: p.geometry }))),
      exitBenchmarks: benchmarks,
    });

    const lots = parcels.map((p) => ({
      id: p.externalParcelId,
      label: p.address!,
      areaSqm: p.areaSqm,
      zone: "R3",
      zoneName: "Medium Density Residential",
      fsr: 2.2,
      fsrStatus: "MAPPED" as const,
      fsrControls: [],
      heightM: 22,
      minLotSizeSqm: 450,
      heritage: "None mapped",
      isStrata: false,
      planningKnown: true,
      marketValue: p.valuation!.mid,
      marketValueLow: p.valuation!.low,
      marketValueHigh: p.valuation!.high,
      marketValueSource: p.valuation!.source,
      marketValueMethod: p.valuation!.method,
      address: p.address,
      geometry: p.geometry,
      included: true,
      maxAllocationOverride: null,
      openingOfferOverride: null,
    }));
    const probe = analyseOpportunity(
      lots,
      DEFAULT_ASSUMPTIONS,
      parseOpportunityInputs({ fsrOverride: 2.2, fsrOverrideKind: "SCAN_MODELLED", heightOverrideM: null }),
    );
    const applied = applyExitBenchmarksToUnitMix(
      probe.unitMix.length ? probe.unitMix : DEFAULT_UNIT_MIX_TEMPLATE,
      benchmarks,
    );
    const detailed = analyseOpportunity(
      lots,
      DEFAULT_ASSUMPTIONS,
      parseOpportunityInputs({
        fsrOverride: 2.2,
        fsrOverrideKind: "SCAN_MODELLED",
        unitMix: applied.rows,
        exitPriceSources: applied.sources,
      }),
    );

    expect(scan.metrics.grv).toBeCloseTo(detailed.base.feasibility.grv, 0);
    expect(scan.metrics.maxPayableToOwners).toBeCloseTo(detailed.maxPayableToOwners, 0);
    expect(scan.metrics.acquisitionHeadroom ?? 0).toBeCloseTo(detailed.acquisitionHeadroom ?? 0, 0);
    expect(scan.score.score).toBe(detailed.score.score);
    expect(exitPriceSourceLabel("LOCAL_BEDROOM_MEDIAN")).toBe("LOCAL BEDROOM MEDIAN");
  });

  it("merge prefers bedroom medians without inventing thin 3-bed premiums", () => {
    const base = buildLocalExitBenchmarks(LOCAL_STRATA.map((salePrice) => ({ salePrice, strata: true })));
    const preferred = suburbResultToExitBenchmarkSet({
      suburb: "X",
      state: "NSW",
      checkedAt: "2026-10-04T00:00:00.000Z",
      source: "Domain",
      overallUnitMedian: 1_250_000,
      overallSampleSize: 80,
      byBedroom: {
        "1 Bed": { medianPrice: 820_000, sampleSize: 39, source: "Domain" },
        "2 Bed": { medianPrice: 1_250_000, sampleSize: 80, source: "Domain" },
      },
    });
    const merged = mergeExitBenchmarkSets(base, preferred);
    expect(merged.byUnitType["1 Bed"]!.pricePerUnit).toBe(820_000);
    expect(merged.byUnitType["2 Bed"]!.pricePerUnit).toBe(1_250_000);
    expect(merged.byUnitType["3 Bed"]!.source).not.toBe("LOCAL_BEDROOM_MEDIAN");
  });
});
