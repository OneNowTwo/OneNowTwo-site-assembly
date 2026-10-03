import { describe, expect, it } from "vitest";
import { resolveAssemblyModelledControls } from "@/lib/analysis/resolve-assembly-controls";
import type { NominatedCentre } from "@/lib/data-sources/housing-sepp-lmr";
import type { ParcelData } from "@/lib/types";

const centre: NominatedCentre = {
  id: "tc-neutral-bay",
  label: "Neutral Bay",
  layClass: "Town Centre",
  lng: 151.218,
  lat: -33.832,
  source: "test",
  retrievedAt: new Date().toISOString(),
};

function parcel(partial: Partial<ParcelData> & { centroid: [number, number]; areaSqm: number }): ParcelData {
  return {
    externalParcelId: partial.externalParcelId ?? "p1",
    source: "LIVE_NSW",
    lot: "1",
    section: null,
    dp: "DP1",
    lotIdString: "1//DP1",
    address: "114 Kurraba Road",
    suburb: "Neutral Bay",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [partial.centroid[0], partial.centroid[1]],
          [partial.centroid[0] + 0.0002, partial.centroid[1]],
          [partial.centroid[0] + 0.0002, partial.centroid[1] + 0.0002],
          [partial.centroid[0], partial.centroid[1] + 0.0002],
          [partial.centroid[0], partial.centroid[1]],
        ],
      ],
    },
    centroid: partial.centroid,
    areaSqm: partial.areaSqm,
    isStrata: false,
    planning: partial.planning ?? null,
    planningStatus: "ok",
    retrievedAt: new Date().toISOString(),
  };
}

describe("resolveAssemblyModelledControls", () => {
  it("does not treat missing LEP FSR as zero when LMR pathway applies", () => {
    const p = parcel({
      centroid: [151.218, -33.833],
      areaSqm: 450,
      planning: {
        zone: "R2",
        zoneName: "Low Density Residential",
        fsr: null,
        fsrStatus: "NO_MAPPED",
        fsrControls: [],
        heightM: 8.5,
        minLotSizeSqm: 450,
        heritage: null,
        planningInstrument: "North Sydney LEP",
        lga: "NORTH SYDNEY",
        sources: {},
      },
    });
    const r = resolveAssemblyModelledControls([p], [centre]);
    expect(r.lepFsr).toBeNull();
    expect(r.anyUnmappedLep).toBe(true);
    expect(r.modelledFsr).toBe(0.8);
    expect(r.usedStatePathway).toBe(true);
    expect(r.notes.some((n) => /NO MAPPED LEP FSR/i.test(n))).toBe(true);
  });
});
