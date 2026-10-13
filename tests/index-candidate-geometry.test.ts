import { describe, expect, it } from "vitest";
import {
  INDEX_CANDIDATE_PARCEL_ID_CAP,
  capParcelIds,
  formatIndexCandidateSummary,
  parcelsMissingDrawableGeometry,
  siteGeometryFromParcels,
} from "@/lib/index-candidate-geometry";
import { isLiveDeepScanEnabled, LIVE_DEEP_SCAN_DISABLED_MESSAGE } from "@/lib/live-deep-scan";
import type { ParcelData } from "@/lib/types";

function parcel(id: string, withGeom = true): ParcelData {
  return {
    externalParcelId: id,
    source: "LIVE_NSW",
    lot: "1",
    section: null,
    dp: "DP1",
    lotIdString: id,
    address: "1 Test St",
    suburb: "Bexley",
    geometry: withGeom
      ? {
          type: "Polygon",
          coordinates: [
            [
              [151.12, -33.95],
              [151.121, -33.95],
              [151.121, -33.951],
              [151.12, -33.951],
              [151.12, -33.95],
            ],
          ],
        }
      : (null as unknown as ParcelData["geometry"]),
    centroid: [151.12, -33.95],
    areaSqm: 450,
    isStrata: false,
    planning: null,
    planningStatus: "unavailable",
    retrievedAt: new Date().toISOString(),
  };
}

describe("index candidate geometry helpers", () => {
  it("caps parcel IDs and drops non-cadid values", () => {
    const ids = Array.from({ length: INDEX_CANDIDATE_PARCEL_ID_CAP + 5 }, (_, i) => `nsw-cadid:${1000 + i}`);
    ids.push("not-a-cadid", "nsw-cadid:1000");
    const capped = capParcelIds(ids);
    expect(capped).toHaveLength(INDEX_CANDIDATE_PARCEL_ID_CAP);
    expect(capped.every((id) => id.startsWith("nsw-cadid:"))).toBe(true);
  });

  it("builds MultiPolygon from multiple lot polygons", () => {
    const g = siteGeometryFromParcels([parcel("nsw-cadid:1"), parcel("nsw-cadid:2")]);
    expect(g?.type).toBe("MultiPolygon");
    if (g?.type === "MultiPolygon") expect(g.coordinates).toHaveLength(2);
  });

  it("returns single Polygon when only one lot", () => {
    const g = siteGeometryFromParcels([parcel("nsw-cadid:1")]);
    expect(g?.type).toBe("Polygon");
  });

  it("detects missing drawable geometry for hydrate path", () => {
    const ids = ["nsw-cadid:1", "nsw-cadid:2", "nsw-cadid:3"];
    const stored = [parcel("nsw-cadid:1"), parcel("nsw-cadid:2", false)];
    expect(parcelsMissingDrawableGeometry(ids, stored)).toEqual(["nsw-cadid:2", "nsw-cadid:3"]);
  });

  it("formats site card summary with address facts", () => {
    expect(
      formatIndexCandidateSummary({
        address: "12 Waldron Rd",
        suburb: "Bexley",
        lotCount: 3,
        siteAreaSqm: 1250.4,
        currentFsr: 0.5,
        proposedFsr: 1.5,
      }),
    ).toBe("Bexley · 3 lots · 1,250 m² · FSR 0.5 · proposed 1.5");
  });
});

describe("live deep scan gate", () => {
  it("is disabled by default (protects web instance)", () => {
    expect(isLiveDeepScanEnabled()).toBe(false);
    expect(LIVE_DEEP_SCAN_DISABLED_MESSAGE.toLowerCase()).toContain("temporarily unavailable");
  });
});
