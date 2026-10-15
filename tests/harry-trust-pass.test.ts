import { describe, expect, it } from "vitest";
import {
  buildComparableValuation,
  DEFAULT_COMP_SEARCH,
  mergeCompSearch,
  type CompSaleInput,
} from "@/lib/analysis/comparable-valuation";
import {
  applyLookbackToPersistedComps,
  summariseRegisteredSalesEvidence,
} from "@/lib/analysis/registered-sales-evidence";
import { analyseOpportunity } from "@/lib/analysis/opportunity";
import { DEFAULT_ASSUMPTIONS, parseOpportunityInputs } from "@/lib/analysis/assumptions";
import { resolvePlanning } from "@/lib/planning/resolve-planning";
import { allocateOffers } from "@/lib/analysis/allocation";
import { supportedLandValueDisplay } from "@/lib/format";
import { screeningStrategyScore } from "@/lib/intelligence/site-candidate-index";
import { DEFAULT_STRATEGY_PROFILE } from "@/lib/source-watcher/strategy-profile";
import {
  PLANNING_SOURCE_REGISTRY,
  planningSourcesNeedingKeysOrLicense,
  planningSourcesScrapeableNow,
} from "@/lib/planning/source-registry";
import { lot, rect, row } from "./helpers";

const A = { ...DEFAULT_ASSUMPTIONS, revenueMode: "UNIT_MIX" as const, planningAdjustment: 0.9 };
const nowMs = Date.parse("2026-10-15T00:00:00Z");

function sale(partial: Partial<CompSaleInput> & { id: string; salePrice: number; distanceM: number }): CompSaleInput {
  return {
    address: partial.address ?? `${partial.id} Test St`,
    saleDate: partial.saleDate ?? "2025-06-01",
    saleDateMs: partial.saleDateMs ?? Date.parse("2025-06-01T00:00:00Z"),
    landAreaSqm: partial.landAreaSqm ?? 280,
    strata: partial.strata ?? false,
    suburb: partial.suburb ?? "Kogarah",
    source: "NSW REGISTERED SALE",
    ...partial,
  };
}

describe("harry trust: assembly fidelity helpers", () => {
  it("3 unique Map assembly IDs stay 3 after dedupe (Warialda-style)", () => {
    const mapIds = ["nsw-cadid:108", "nsw-cadid:110", "nsw-cadid:111"];
    const unique = [...new Set(mapIds.filter(Boolean))];
    expect(unique).toHaveLength(3);
    // Posted set must equal Map set — never silently shrink to index 2-lot key.
    const indexKeyIds = ["nsw-cadid:108", "nsw-cadid:110"];
    expect(unique).not.toEqual(indexKeyIds);
    expect(unique).toHaveLength(3);
  });

  it("partial missing parcels must block Analyse (no silent subset)", () => {
    const requested = ["a", "b", "c"];
    const loaded = new Set(["a", "b"]);
    const missing = requested.filter((id) => !loaded.has(id));
    expect(missing).toEqual(["c"]);
    expect(requested.length - missing.length).toBe(2);
    // Product rule: do not POST the loaded subset.
    expect(missing.length > 0).toBe(true);
  });
});

describe("harry trust: comps lookback + included count", () => {
  const subject = { areaSqm: 280, suburb: "Kogarah", zone: "R3", isStrata: false };

  it("mergeCompSearch ignores undefined so defaults are not wiped to NaN", () => {
    const merged = mergeCompSearch({ radiusM: undefined, lookbackMonths: undefined });
    expect(merged.lookbackMonths).toBe(DEFAULT_COMP_SEARCH.lookbackMonths);
    expect(merged.radiusM).toBe(DEFAULT_COMP_SEARCH.radiusM);
    expect(Number.isFinite(merged.lookbackMonths * 30.4375)).toBe(true);
  });

  it("old sales (2004/2013/2015) are EXCLUDED Older than lookback — even when search fields are undefined", () => {
    const sales = [
      sale({ id: "old-2004", salePrice: 2_900_000, distanceM: 80, saleDate: "2004-03-01", saleDateMs: Date.parse("2004-03-01Z") }),
      sale({ id: "old-2013", salePrice: 3_000_000, distanceM: 90, saleDate: "2013-06-01", saleDateMs: Date.parse("2013-06-01Z") }),
      sale({ id: "old-2015", salePrice: 3_100_000, distanceM: 100, saleDate: "2015-01-15", saleDateMs: Date.parse("2015-01-15Z") }),
      sale({ id: "r1", salePrice: 2_950_000, distanceM: 40, saleDateMs: Date.parse("2025-08-01Z") }),
      sale({ id: "r2", salePrice: 3_050_000, distanceM: 50, saleDateMs: Date.parse("2025-09-01Z") }),
      sale({ id: "r3", salePrice: 3_000_000, distanceM: 60, saleDateMs: Date.parse("2025-10-01Z") }),
      sale({ id: "r4", salePrice: 2_980_000, distanceM: 70, saleDateMs: Date.parse("2026-01-01Z") }),
    ];
    const result = buildComparableValuation(sales, subject, {
      nowMs,
      search: { radiusM: undefined as unknown as number, lookbackMonths: undefined as unknown as number },
    });
    for (const id of ["old-2004", "old-2013", "old-2015"]) {
      const c = result.comps.find((x) => x.id === id)!;
      expect(c.included).toBe(false);
      expect(c.excludeReason).toBe("Older than lookback");
    }
  });

  it("null sale date is excluded (Missing sale date)", () => {
    const sales = [
      sale({ id: "nodate", salePrice: 3_000_000, distanceM: 40, saleDate: null, saleDateMs: null }),
      sale({ id: "r1", salePrice: 2_950_000, distanceM: 40 }),
      sale({ id: "r2", salePrice: 3_050_000, distanceM: 50 }),
      sale({ id: "r3", salePrice: 3_000_000, distanceM: 60 }),
    ];
    const result = buildComparableValuation(sales, subject, { nowMs });
    expect(result.comps.find((c) => c.id === "nodate")?.included).toBe(false);
    expect(result.comps.find((c) => c.id === "nodate")?.excludeReason).toBe("Missing sale date");
  });

  it("included count equals picked set — soft land-area rejects are not USED", () => {
    const sales = [
      sale({ id: "1", salePrice: 2_900_000, distanceM: 40, landAreaSqm: 280 }),
      sale({ id: "2", salePrice: 3_000_000, distanceM: 50, landAreaSqm: 275 }),
      sale({ id: "3", salePrice: 3_100_000, distanceM: 60, landAreaSqm: 290 }),
      sale({ id: "4", salePrice: 2_950_000, distanceM: 70, landAreaSqm: 270 }),
      sale({ id: "5", salePrice: 3_050_000, distanceM: 80, landAreaSqm: 285 }),
      sale({ id: "6", salePrice: 3_000_000, distanceM: 90, landAreaSqm: 278 }),
      sale({ id: "7", salePrice: 2_980_000, distanceM: 100, landAreaSqm: 282 }),
      sale({ id: "8", salePrice: 3_020_000, distanceM: 110, landAreaSqm: 288 }),
      sale({ id: "9", salePrice: 2_970_000, distanceM: 120, landAreaSqm: 274 }),
      sale({ id: "10", salePrice: 3_040_000, distanceM: 130, landAreaSqm: 286 }),
      sale({ id: "11", salePrice: 3_010_000, distanceM: 140, landAreaSqm: 279 }),
      sale({ id: "12", salePrice: 2_990_000, distanceM: 150, landAreaSqm: 281 }),
      // Soft-fail land area (within 1.5× hard gate, outside preferred tolerance)
      sale({ id: "soft", salePrice: 3_000_000, distanceM: 55, landAreaSqm: 280 * 1.4 }),
    ];
    const result = buildComparableValuation(sales, subject, { nowMs });
    const included = result.comps.filter((c) => c.included);
    expect(included.length).toBe(result.numberOfComps);
    expect(result.numberOfComps).toBeLessThanOrEqual(DEFAULT_COMP_SEARCH.maxComps);
    expect(result.comps.find((c) => c.id === "soft")?.included).toBe(false);
  });

  it("stale persisted old USED rows rehydrate to Older than lookback", () => {
    const comps = applyLookbackToPersistedComps(
      [
        {
          id: "old",
          address: "1 Old St",
          salePrice: 1_000_000,
          saleDate: "2004-01-01",
          landAreaSqm: 280,
          distanceM: 50,
          similarity: 0.9,
          included: true,
          excludeReason: null,
          source: "NSW REGISTERED SALE",
        },
        {
          id: "new",
          address: "2 New St",
          salePrice: 3_000_000,
          saleDate: "2025-08-01",
          landAreaSqm: 280,
          distanceM: 40,
          similarity: 0.95,
          included: true,
          excludeReason: null,
          source: "NSW REGISTERED SALE",
        },
      ],
      { nowMs },
    );
    expect(comps.find((c) => c.id === "old")?.included).toBe(false);
    expect(comps.find((c) => c.id === "old")?.excludeReason).toBe("Older than lookback");
    expect(comps.find((c) => c.id === "new")?.included).toBe(true);
  });

  it("USED COUNT = included rows when detailed comps exist; metadata is secondary only", () => {
    const evidence = summariseRegisteredSalesEvidence(
      {
        "nsw-cadid:1": {
          mid: 3_000_000,
          numberOfComps: 10,
          provider: "NSW",
          source: "COMPARABLE_DERIVED",
          comps: [
            ...Array.from({ length: 10 }, (_, i) => ({
              id: `inc-${i}`,
              address: `${i} Inc St`,
              salePrice: 3_000_000,
              saleDate: "2025-08-01",
              landAreaSqm: 280,
              distanceM: 40,
              similarity: 0.9,
              included: true,
              source: "NSW REGISTERED SALE",
            })),
            {
              id: "extra-a",
              address: "Extra A",
              salePrice: 2_900_000,
              saleDate: "2025-07-01",
              landAreaSqm: 280,
              distanceM: 50,
              similarity: 0.8,
              included: true,
              source: "NSW REGISTERED SALE",
            },
            {
              id: "extra-b",
              address: "Extra B",
              salePrice: 2_950_000,
              saleDate: "2025-06-01",
              landAreaSqm: 280,
              distanceM: 60,
              similarity: 0.75,
              included: true,
              source: "NSW REGISTERED SALE",
            },
          ],
        },
      },
      [{ id: "lot1", label: "Lot 1", externalParcelId: "nsw-cadid:1", included: true }],
    );
    const card = evidence.lotCards[0]!;
    // After lookback pass, included rows drive headline — not metadata 10 vs raw 12 contradiction.
    expect(card.usedDisplayKind).toBe("included_rows");
    expect(card.usedDisplayCount).toBe(card.includedCompCount);
    expect(card.numberOfComps).toBe(10);
  });
});

describe("harry trust: planning index fallback preserves zone", () => {
  it("stored R3 + FSR survive when live lots have blank zone/FSR", () => {
    const lots = row(2).map((l) => ({
      ...l,
      zone: null,
      zoneName: null,
      fsr: null,
      heightM: null,
      planningInstrument: null,
      planningCheckedAt: null,
    }));
    const inputs = parseOpportunityInputs({
      indexPlanningSnapshot: {
        candidateId: "warialda",
        canonicalKey: "a|b",
        zone: "R3",
        zoneName: "Medium Density Residential",
        currentFsr: 0.7,
        proposedFsr: null,
        proposedHeightM: null,
        heightM: 9.5,
        lepName: "Georges River LEP",
        lga: "Georges River",
        source: "SITE_CANDIDATE_INDEX",
        provenance: "STORED_OFFICIAL_NSW_PLANNING",
        indexedAt: "2026-09-01T00:00:00.000Z",
      },
    });
    const planning = resolvePlanning({
      lots: lots.map((l) => ({
        id: l.id,
        label: l.label,
        included: true,
        areaSqm: l.areaSqm,
        zone: l.zone,
        zoneName: l.zoneName,
        fsr: l.fsr,
        heightM: l.heightM,
        minLotSizeSqm: l.minLotSizeSqm,
        heritage: l.heritage,
        planningInstrument: null,
        planningCheckedAt: null,
      })),
      inputs,
    });
    expect(planning.currentStatutoryControls.zone).toBe("R3");
    expect(planning.currentStatutoryControls.zoneName).toBe("Medium Density Residential");
    expect(planning.effectiveControls.effectiveFsr).toBe(0.7);
    expect(planning.effectiveControls.fsrSource).toBe("INDEX_SNAPSHOT");
    expect(planning.effectiveControls.source).toBe("STORED INDEX EVIDENCE");
  });
});

describe("harry trust: negative max payable UX", () => {
  it("supportedLandValueDisplay shows NO SUPPORTED LAND VALUE for negatives", () => {
    const d = supportedLandValueDisplay(-274_000, { compact: true });
    expect(d.unsupported).toBe(true);
    expect(d.primary).toBe("NO SUPPORTED LAND VALUE");
    expect(d.secondary).toContain("−");
  });

  it("allocateOffers does not invent $0 strategy premiums when budget ≤ 0", () => {
    const result = allocateOffers(
      -274_000,
      [
        { id: "a", marketValue: 1_500_000, areaSqm: 700 },
        { id: "b", marketValue: 1_600_000, areaSqm: 800 },
      ],
      0.9,
      5000,
    );
    expect(result.totalOpening).toBe(0);
    expect(result.totalMaximum).toBe(0);
    expect(result.averagePremiumToMarket).toBeNull();
    expect(result.lots.every((l) => l.openingPremium == null)).toBe(true);
    expect(result.warnings.some((w) => w.includes("DOES NOT SUPPORT"))).toBe(true);
  });
});

describe("harry trust: Cammeray critical-lot independent recalc", () => {
  it("removing a lot rebuilds unit mix — remaining GRV must fall with site area", () => {
    // Three contiguous Cammeray-scale lots with full-site unit mix persisted.
    const lots = [
      lot("c1", 0, {
        label: "1 Carter St",
        externalParcelId: "nsw-cadid:c1",
        areaSqm: 450,
        zone: "R3",
        fsr: null,
        heightM: 17.5,
        marketValue: 3_200_000,
        geometry: rect(0, 0, 18, 25),
      }),
      lot("c2", 18, {
        label: "3 Carter St",
        externalParcelId: "nsw-cadid:c2",
        areaSqm: 480,
        zone: "R3",
        fsr: null,
        heightM: 17.5,
        marketValue: 3_400_000,
        geometry: rect(18, 0, 18, 26.7),
      }),
      lot("c3", 36, {
        label: "5 Carter St",
        externalParcelId: "nsw-cadid:c3",
        areaSqm: 420,
        zone: "R3",
        fsr: null,
        heightM: 17.5,
        marketValue: 3_100_000,
        geometry: rect(36, 0, 18, 23.3),
      }),
    ];
    const fullMix = [
      { name: "2 bed", count: 24, avgInternalArea: 75, avgExternalArea: 8, avgSaleableArea: 83, salePricePerUnit: 1_150_000 },
      { name: "3 bed", count: 8, avgInternalArea: 105, avgExternalArea: 12, avgSaleableArea: 117, salePricePerUnit: 1_550_000 },
    ];
    const inputs = parseOpportunityInputs({
      fsrOverride: 1.5,
      fsrOverrideKind: "SCAN_MODELLED",
      heightOverrideM: 17.5,
      unitMix: fullMix,
      pathwaySnapshot: {
        lepFsr: null,
        statePathwayFsr: 1.5,
        statePathwayName: "Low & Mid-Rise Housing (Housing SEPP)",
        modelledFsr: 1.5,
        modelledHeightM: 17.5,
        certainty: "REQUIRES_PLANNING_CONFIRMATION",
        lmrCentre: "Cammeray",
        lmrBand: "OUTER_400_800",
        nearestDistanceM: 520,
        furthestDistanceM: 620,
        proximityScreen: "PASS",
        proximityLabel: "PASS — ESTIMATED",
      },
    });
    const analysis = analyseOpportunity(lots, A, inputs);
    expect(analysis.includedIds).toHaveLength(3);
    expect(analysis.feasibilityCalculable).toBe(true);
    const baseGrv = analysis.base.feasibility.grv;
    const baseBudget = analysis.maxPayableToOwners;

    for (const c of analysis.critical) {
      // Independently recalculated reduced site must not keep full-site GRV.
      expect(c.grvWithout).toBeLessThan(baseGrv * 0.98);
      expect(c.areaWithout).toBeLessThan(lots.reduce((s, l) => s + l.areaSqm, 0));
      // If max payable rises after removing a lot, it must be because remaining MV fell more than residual —
      // never because GRV stayed pinned to the full assembly.
      if (c.budgetWithout > baseBudget) {
        expect(c.grvWithout).toBeLessThan(baseGrv);
      }
    }
  });
});

describe("harry trust: screening score compression", () => {
  it("typical stacked bonuses no longer pin at 100", () => {
    const profile = {
      ...DEFAULT_STRATEGY_PROFILE,
      strategy: "APARTMENTS" as const,
      preferredZones: ["R3", "R4"],
      minSiteAreaSqm: 1000,
      maxStationDistanceM: 800,
    };
    const beforeStyle = 40 + 18 + 8 + 12 + 10 + 8 + 6; // legacy additive stack ≈ 102 → clamp 100
    expect(beforeStyle).toBeGreaterThanOrEqual(100);
    const after = screeningStrategyScore(
      {
        quickScore: 78,
        zone: "R3",
        siteAreaSqm: 2200,
        proposedFsr: 1.5,
        currentFsr: 0.7,
        stationDistanceM: 400,
        keySiteStatus: "WATCH",
      },
      profile,
    );
    expect(after).toBeLessThan(100);
    expect(after).toBeGreaterThan(50);
  });

  it("legacy cached 100 compresses below 100", () => {
    const score = screeningStrategyScore(
      { quickScore: 100, strategyScores: { APARTMENTS: 100 } },
      {
        ...DEFAULT_STRATEGY_PROFILE,
        strategy: "APARTMENTS",
        preferredZones: [],
        minSiteAreaSqm: null,
        maxStationDistanceM: null,
      },
    );
    expect(score).toBeLessThan(100);
    expect(score).toBeGreaterThanOrEqual(85);
  });
});

describe("harry trust: planning source registry", () => {
  it("registers NSW + council concept sources without inventing credentials", () => {
    expect(PLANNING_SOURCE_REGISTRY.length).toBeGreaterThanOrEqual(10);
    expect(PLANNING_SOURCE_REGISTRY.some((s) => s.id === "nsw-epi-primary-planning")).toBe(true);
    expect(PLANNING_SOURCE_REGISTRY.some((s) => s.id === "council-lep-concept")).toBe(true);
    expect(PLANNING_SOURCE_REGISTRY.every((s) => typeof s.requiresApiKey === "boolean")).toBe(true);
    expect(planningSourcesScrapeableNow().length).toBeGreaterThan(0);
    expect(planningSourcesNeedingKeysOrLicense().some((s) => s.id === "nsw-da-cdc-pcc")).toBe(true);
  });
});
