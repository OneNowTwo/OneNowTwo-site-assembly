import { describe, expect, it } from "vitest";
import {
  POST_SCAN_PARCEL_COOLDOWN_MS,
  POST_SCAN_PARCEL_REFRESH_DELAY_MS,
  scanReturnedSufficientParcels,
  shouldSilentSoftFailTransient,
} from "@/lib/map-parcel-refresh";
import type { ParcelData } from "@/lib/types";

function parcel(id: string, withGeom = true): ParcelData {
  return {
    externalParcelId: id,
    source: "LIVE_NSW",
    lot: "1",
    section: null,
    dp: "DP1",
    lotIdString: `${id}`,
    address: "1 Test St",
    suburb: "Manly Vale",
    geometry: withGeom
      ? {
          type: "Polygon",
          coordinates: [
            [
              [151.2, -33.8],
              [151.201, -33.8],
              [151.201, -33.801],
              [151.2, -33.801],
              [151.2, -33.8],
            ],
          ],
        }
      : (null as unknown as ParcelData["geometry"]),
    centroid: [151.2, -33.8],
    areaSqm: 400,
    isStrata: false,
    planning: null,
    planningStatus: "unavailable",
    retrievedAt: new Date().toISOString(),
  };
}

describe("scanReturnedSufficientParcels", () => {
  it("is false when scan returned no parcels", () => {
    expect(scanReturnedSufficientParcels({ valuedParcels: [], candidateLotIds: ["a", "b"] })).toBe(false);
  });

  it("is true when ranked candidate lots are mostly covered", () => {
    const valued = [parcel("a"), parcel("b"), parcel("c")];
    expect(
      scanReturnedSufficientParcels({
        valuedParcels: valued,
        candidateLotIds: ["a", "b", "c", "d"],
      }),
    ).toBe(true);
  });

  it("is false when ranked lots are barely covered", () => {
    expect(
      scanReturnedSufficientParcels({
        valuedParcels: [parcel("a")],
        candidateLotIds: ["a", "b", "c", "d", "e", "f"],
      }),
    ).toBe(false);
  });

  it("does not count parcels without geometry", () => {
    expect(
      scanReturnedSufficientParcels({
        valuedParcels: [parcel("a", false), parcel("b", false), parcel("c", false)],
        candidateLotIds: [],
      }),
    ).toBe(false);
  });
});

describe("shouldSilentSoftFailTransient", () => {
  it("swallows transient errors only when usable parcels already exist", () => {
    expect(shouldSilentSoftFailTransient({ transient: true, explicitRetry: false, usableParcelCount: 12 })).toBe(true);
    expect(shouldSilentSoftFailTransient({ transient: true, explicitRetry: false, usableParcelCount: 0 })).toBe(false);
    expect(shouldSilentSoftFailTransient({ transient: true, explicitRetry: true, usableParcelCount: 12 })).toBe(false);
    expect(shouldSilentSoftFailTransient({ transient: false, explicitRetry: false, usableParcelCount: 12 })).toBe(false);
  });
});

describe("post-scan timing constants", () => {
  it("keeps cooldown and delayed refresh aligned at ~10s (not 4s)", () => {
    expect(POST_SCAN_PARCEL_COOLDOWN_MS).toBe(10_000);
    expect(POST_SCAN_PARCEL_REFRESH_DELAY_MS).toBe(10_000);
    expect(POST_SCAN_PARCEL_REFRESH_DELAY_MS).toBeGreaterThanOrEqual(POST_SCAN_PARCEL_COOLDOWN_MS);
  });
});
