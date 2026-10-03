import { describe, expect, it } from "vitest";
import { analyseOpportunity, type OpportunityLot } from "@/lib/analysis/opportunity";
import { computeAssemblyMetrics } from "@/lib/analysis/assembly";
import { DEFAULT_ASSUMPTIONS, parseOpportunityInputs } from "@/lib/analysis/assumptions";
import { summariseAssemblyValuation, resolveValuationStatus, isTrustedValuationStatus } from "@/lib/analysis/valuation";
import { manualValuationProvider } from "@/lib/data-sources/providers";
import { getCachedValuation, setCachedValuation, clearValuationCache } from "@/lib/data-sources/valuation-cache";
import { buildAdjacency } from "@/lib/analysis/geometry";
import { runAreaScan } from "@/lib/analysis/area-scan";
import { row, lot } from "./helpers";
import type { ParcelData } from "@/lib/types";
import type { NominatedCentre } from "@/lib/data-sources/housing-sepp-lmr";

const A = { ...DEFAULT_ASSUMPTIONS, minViableSiteAreaSqm: 2000, revenueMode: "PER_SQM" as const, planningAdjustment: 1 };

describe("valuation quality statuses", () => {
  it("treats USER / comps / live AVM as trusted and suburb fallback as not", () => {
    expect(isTrustedValuationStatus(resolveValuationStatus("USER_ESTIMATE", 3_120_000))).toBe(true);
    expect(isTrustedValuationStatus(resolveValuationStatus("COMPARABLE_DERIVED", 2_000_000))).toBe(true);
    expect(isTrustedValuationStatus(resolveValuationStatus("LIVE_AVM", 2_500_000))).toBe(true);
    expect(isTrustedValuationStatus(resolveValuationStatus("SYSTEM_ESTIMATE", 1_100_000))).toBe(false);
    expect(isTrustedValuationStatus(resolveValuationStatus("SUBURB_FALLBACK", 1_100_000))).toBe(false);
    expect(resolveValuationStatus(null, null)).toBe("NO_VALUE");
  });

  it("manual provider never invents a trusted suburb fallback value", async () => {
    const empty = await manualValuationProvider.estimate({ externalParcelId: "x", areaSqm: 300 });
    expect(empty.status).toBe("NO_VALUE");
    expect(empty.mid).toBeNull();

    const user = await manualValuationProvider.estimate({
      externalParcelId: "x",
      areaSqm: 300,
      userValue: 3_120_000,
      userLow: 2_590_000,
      userHigh: 3_650_000,
    });
    expect(user.status).toBe("USER_ESTIMATE");
    expect(user.mid).toBe(3_120_000);
    expect(user.low).toBe(2_590_000);
    expect(user.high).toBe(3_650_000);
  });
});

describe("kill suburb fallback from acquisition headroom", () => {
  it("does not compute trusted headroom without market values", () => {
    const lots = row(4).map((l) => ({ ...l, marketValue: null, fsr: 0.8 }));
    const m = computeAssemblyMetrics(lots, A);
    expect(m.financialValuationAvailable).toBe(false);
    expect(m.acquisitionHeadroom).toBeNull();
    expect(m.maxPayableToOwners).toBeGreaterThan(0);
    expect(m.screeningCombinedValue).toBeGreaterThan(0);
  });

  it("manual override of 5 Reserve Street style value updates combined / headroom but not max payable", () => {
    const lots: OpportunityLot[] = row(4, { fsr: 0.8, marketValue: null }).map((l) => ({
      ...l,
      marketValue: null,
      marketValueSource: "NO_VALUE",
    }));
    const inputs = parseOpportunityInputs({ fsrOverride: 0.8, fsrOverrideKind: "USER" });
    const before = analyseOpportunity(lots, A, inputs, buildAdjacency(lots));
    const maxBefore = before.maxPayableToOwners;
    expect(before.marketValueComplete).toBe(false);
    expect(before.acquisitionHeadroom).toBeNull();
    expect(before.viability).toBe("INSUFFICIENT_VALUATION_DATA");

    lots[0]!.marketValue = 3_120_000;
    lots[0]!.marketValueSource = "USER_ESTIMATE";
    lots[0]!.marketValueLow = 2_590_000;
    lots[0]!.marketValueHigh = 3_650_000;
    lots[1]!.marketValue = 2_400_000;
    lots[1]!.marketValueSource = "USER_ESTIMATE";
    lots[2]!.marketValue = 2_500_000;
    lots[2]!.marketValueSource = "USER_ESTIMATE";
    lots[3]!.marketValue = 2_800_000;
    lots[3]!.marketValueSource = "USER_ESTIMATE";

    const after = analyseOpportunity(lots, A, inputs, buildAdjacency(lots));
    expect(after.maxPayableToOwners).toBeCloseTo(maxBefore, 0);
    expect(after.combinedExistingValue).toBe(3_120_000 + 2_400_000 + 2_500_000 + 2_800_000);
    expect(after.acquisitionHeadroom).toBeCloseTo(after.maxPayableToOwners - (after.combinedExistingValue as number), 0);
    expect(after.valuation.low).toBeLessThan(after.valuation.mid!);
    expect(after.valuation.high).toBeGreaterThan(after.valuation.mid!);
    // With ~$10.8m existing vs development budget, headroom should be negative / unlikely
    expect(after.acquisitionHeadroom!).toBeLessThan(0);
    expect(after.viability).toBe("UNLIKELY");
  });

  it("negative headroom when mid existing exceeds max payable", () => {
    const summary = summariseAssemblyValuation(
      [
        { id: "a", areaSqm: 300, marketValue: 3_120_000, marketValueSource: "USER_ESTIMATE", marketValueLow: 2_590_000, marketValueHigh: 3_650_000 },
        { id: "b", areaSqm: 400, marketValue: 2_800_000, marketValueSource: "USER_ESTIMATE" },
        { id: "c", areaSqm: 400, marketValue: 2_700_000, marketValueSource: "USER_ESTIMATE" },
        { id: "d", areaSqm: 500, marketValue: 2_900_000, marketValueSource: "USER_ESTIMATE" },
      ],
      7_350_000,
      2600,
    );
    expect(summary.complete).toBe(true);
    expect(summary.mid).toBeCloseTo(11_520_000);
    expect(summary.headroomMid).toBeCloseTo(7_350_000 - 11_520_000);
    expect(summary.viability).toBe("UNLIKELY");
  });
});

describe("area scan ranking without fake values", () => {
  it("marks financial ranking unavailable and does not invent headroom", () => {
    const centre: NominatedCentre = {
      id: "town-centre:nb",
      label: "Neutral Bay",
      layClass: "Town Centre",
      lng: 151.218,
      lat: -33.835,
      source: "test",
      retrievedAt: "2026-10-03T00:00:00.000Z",
    };
    const parcels: ParcelData[] = [0, 1, 2].map((i) => {
      const l = lot(String.fromCharCode(65 + i), i * 20, { fsr: null, zone: "R2", marketValue: null });
      return {
        externalParcelId: `nsw-cadid:${l.id}`,
        source: "LIVE_NSW",
        lot: l.id,
        section: null,
        dp: "DP1",
        lotIdString: `${l.id}//DP1`,
        address: `${i + 1} Reserve Street`,
        suburb: "Neutral Bay",
        geometry: l.geometry,
        centroid: [151.218 + i * 0.0001, -33.835] as [number, number],
        areaSqm: l.areaSqm,
        isStrata: false,
        planning: {
          zone: "R2",
          zoneName: "Low Density",
          fsr: null,
          fsrStatus: "NO_MAPPED",
          fsrControls: [],
          heightM: 8.5,
          minLotSizeSqm: 450,
          heritage: "None mapped",
          planningInstrument: "North Sydney LEP 2013",
          lga: "NORTH SYDNEY",
          sources: {},
        },
        planningStatus: "ok",
        retrievedAt: "2026-10-03T00:00:00.000Z",
      };
    });
    const walkingByParcelId = new Map(
      parcels.map((p) => [p.externalParcelId, { status: "OK" as const, straightLineDistanceM: 400, walkingDistanceM: 500, provider: "test" }]),
    );
    const scan = runAreaScan({ parcels, centres: [centre], assumptions: DEFAULT_ASSUMPTIONS, maxResults: 5, walkingByParcelId });
    expect(scan.candidates.length).toBeGreaterThan(0);
    expect(scan.candidates.every((c) => !c.financialRankingAvailable)).toBe(true);
    expect(scan.candidates.every((c) => c.headroom == null)).toBe(true);
    expect(scan.messages.some((m) => m.includes("FINANCIAL RANKING PENDING PROPERTY VALUES"))).toBe(true);
  });
});

describe("valuation cache", () => {
  it("stores and returns cached AVM responses", () => {
    clearValuationCache();
    setCachedValuation("domain:123", {
      mid: 3_120_000,
      low: 2_590_000,
      high: 3_650_000,
      status: "LIVE_AVM",
      confidence: "MEDIUM",
      source: "LIVE_AVM",
      provider: "DOMAIN",
      method: "priceEstimate",
      checkedAt: "2026-10-03T00:00:00.000Z",
      cacheable: true,
    });
    expect(getCachedValuation("domain:123")?.mid).toBe(3_120_000);
  });
});
