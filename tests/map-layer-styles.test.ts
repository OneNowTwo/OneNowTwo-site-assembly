import { describe, expect, it } from "vitest";
import {
  fsrBucket,
  fsrColour,
  heightBucket,
  heritageKind,
  isHeritageMapped,
  FSR_BUCKET_COLOURS,
  applyParcelTheme,
  resolveParcelTheme,
} from "@/lib/map/layer-styles";
import {
  activityCentroid,
  activityHasPlottableGeometry,
  activityPlotLatLng,
  activityToggleAvailability,
  type DevelopmentActivity,
  type DevelopmentActivityType,
} from "@/lib/source-watcher/development-activity";

describe("map layer styles", () => {
  it("treats missing / unmapped FSR as Not mapped — never as 0", () => {
    expect(fsrBucket(null)).toBe("not_mapped");
    expect(fsrBucket(undefined, "NO_MAPPED")).toBe("not_mapped");
    expect(fsrBucket(0, "NO_MAPPED")).toBe("not_mapped");
    expect(fsrBucket(0.8, "MAPPED")).toBe("0_5_1");
    expect(fsrColour(null)).toBe(FSR_BUCKET_COLOURS.not_mapped);
    // Service-down is Not loaded — distinct from Not mapped.
    expect(fsrBucket(null, "UNAVAILABLE")).toBe("not_loaded");
    expect(fsrBucket(null, null, "unavailable")).toBe("not_loaded");
  });

  it("buckets current LEP height only", () => {
    expect(heightBucket(null)).toBe("not_mapped");
    expect(heightBucket(9)).toBe("le_9");
    expect(heightBucket(12)).toBe("9_12");
    expect(heightBucket(22)).toBe("gt_18");
  });

  it("does not infer no-heritage from missing data", () => {
    expect(heritageKind(null)).toBe("unknown");
    expect(isHeritageMapped(null)).toBe(false);
    expect(heritageKind("None mapped")).toBe("none");
    expect(heritageKind("Item — Foo House — Local")).toBe("item");
    expect(heritageKind("Heritage Conservation Area — Bar")).toBe("conservation");
    expect(isHeritageMapped("Item — Foo")).toBe(true);
  });

  it("keeps parcel-colour themes exclusive (Zoning WMS off under FSR/Height/Heritage/Strata)", () => {
    expect(applyParcelTheme("zoning")).toEqual({
      zoning: true,
      zoningWms: true,
      fsr: false,
      height: false,
      heritage: false,
      strata: false,
    });
    expect(applyParcelTheme("fsr")).toEqual({
      zoning: false,
      zoningWms: false,
      fsr: true,
      height: false,
      heritage: false,
      strata: false,
    });
    expect(applyParcelTheme("height").zoningWms).toBe(false);
    expect(applyParcelTheme("heritage").zoning).toBe(false);
    expect(applyParcelTheme("strata").fsr).toBe(false);
    expect(applyParcelTheme("none")).toEqual({
      zoning: false,
      zoningWms: false,
      fsr: false,
      height: false,
      heritage: false,
      strata: false,
    });
  });

  it("resolves a single parcel theme from exclusive flags", () => {
    expect(resolveParcelTheme({ zoning: true, fsr: false, height: false, heritage: false, strata: false })).toBe("zoning");
    expect(resolveParcelTheme({ zoning: false, fsr: true, height: false, heritage: false, strata: false })).toBe("fsr");
    expect(resolveParcelTheme({ zoning: false, fsr: false, height: true, heritage: false, strata: false })).toBe("height");
    expect(resolveParcelTheme({ zoning: false, fsr: false, height: false, heritage: true, strata: false })).toBe("heritage");
    expect(resolveParcelTheme({ zoning: false, fsr: false, height: false, heritage: false, strata: true })).toBe("strata");
    expect(resolveParcelTheme({ zoning: false, fsr: false, height: false, heritage: false, strata: false })).toBe("none");
  });
});

function stubActivity(
  geometry: DevelopmentActivity["geometry"],
  type: DevelopmentActivityType = "HDA",
): DevelopmentActivity {
  return {
    id: `t-${type}`,
    sourceId: "test",
    externalId: `EXT-${type}`,
    type,
    status: "LODGED",
    address: "1 Test St",
    geometry,
    developmentType: null,
    description: null,
    dwellings: null,
    storeys: null,
    estimatedCost: null,
    lodgedAt: null,
    determinedAt: null,
    sourceUrl: null,
    checkedAt: new Date().toISOString(),
  };
}

const pointGeom: GeoJSON.Point = { type: "Point", coordinates: [151.1, -33.8] };
const polygonGeom: GeoJSON.Polygon = {
  type: "Polygon",
  coordinates: [
    [
      [151.0, -33.9],
      [151.2, -33.9],
      [151.2, -33.7],
      [151.0, -33.7],
      [151.0, -33.9],
    ],
  ],
};

describe("activity plot geometry", () => {
  it("plots Point at the coordinate", () => {
    const a = stubActivity({ type: "Point", coordinates: [151.1, -33.8] });
    expect(activityCentroid(a)).toEqual({ lng: 151.1, lat: -33.8 });
    expect(activityPlotLatLng(a)).toEqual([-33.8, 151.1]);
    expect(activityHasPlottableGeometry(a)).toBe(true);
  });

  it("plots Polygon at ring centroid", () => {
    const a = stubActivity({
      type: "Polygon",
      coordinates: [
        [
          [151.0, -33.9],
          [151.2, -33.9],
          [151.2, -33.7],
          [151.0, -33.7],
          [151.0, -33.9],
        ],
      ],
    });
    const c = activityCentroid(a);
    expect(c).not.toBeNull();
    expect(c!.lng).toBeCloseTo(151.08, 2);
    expect(c!.lat).toBeCloseTo(-33.82, 2);
    expect(activityHasPlottableGeometry(a)).toBe(true);
    expect(activityPlotLatLng(a)?.[0]).toBeCloseTo(c!.lat, 5);
  });

  it("plots MultiPolygon at first-ring centroid", () => {
    const a = stubActivity({
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [150.0, -34.0],
            [150.2, -34.0],
            [150.2, -33.8],
            [150.0, -33.8],
            [150.0, -34.0],
          ],
        ],
      ],
    });
    expect(activityHasPlottableGeometry(a)).toBe(true);
    const pt = activityPlotLatLng(a);
    expect(pt).not.toBeNull();
    expect(pt![1]).toBeCloseTo(150.08, 2);
  });

  it("does not plot null geometry", () => {
    const a = stubActivity(null);
    expect(activityCentroid(a)).toBeNull();
    expect(activityPlotLatLng(a)).toBeNull();
    expect(activityHasPlottableGeometry(a)).toBe(false);
  });
});

describe("activity toggle availability (independent category gating)", () => {
  it("only HDA geometry → Major projects shown, DAs/CDCs hidden", () => {
    expect(activityToggleAvailability([stubActivity(pointGeom, "HDA")])).toEqual({
      hasDaCdcActivity: false,
      hasMajorProjectActivity: true,
    });
  });

  it("only DA geometry → DAs/CDCs shown, Major projects hidden", () => {
    expect(activityToggleAvailability([stubActivity(pointGeom, "DA")])).toEqual({
      hasDaCdcActivity: true,
      hasMajorProjectActivity: false,
    });
  });

  it("both → both shown", () => {
    expect(
      activityToggleAvailability([stubActivity(pointGeom, "CDC"), stubActivity(pointGeom, "SSD")]),
    ).toEqual({
      hasDaCdcActivity: true,
      hasMajorProjectActivity: true,
    });
  });

  it("no plottable activity → Activity group hidden", () => {
    expect(activityToggleAvailability([stubActivity(null, "DA"), stubActivity(null, "HDA")])).toEqual({
      hasDaCdcActivity: false,
      hasMajorProjectActivity: false,
    });
    expect(activityToggleAvailability([])).toEqual({
      hasDaCdcActivity: false,
      hasMajorProjectActivity: false,
    });
  });

  it("polygon HDA counts as plottable major-project activity", () => {
    expect(activityToggleAvailability([stubActivity(polygonGeom, "HDA")])).toEqual({
      hasDaCdcActivity: false,
      hasMajorProjectActivity: true,
    });
  });
});
