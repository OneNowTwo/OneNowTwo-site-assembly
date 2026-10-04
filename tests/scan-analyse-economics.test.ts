import { describe, expect, it } from "vitest";
import type { Polygon } from "geojson";
import type { ParcelData } from "@/lib/types";
import type { NominatedCentre } from "@/lib/data-sources/housing-sepp-lmr";
import { DEFAULT_ASSUMPTIONS, parseOpportunityInputs, defaultUnitMix } from "@/lib/analysis/assumptions";
import {
  applyExitBenchmarksToUnitMix,
  buildLocalExitBenchmarks,
  buildLocalExitBenchmarksFromNswSales,
  type ExitBenchmarkSet,
} from "@/lib/analysis/exit-benchmarks";
import { calculateAssemblyFeasibility } from "@/lib/analysis/assembly-feasibility";
import { applyValuationsToScanResult, runAreaScan } from "@/lib/analysis/area-scan";
import { analyseOpportunity, type OpportunityLot } from "@/lib/analysis/opportunity";
import { autoGenerateUnitMix, DEFAULT_MIX_SHARES, DEFAULT_UNIT_MIX_TEMPLATE } from "@/lib/analysis/unit-mix";
import { buildAdjacency } from "@/lib/analysis/geometry";
import type { EffectiveDevelopmentControls } from "@/lib/analysis/effective-controls";

const ORIGIN = { lat: -33.785, lng: 151.265 };
const M_PER_DEG_LAT = 111_320;
const mPerDegLng = M_PER_DEG_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180);

/** Manly Vale–like strata sample: local unit median ~$1.03m (no bedrooms in source). */
const LOCAL_STRATA_PRICES = [
  980_000, 1_000_000, 1_020_000, 1_030_000, 1_040_000, 1_050_000, 1_060_000, 1_080_000, 1_100_000, 950_000, 990_000, 1_070_000,
];

function localExitBenchmarks(): ExitBenchmarkSet {
  return buildLocalExitBenchmarks(LOCAL_STRATA_PRICES.map((salePrice) => ({ salePrice, strata: true, bedrooms: null })));
}

function rect(x: number, y: number, w: number, h: number): Polygon {
  const p = (dx: number, dy: number) => [ORIGIN.lng + dx / mPerDegLng, ORIGIN.lat + dy / M_PER_DEG_LAT];
  return { type: "Polygon", coordinates: [[p(x, y), p(x + w, y), p(x + w, y + h), p(x, y + h), p(x, y)]] };
}

function parcel(opts: {
  id: string;
  x: number;
  w: number;
  h: number;
  address: string;
  suburb: string;
  areaSqm: number;
  zone: string;
  lepFsr: number | null;
  heightM: number;
  mid: number;
  method?: string;
}): ParcelData {
  const geometry = rect(opts.x, 0, opts.w, opts.h);
  const centroid: [number, number] = [
    ORIGIN.lng + (opts.x + opts.w / 2) / mPerDegLng,
    ORIGIN.lat + opts.h / 2 / M_PER_DEG_LAT,
  ];
  return {
    externalParcelId: opts.id,
    source: "LIVE_NSW",
    lot: opts.id,
    section: null,
    dp: "DP100",
    lotIdString: `${opts.id}//DP100`,
    address: opts.address,
    suburb: opts.suburb,
    geometry,
    centroid,
    areaSqm: opts.areaSqm,
    isStrata: false,
    planning: {
      zone: opts.zone,
      zoneName: opts.zone === "R3" ? "Medium Density Residential" : "Low Density Residential",
      fsr: opts.lepFsr,
      fsrStatus: opts.lepFsr != null ? "MAPPED" : "NO_MAPPED",
      fsrControls: [],
      heightM: opts.heightM,
      minLotSizeSqm: 450,
      heritage: "None mapped",
      planningInstrument: "Test LEP",
      lga: "TEST",
      sources: {},
    },
    planningStatus: "ok",
    retrievedAt: "2026-10-04T00:00:00.000Z",
    valuation: {
      mid: opts.mid,
      low: Math.round(opts.mid * 0.9),
      high: Math.round(opts.mid * 1.1),
      status: "COMPARABLE_DERIVED",
      confidence: "MEDIUM",
      source: "COMPARABLE_DERIVED",
      provider: "NSW",
      method: opts.method ?? "nsw_comps",
      checkedAt: "2026-10-04T00:00:00.000Z",
    },
  };
}

function modelledControls(fsr: number, heightM: number, opts?: { lepFsr?: number | null; lepHeightM?: number | null; zone?: string }): EffectiveDevelopmentControls {
  const lepFsr = opts?.lepFsr ?? null;
  const lepHeightM = opts?.lepHeightM ?? null;
  return {
    lep: {
      fsr: lepFsr,
      heightM: lepHeightM,
      label: "LEP CONTROL",
      source: "Test LEP",
      certainty: "OFFICIAL_LEP",
    },
    statePolicy: {
      fsr,
      heightM,
      label: "STATE PATHWAY",
      source: "HOUSING_SEPP_LMR",
      certainty: "REQUIRES_PLANNING_CONFIRMATION",
    },
    modelled: {
      fsr,
      heightM,
      label: "MODELLED",
      source: "HOUSING_SEPP_LMR",
      certainty: "REQUIRES_PLANNING_CONFIRMATION",
    },
    fsrUplift: lepFsr != null ? Math.max(0, fsr - lepFsr) : fsr,
    lmr: {
      centreName: "Test Centre",
      band: "INNER_0_400",
      distanceM: 200,
      straightLineDistanceM: 200,
      walkingDistanceM: null,
      distanceBasis: "STRAIGHT_LINE_APPROXIMATION",
      proximityScreen: "PASS",
      proximityLabel: "PASS — ESTIMATED",
      walkingStatus: "NOT_USED",
      developmentType: "Residential flat building",
      zoneEligible: true,
      exclusionNotes: [],
    },
  };
}

function toOpportunityLots(parcels: ParcelData[], fsr: number, heightM: number): OpportunityLot[] {
  return parcels.map((p) => ({
    id: p.externalParcelId,
    label: p.address ?? p.externalParcelId,
    areaSqm: p.areaSqm,
    zone: p.planning?.zone ?? null,
    zoneName: p.planning?.zoneName ?? null,
    fsr,
    fsrStatus: "MAPPED" as const,
    fsrControls: [],
    heightM,
    minLotSizeSqm: p.planning?.minLotSizeSqm ?? null,
    heritage: p.planning?.heritage ?? null,
    isStrata: p.isStrata,
    planningKnown: true,
    marketValue: p.valuation?.mid ?? null,
    marketValueLow: p.valuation?.low ?? null,
    marketValueHigh: p.valuation?.high ?? null,
    marketValueSource: p.valuation?.source ?? null,
    marketValueMethod: p.valuation?.method ?? null,
    address: p.address,
    geometry: p.geometry,
    included: true,
    maxAllocationOverride: null,
    openingOfferOverride: null,
  }));
}

function analyseWithSameExits(
  parcels: ParcelData[],
  fsr: number,
  heightM: number,
  benchmarks: ExitBenchmarkSet,
  opts?: { fsrOverrideKind?: "SCAN_MODELLED" | "USER" },
) {
  const lots = toOpportunityLots(parcels, fsr, heightM);
  const kind = opts?.fsrOverrideKind ?? "SCAN_MODELLED";
  const baseInputs = {
    fsrOverride: fsr,
    fsrOverrideKind: kind,
    heightOverrideM: heightM,
  };
  const probe = analyseOpportunity(lots, DEFAULT_ASSUMPTIONS, parseOpportunityInputs(baseInputs));
  const mix0 = autoGenerateUnitMix(probe.base.yield.saleableArea, defaultUnitMix(), DEFAULT_MIX_SHARES);
  const applied = applyExitBenchmarksToUnitMix(mix0, benchmarks);
  return analyseOpportunity(
    lots,
    DEFAULT_ASSUMPTIONS,
    parseOpportunityInputs({
      ...baseInputs,
      unitMix: applied.rows,
      exitPriceSources: applied.sources,
    }),
  );
}

function expectScanMatchesAnalyse(
  scan: ReturnType<typeof calculateAssemblyFeasibility>,
  detailed: ReturnType<typeof analyseOpportunity>,
) {
  expect(scan.effectiveFsr ?? 0).toBeCloseTo(detailed.site.fsr, 3);
  expect(scan.metrics.dwellings).toBe(detailed.base.yield.dwellings);
  expect(scan.metrics.grv).toBeCloseTo(detailed.base.feasibility.grv, 0);
  expect(scan.metrics.combinedValue).toBeCloseTo(detailed.combinedExistingValue ?? 0, 0);
  expect(scan.metrics.maxPayableToOwners).toBeCloseTo(detailed.maxPayableToOwners, 0);
  expect(scan.metrics.acquisitionHeadroom ?? 0).toBeCloseTo(detailed.acquisitionHeadroom ?? 0, 0);
  expect(scan.score.score).toBe(detailed.score.score);
}

describe("scan ↔ analyse economics consistency", () => {
  it("builds local exit benchmarks from NSW-like sales (template is fallback only)", () => {
    const fromNsw = buildLocalExitBenchmarksFromNswSales(
      LOCAL_STRATA_PRICES.map((salePrice) => ({ salePrice, strata: true, landAreaSqm: 85 })),
    );
    expect(fromNsw.overallMedian).toBeTruthy();
    expect(fromNsw.byUnitType["2 Bed"]!.source).not.toBe("TEMPLATE_DEFAULT");
    expect(fromNsw.byUnitType["2 Bed"]!.pricePerUnit).toBeLessThan(DEFAULT_UNIT_MIX_TEMPLATE.find((r) => r.name === "2 Bed")!.salePricePerUnit);
    expect(fromNsw.byUnitType["1 Bed"]!.pricePerUnit).toBeLessThan(1_100_000);
  });

  it("Kenneth fixture: shared-address property counted once; scan matches analyse under local exits", () => {
    const benchmarks = localExitBenchmarks();
    const parcels = [
      parcel({
        id: "nsw-cadid:ken-a",
        x: 0,
        w: 30,
        h: 30,
        address: "66-68 Kenneth Road, Manly Vale",
        suburb: "Manly Vale",
        areaSqm: 909,
        zone: "R3",
        lepFsr: null,
        heightM: 8.5,
        mid: 3_357_840,
        method: "nsw_property_level_land_rate|property_level",
      }),
      parcel({
        id: "nsw-cadid:ken-b",
        x: 30,
        w: 16,
        h: 30,
        address: "66-68 Kenneth Road, Manly Vale",
        suburb: "Manly Vale",
        areaSqm: 473,
        zone: "R3",
        lepFsr: null,
        heightM: 8.5,
        mid: 3_357_840,
        method: "nsw_property_level_land_rate|property_level",
      }),
    ];
    const fsr = 2.2;
    const heightM = 22;
    const effectiveByParcelId = new Map(parcels.map((p) => [p.externalParcelId, modelledControls(fsr, heightM)]));
    const scan = calculateAssemblyFeasibility({
      parcels,
      assumptions: DEFAULT_ASSUMPTIONS,
      effectiveByParcelId,
      adjacency: buildAdjacency(parcels.map((p) => ({ id: p.externalParcelId, geometry: p.geometry }))),
      exitBenchmarks: benchmarks,
    });
    const detailed = analyseWithSameExits(parcels, fsr, heightM, benchmarks);

    expect(scan.metrics.combinedValue).toBe(3_357_840);
    expect(scan.metrics.combinedValue).not.toBe(6_715_680);
    expectScanMatchesAnalyse(scan, detailed);

    const templateScan = calculateAssemblyFeasibility({
      parcels,
      assumptions: DEFAULT_ASSUMPTIONS,
      effectiveByParcelId,
      adjacency: buildAdjacency(parcels.map((p) => ({ id: p.externalParcelId, geometry: p.geometry }))),
    });
    expect(templateScan.metrics.grv).toBeGreaterThan(scan.metrics.grv);
  });

  it("Jacaranda fixture: two distinct properties + FSR 0.8 — local exits drop max payable vs template", () => {
    const benchmarks = localExitBenchmarks();
    const parcels = [
      parcel({
        id: "nsw-cadid:jac-a",
        x: 0,
        w: 22,
        h: 32,
        address: "12 Jacaranda Place, Manly Vale",
        suburb: "Manly Vale",
        areaSqm: 704,
        zone: "R2",
        lepFsr: 0.5,
        heightM: 8.5,
        mid: 1_950_000,
      }),
      parcel({
        id: "nsw-cadid:jac-b",
        x: 22,
        w: 22,
        h: 32,
        address: "14 Jacaranda Place, Manly Vale",
        suburb: "Manly Vale",
        areaSqm: 704,
        zone: "R2",
        lepFsr: 0.5,
        heightM: 8.5,
        mid: 1_940_000,
      }),
    ];
    const fsr = 0.8;
    const heightM = 9.5;
    const effectiveByParcelId = new Map(
      parcels.map((p) => [p.externalParcelId, modelledControls(fsr, heightM, { lepFsr: 0.5, lepHeightM: 8.5 })]),
    );

    const withLocal = calculateAssemblyFeasibility({
      parcels,
      assumptions: DEFAULT_ASSUMPTIONS,
      effectiveByParcelId,
      adjacency: buildAdjacency(parcels.map((p) => ({ id: p.externalParcelId, geometry: p.geometry }))),
      exitBenchmarks: benchmarks,
    });
    const withTemplate = calculateAssemblyFeasibility({
      parcels,
      assumptions: DEFAULT_ASSUMPTIONS,
      effectiveByParcelId,
      adjacency: buildAdjacency(parcels.map((p) => ({ id: p.externalParcelId, geometry: p.geometry }))),
    });
    const detailed = analyseWithSameExits(parcels, fsr, heightM, benchmarks);

    expect(withLocal.metrics.combinedValue).toBe(1_950_000 + 1_940_000);
    expect(withLocal.metrics.grv).toBeLessThan(withTemplate.metrics.grv);
    expect(withLocal.metrics.maxPayableToOwners).toBeLessThan(withTemplate.metrics.maxPayableToOwners);
    // Template path is the old scan bug (optimistic apartment prices).
    expect(withTemplate.metrics.acquisitionHeadroom ?? 0).toBeGreaterThan(withLocal.metrics.acquisitionHeadroom ?? 0);
    expectScanMatchesAnalyse(withLocal, detailed);
  });

  it("Pitt Street fixture: different planning/size still reconciles scan ↔ analyse", () => {
    const benchmarks = localExitBenchmarks();
    const parcels = [
      parcel({
        id: "nsw-cadid:pitt-a",
        x: 0,
        w: 18,
        h: 40,
        address: "40 Pitt Street, Testville",
        suburb: "Testville",
        areaSqm: 720,
        zone: "R3",
        lepFsr: 1.0,
        heightM: 12,
        mid: 2_100_000,
      }),
      parcel({
        id: "nsw-cadid:pitt-b",
        x: 18,
        w: 18,
        h: 40,
        address: "42 Pitt Street, Testville",
        suburb: "Testville",
        areaSqm: 720,
        zone: "R3",
        lepFsr: 1.0,
        heightM: 12,
        mid: 2_200_000,
      }),
      parcel({
        id: "nsw-cadid:pitt-c",
        x: 36,
        w: 18,
        h: 40,
        address: "44 Pitt Street, Testville",
        suburb: "Testville",
        areaSqm: 720,
        zone: "R3",
        lepFsr: 1.0,
        heightM: 12,
        mid: 2_050_000,
      }),
    ];
    const fsr = 1.5;
    const heightM = 17.5;
    const effectiveByParcelId = new Map(
      parcels.map((p) => {
        const base = modelledControls(fsr, heightM, { lepFsr: 1.0, lepHeightM: 12 });
        return [
          p.externalParcelId,
          {
            ...base,
            statePolicy: null,
            modelled: {
              fsr,
              heightM,
              label: "LEP CONTROL",
              source: "Test LEP",
              certainty: "OFFICIAL_LEP" as const,
            },
            lmr: {
              ...base.lmr,
              centreName: null,
              band: "OUTSIDE" as const,
              distanceM: null,
              straightLineDistanceM: null,
              distanceBasis: "NONE" as const,
              proximityScreen: "FAIL" as const,
              proximityLabel: null,
              developmentType: null,
              zoneEligible: false,
            },
          },
        ];
      }),
    );

    const scan = calculateAssemblyFeasibility({
      parcels,
      assumptions: DEFAULT_ASSUMPTIONS,
      effectiveByParcelId,
      adjacency: buildAdjacency(parcels.map((p) => ({ id: p.externalParcelId, geometry: p.geometry }))),
      exitBenchmarks: benchmarks,
    });
    const detailed = analyseWithSameExits(parcels, fsr, heightM, benchmarks, { fsrOverrideKind: "USER" });
    expectScanMatchesAnalyse(scan, detailed);
  });

  it("applyValuationsToScanResult applies local exits before final ranking", () => {
    const centre: NominatedCentre = {
      id: "town-centre:manly-vale",
      label: "Manly Vale",
      layClass: "Town Centre",
      lng: ORIGIN.lng + 0.001,
      lat: ORIGIN.lat + 0.001,
      source: "test",
      retrievedAt: "2026-10-04T00:00:00.000Z",
    };
    const parcels = [
      parcel({
        id: "nsw-cadid:jac-a",
        x: 0,
        w: 22,
        h: 32,
        address: "12 Jacaranda Place, Manly Vale",
        suburb: "Manly Vale",
        areaSqm: 704,
        zone: "R2",
        lepFsr: 0.5,
        heightM: 8.5,
        mid: 1_950_000,
      }),
      parcel({
        id: "nsw-cadid:jac-b",
        x: 22,
        w: 22,
        h: 32,
        address: "14 Jacaranda Place, Manly Vale",
        suburb: "Manly Vale",
        areaSqm: 704,
        zone: "R2",
        lepFsr: 0.5,
        heightM: 8.5,
        mid: 1_940_000,
      }),
    ];
    // Drop valuations for initial planning shortlist, then re-apply with exits.
    const unvalued = parcels.map((p) => ({ ...p, valuation: undefined }));
    const walkingByParcelId = new Map(
      parcels.map((p) => [
        p.externalParcelId,
        { status: "OK" as const, straightLineDistanceM: 400, walkingDistanceM: 520, provider: "test" },
      ]),
    );
    const initial = runAreaScan({
      parcels: unvalued,
      centres: [centre],
      assumptions: DEFAULT_ASSUMPTIONS,
      maxResults: 5,
      walkingByParcelId,
    });
    expect(initial.candidates.length).toBeGreaterThan(0);

    const benchmarks = localExitBenchmarks();
    const reranked = applyValuationsToScanResult(initial, parcels, DEFAULT_ASSUMPTIONS, { exitBenchmarks: benchmarks });
    const templateRerank = applyValuationsToScanResult(initial, parcels, DEFAULT_ASSUMPTIONS);

    const localTop = reranked.candidates[0]!;
    const templateTop = templateRerank.candidates.find((c) => c.key === localTop.key) ?? templateRerank.candidates[0]!;
    expect(localTop.financialRankingAvailable).toBe(true);
    expect(localTop.calculationSnapshot.grv).toBeLessThan(templateTop.calculationSnapshot.grv);
    expect(localTop.maxPayable).toBeLessThan(templateTop.maxPayable!);
    expect(reranked.messages.some((m) => /Local exit benchmarks applied/i.test(m))).toBe(true);
  });
});
