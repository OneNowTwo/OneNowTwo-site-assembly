import { describe, expect, it, afterEach, beforeEach } from "vitest";
import type { Polygon } from "geojson";
import { applyValuationsToScanResult, runAreaScan } from "@/lib/analysis/area-scan";
import { DEFAULT_ASSUMPTIONS } from "@/lib/analysis/assumptions";
import { domainCredentialStatus } from "@/lib/data-sources/domain-valuation";
import { valueProperty, toParcelValuation } from "@/lib/data-sources/valuation-service";
import type { ParcelData } from "@/lib/types";
import type { NominatedCentre } from "@/lib/data-sources/housing-sepp-lmr";

const A = { ...DEFAULT_ASSUMPTIONS, minViableSiteAreaSqm: 800, revenueMode: "PER_SQM" as const, planningAdjustment: 1 };
const ORIGIN = { lat: -33.835, lng: 151.218 };
const M_PER_DEG_LAT = 111_320;
const mPerDegLng = M_PER_DEG_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180);

function rect(x: number, y: number, w: number, h: number): Polygon {
  const p = (dx: number, dy: number) => [ORIGIN.lng + dx / mPerDegLng, ORIGIN.lat + dy / M_PER_DEG_LAT];
  return { type: "Polygon", coordinates: [[p(x, y), p(x + w, y), p(x + w, y + h), p(x, y + h), p(x, y)]] };
}

function parcel(id: string, x: number, address: string, mid: number, low?: number, high?: number): ParcelData {
  const areaSqm = 20 * 40;
  const geometry = rect(x, 0, 20, 40);
  const centroid: [number, number] = [ORIGIN.lng + (x + 10) / mPerDegLng, ORIGIN.lat + 20 / M_PER_DEG_LAT];
  return {
    externalParcelId: `nsw-cadid:${id}`,
    source: "LIVE_NSW",
    lot: id,
    section: null,
    dp: "DP999",
    lotIdString: `${id}//DP999`,
    address,
    suburb: "Neutral Bay",
    geometry,
    centroid,
    areaSqm,
    isStrata: false,
    planning: {
      zone: "R2",
      zoneName: "Low Density Residential",
      fsr: 0.5,
      fsrStatus: "MAPPED",
      fsrControls: [
        {
          fsr: 0.5,
          epiName: "North Sydney LEP 2013",
          lga: "NORTH SYDNEY",
          layClass: null,
          intersectionAreaSqm: areaSqm,
          intersectionShare: 1,
        },
      ],
      heightM: 8.5,
      minLotSizeSqm: 450,
      heritage: "None mapped",
      planningInstrument: "North Sydney LEP 2013",
      lga: "NORTH SYDNEY",
      sources: {},
    },
    planningStatus: "ok",
    retrievedAt: "2026-10-03T00:00:00.000Z",
    valuation: {
      mid,
      low: low ?? mid * 0.83,
      high: high ?? mid * 1.17,
      status: "LIVE_AVM",
      confidence: "MEDIUM",
      source: "LIVE_AVM",
      provider: "DOMAIN",
      method: "priceEstimate",
      checkedAt: "2026-10-03T00:00:00.000Z",
      note: "Domain Price Estimate",
    },
  };
}

const centre: NominatedCentre = {
  id: "town-centre:neutral-bay",
  label: "Neutral Bay",
  layClass: "Town Centre",
  lng: ORIGIN.lng + 0.001,
  lat: ORIGIN.lat + 0.001,
  source: "test",
  retrievedAt: "2026-10-03T00:00:00.000Z",
};

describe("Domain credential status", () => {
  const prevId = process.env.DOMAIN_CLIENT_ID;
  const prevSecret = process.env.DOMAIN_CLIENT_SECRET;

  afterEach(() => {
    if (prevId === undefined) delete process.env.DOMAIN_CLIENT_ID;
    else process.env.DOMAIN_CLIENT_ID = prevId;
    if (prevSecret === undefined) delete process.env.DOMAIN_CLIENT_SECRET;
    else process.env.DOMAIN_CLIENT_SECRET = prevSecret;
  });

  it("reports missing DOMAIN_CLIENT_ID / DOMAIN_CLIENT_SECRET", () => {
    delete process.env.DOMAIN_CLIENT_ID;
    delete process.env.DOMAIN_CLIENT_SECRET;
    const status = domainCredentialStatus();
    expect(status.configured).toBe(false);
    expect(status.missing).toContain("DOMAIN_CLIENT_ID");
    expect(status.missing).toContain("DOMAIN_CLIENT_SECRET");
  });
});

describe("valuation waterfall order", () => {
  beforeEach(() => {
    delete process.env.DOMAIN_CLIENT_ID;
    delete process.env.DOMAIN_CLIENT_SECRET;
    delete process.env.PROPTRACK_API_KEY;
    delete process.env.PROPTRACK_ENABLED;
  });

  it("uses caller comparable-derived before user estimate when NSW/Domain unavailable", async () => {
    const result = await valueProperty({
      externalParcelId: "nsw-cadid:1",
      address: "5 Reserve Street",
      suburb: "Neutral Bay",
      areaSqm: 400,
      // no lng/lat → skip NSW spatial comps
      comparableDerived: 3_000_000,
      userValue: 2_500_000,
    });
    expect(result.status).toBe("COMPARABLE_DERIVED");
    expect(result.mid).toBe(3_000_000);
  });

  it("honours preferUserOverride for manual edit path", async () => {
    const result = await valueProperty({
      externalParcelId: "nsw-cadid:1",
      address: "5 Reserve Street",
      suburb: "Neutral Bay",
      areaSqm: 400,
      comparableDerived: 3_000_000,
      userValue: 3_120_000,
      preferUserOverride: true,
    });
    expect(result.status).toBe("USER_ESTIMATE");
    expect(result.mid).toBe(3_120_000);
  });

  it("returns NO_VALUE when no coordinates and no fallbacks", async () => {
    const result = await valueProperty({
      externalParcelId: "nsw-cadid:1",
      address: "5 Reserve Street",
      suburb: "Neutral Bay",
      areaSqm: 400,
    });
    expect(result.status).toBe("NO_VALUE");
    expect(result.mid).toBeNull();
    expect(result.note ?? "").toMatch(/VALUE REQUIRED|no NSW|DOMAIN/i);
  });
});

describe("applyValuationsToScanResult ranges", () => {
  it("attaches lot valuations and mid/low/high headroom after Domain values", () => {
    const parcels = [
      parcel("101", 0, "1 Reserve Street", 2_800_000),
      parcel("102", 20, "3 Reserve Street", 2_900_000),
      parcel("103", 40, "5 Reserve Street", 3_120_000, 2_590_000, 3_650_000),
      parcel("104", 60, "57 Undercliff Street", 2_700_000),
    ];
    const walkingByParcelId = new Map(
      parcels.map((p) => [p.externalParcelId, { status: "OK" as const, straightLineDistanceM: 400, walkingDistanceM: 500, provider: "test" }]),
    );
    const initial = runAreaScan({ parcels, centres: [centre], assumptions: A, maxResults: 5, walkingByParcelId });
    expect(initial.candidates.length).toBeGreaterThan(0);

    const valued = applyValuationsToScanResult(initial, parcels, A);
    const best = valued.candidates[0]!;
    expect(best.financialRankingAvailable).toBe(true);
    expect(best.lotValuations).toBeTruthy();
    expect(Object.keys(best.lotValuations ?? {}).length).toBeGreaterThan(0);
    expect(best.existingValue).toBeGreaterThan(0);
    expect(best.existingValueLow).not.toBeNull();
    expect(best.existingValueHigh).not.toBeNull();
    expect(best.existingValueLow!).toBeLessThan(best.existingValue);
    expect(best.existingValueHigh!).toBeGreaterThan(best.existingValue);
    expect(best.headroomLow).not.toBeNull();
    expect(best.headroomHigh).not.toBeNull();
    expect(best.headroomLow!).toBeLessThanOrEqual(best.headroom!);
    expect(best.headroomHigh!).toBeGreaterThanOrEqual(best.headroom!);
    expect(valued.progress.join(" ")).toMatch(/Valuing|feasibility|Ranking/i);

    // Sanity: 5 Reserve mid should appear in lot valuations when that lot is in the assembly.
    if (best.lotIds.includes("nsw-cadid:103")) {
      expect(best.lotValuations!["nsw-cadid:103"]!.mid).toBe(3_120_000);
      expect(best.lotValuations!["nsw-cadid:103"]!.low).toBe(2_590_000);
      expect(best.lotValuations!["nsw-cadid:103"]!.high).toBe(3_650_000);
    }
  });
});

describe("toParcelValuation", () => {
  it("maps Domain midPrice fields for persistence", () => {
    const v = toParcelValuation({
      mid: 3_120_000,
      low: 2_590_000,
      high: 3_650_000,
      status: "LIVE_AVM",
      confidence: "MEDIUM",
      source: "LIVE_AVM",
      provider: "DOMAIN",
      method: "priceEstimate",
      checkedAt: "2026-10-03T00:00:00.000Z",
      externalId: "12345",
      note: null,
    });
    expect(v.mid).toBe(3_120_000);
    expect(v.provider).toBe("DOMAIN");
    expect(v.externalId).toBe("12345");
  });
});
