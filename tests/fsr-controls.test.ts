import { describe, expect, it } from "vitest";
import { resolveParcelFsr } from "@/lib/data-sources/fsr-intersect";
import { computeAssemblyMetrics, effectiveFsr, officialParcelTheoreticalGfa } from "@/lib/analysis/assembly";
import { analyseOpportunity } from "@/lib/analysis/opportunity";
import { DEFAULT_ASSUMPTIONS, parseOpportunityInputs } from "@/lib/analysis/assumptions";
import { lot, rect } from "./helpers";
import type { Feature, Polygon } from "geojson";

const A = { ...DEFAULT_ASSUMPTIONS, planningAdjustment: 1, revenueMode: "PER_SQM" as const };

function poly(coords: number[][]): Feature<Polygon> {
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [coords] } };
}

describe("resolveParcelFsr — official geometry intersection", () => {
  const parcel: Polygon = {
    type: "Polygon",
    // 100m × 50m rectangle ≈ 5000 sqm near Sydney
    coordinates: [
      [
        [151.26, -33.794],
        [151.2609, -33.794],
        [151.2609, -33.79445],
        [151.26, -33.79445],
        [151.26, -33.794],
      ],
    ],
  };

  it("returns a single mapped FSR for a fully covered parcel", () => {
    const r = resolveParcelFsr(parcel, [
      {
        fsr: 2,
        epiName: "Manly Local Environmental Plan 2013",
        lga: "NORTHERN BEACHES",
        layClass: "2-2.09",
        feature: poly([
          [151.259, -33.7935],
          [151.262, -33.7935],
          [151.262, -33.795],
          [151.259, -33.795],
          [151.259, -33.7935],
        ]),
      },
    ]);
    expect(r.status).toBe("MAPPED");
    expect(r.fsr).toBe(2);
    expect(r.controls).toHaveLength(1);
    expect(r.controls[0]!.epiName).toContain("Manly");
    expect(r.theoreticalGfa).toBeGreaterThan(0);
    expect(r.controls[0]!.intersectionShare).toBeGreaterThan(0.95);
  });

  it("returns NO_MAPPED when no FSR polygon intersects", () => {
    const r = resolveParcelFsr(parcel, [
      {
        fsr: 1.5,
        epiName: "Somewhere Else LEP",
        lga: "OTHER",
        layClass: "1.5",
        feature: poly([
          [151.3, -33.7],
          [151.301, -33.7],
          [151.301, -33.701],
          [151.3, -33.701],
          [151.3, -33.7],
        ]),
      },
    ]);
    expect(r.status).toBe("NO_MAPPED");
    expect(r.fsr).toBeNull();
    expect(r.controls).toEqual([]);
    expect(r.theoreticalGfa).toBe(0);
  });

  it("returns SPLIT controls with intersection shares and does not invent a single control", () => {
    // Left half FSR 1.5, right half FSR 2.0
    const mid = 151.26045;
    const r = resolveParcelFsr(parcel, [
      {
        fsr: 1.5,
        epiName: "Manly Local Environmental Plan 2013",
        lga: "NORTHERN BEACHES",
        layClass: "1.5",
        feature: poly([
          [151.259, -33.7935],
          [mid, -33.7935],
          [mid, -33.795],
          [151.259, -33.795],
          [151.259, -33.7935],
        ]),
      },
      {
        fsr: 2.0,
        epiName: "Manly Local Environmental Plan 2013",
        lga: "NORTHERN BEACHES",
        layClass: "2.0",
        feature: poly([
          [mid, -33.7935],
          [151.262, -33.7935],
          [151.262, -33.795],
          [mid, -33.795],
          [mid, -33.7935],
        ]),
      },
    ]);
    expect(r.status).toBe("SPLIT");
    expect(r.controls).toHaveLength(2);
    const shares = r.controls.map((c) => Math.round(c.intersectionShare * 100));
    expect(shares.reduce((s, n) => s + n, 0)).toBeGreaterThanOrEqual(95);
    expect(r.controls.map((c) => c.fsr).sort()).toEqual([1.5, 2]);
    // Equivalent ≈ 1.75 over full parcel
    expect(r.fsr!).toBeGreaterThan(1.6);
    expect(r.fsr!).toBeLessThan(1.9);
  });
});

describe("per-parcel theoretical GFA and assembly equivalent FSR", () => {
  it("computes theoretical GFA from each parcel's official FSR (no silent average of assumptions)", () => {
    const a = lot("A", 0, { fsr: 1.5, areaSqm: 500, fsrStatus: "MAPPED" });
    const b = lot("B", 20, { fsr: 2.0, areaSqm: 800, fsrStatus: "MAPPED" });
    expect(officialParcelTheoreticalGfa(a)).toBe(750);
    expect(officialParcelTheoreticalGfa(b)).toBe(1600);
    const m = computeAssemblyMetrics([a, b], A);
    expect(m.theoreticalGfa).toBeCloseTo(2350);
    expect(m.weightedFsr).toBeCloseTo(2350 / 1300);
    expect(m.fsrEstimated).toBe(false);
  });

  it("does not silently fall back when FSR is unmapped", () => {
    expect(effectiveFsr({ fsr: null, heightM: 12, zone: "R4" }, A)).toEqual({ fsr: 0, basis: "NO_MAPPED" });
    expect(effectiveFsr({ fsr: null, heightM: 12, zone: "R4" }, A, { allowAssumption: true }).basis).toBe("HEIGHT_ESTIMATE");
    const m = computeAssemblyMetrics([lot("A", 0, { fsr: null, heightM: 12, zone: "R4" })], A);
    expect(m.theoreticalGfa).toBe(0);
    expect(m.fsrUnmappedLots).toBe(1);
    expect(m.weightedFsr).toBe(0);
  });

  it("uses split control areas for parcel theoretical GFA", () => {
    const area = 1000;
    const l = lot("S", 0, {
      areaSqm: area,
      fsr: 1.7,
      fsrStatus: "SPLIT",
      fsrControls: [
        { fsr: 1.5, epiName: "Test LEP", lga: "TEST", layClass: null, intersectionAreaSqm: 600, intersectionShare: 0.6 },
        { fsr: 2.0, epiName: "Test LEP", lga: "TEST", layClass: null, intersectionAreaSqm: 400, intersectionShare: 0.4 },
      ],
    });
    expect(officialParcelTheoreticalGfa(l)).toBeCloseTo(600 * 1.5 + 400 * 2.0);
  });

  it("marks opportunity site FSR as NO_MAPPED until a USER ASSUMPTION override is set", () => {
    const lots = [lot("A", 0, { fsr: null }), lot("B", 20, { fsr: null })];
    const none = analyseOpportunity(lots, A, parseOpportunityInputs({}));
    expect(none.site.fsrSource).toBe("NO_MAPPED");
    expect(none.site.fsr).toBe(0);
    expect(none.metrics.theoreticalGfa).toBe(0);

    const assumed = analyseOpportunity(lots, A, parseOpportunityInputs({ fsrOverride: 1.4 }));
    expect(assumed.site.fsrSource).toBe("OVERRIDE");
    expect(assumed.site.fsr).toBe(1.4);
    expect(assumed.base.yield.theoreticalGfa).toBeCloseTo(lots.reduce((s, l) => s + l.areaSqm, 0) * 1.4);
  });

  it("keeps geometry helper available for split tests", () => {
    expect(rect(0, 0, 10, 10).type).toBe("Polygon");
  });
});
