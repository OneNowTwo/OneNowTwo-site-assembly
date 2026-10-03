import { describe, expect, it } from "vitest";
import { resolveEffectiveControls } from "@/lib/analysis/effective-controls";
import { lmrBandFromDistanceM, lmrRfbStandardForZone, type NominatedCentre } from "@/lib/data-sources/housing-sepp-lmr";
import { assessParcelEligibility, generateAreaAssemblies, groupAssemblyFamilies } from "@/lib/analysis/area-scan";
import { buildAdjacency } from "@/lib/analysis/geometry";
import { DEFAULT_ASSUMPTIONS } from "@/lib/analysis/assumptions";
import { lot, row } from "./helpers";
import type { ParcelData } from "@/lib/types";

const centre: NominatedCentre = {
  id: "town-centre:test",
  label: "Balgowlah Stockland shopping centre",
  layClass: "Town Centre",
  lng: 151.26443,
  lat: -33.79353,
  source: "test",
  retrievedAt: "2026-10-02T00:00:00.000Z",
};

describe("LMR standards", () => {
  it("bands distance correctly", () => {
    expect(lmrBandFromDistanceM(100)).toBe("INNER_0_400");
    expect(lmrBandFromDistanceM(500)).toBe("OUTER_400_800");
    expect(lmrBandFromDistanceM(900)).toBe("OUTSIDE");
  });

  it("applies R1/R2 and R3/R4 RFB standards", () => {
    expect(lmrRfbStandardForZone("R1", "OUTER_400_800").fsr).toBe(0.8);
    expect(lmrRfbStandardForZone("R3", "INNER_0_400").fsr).toBe(2.2);
    expect(lmrRfbStandardForZone("R4", "OUTER_400_800").fsr).toBe(1.5);
    expect(lmrRfbStandardForZone("RE1", "INNER_0_400").applicable).toBe(false);
  });
});

describe("effective controls", () => {
  it("keeps LEP when outside LMR screen", () => {
    const eff = resolveEffectiveControls(
      {
        zone: "R1",
        zoneName: "General Residential",
        fsr: 0.5,
        fsrStatus: "MAPPED",
        fsrControls: [],
        heightM: 8.5,
        minLotSizeSqm: 300,
        heritage: "None mapped",
        planningInstrument: "Manly LEP 2013",
        lga: "NORTHERN BEACHES",
        sources: {},
      },
      [151.3, -33.9],
      [centre],
    );
    expect(eff.modelled.fsr).toBe(0.5);
    expect(eff.statePolicy).toBeNull();
    expect(eff.modelled.certainty).toBe("OFFICIAL_LEP");
  });

  it("models LMR uplift for R1 near nominated centre without claiming confirmed walking eligibility", () => {
    const eff = resolveEffectiveControls(
      {
        zone: "R1",
        zoneName: "General Residential",
        fsr: 0.5,
        fsrStatus: "MAPPED",
        fsrControls: [],
        heightM: 8.5,
        minLotSizeSqm: 300,
        heritage: "None mapped",
        planningInstrument: "Manly LEP 2013",
        lga: "NORTHERN BEACHES",
        sources: {},
      },
      [151.263, -33.7915],
      [centre],
    );
    expect(eff.lep.fsr).toBe(0.5);
    expect(eff.statePolicy?.fsr).toBe(0.8);
    expect(eff.modelled.fsr).toBe(0.8);
    expect(eff.modelled.certainty).toBe("REQUIRES_PLANNING_CONFIRMATION");
    expect(eff.lmr.distanceBasis).toBe("STRAIGHT_LINE_APPROXIMATION");
    expect(eff.fsrUplift).toBeCloseTo(0.3);
  });

  it("uses pedestrian route distance when walking hint is OK and does not silently fall back on failure", () => {
    const planning = {
      zone: "R1",
      zoneName: "General Residential",
      fsr: 0.5,
      fsrStatus: "MAPPED" as const,
      fsrControls: [],
      heightM: 8.5,
      minLotSizeSqm: 300,
      heritage: "None mapped",
      planningInstrument: "Manly LEP 2013",
      lga: "NORTHERN BEACHES",
      sources: {},
    };
    const ok = resolveEffectiveControls(planning, [151.263, -33.7915], [centre], {
      status: "OK",
      straightLineDistanceM: 540,
      walkingDistanceM: 683,
      provider: "OSRM foot",
    });
    expect(ok.lmr.distanceBasis).toBe("PEDESTRIAN_ROUTE");
    expect(ok.lmr.walkingDistanceM).toBe(683);
    expect(ok.modelled.certainty).toBe("STATE_POLICY_CANDIDATE");

    const failed = resolveEffectiveControls(planning, [151.263, -33.7915], [centre], {
      status: "FAILED",
      straightLineDistanceM: 540,
      walkingDistanceM: null,
    });
    expect(failed.lmr.distanceBasis).toBe("STRAIGHT_LINE_APPROXIMATION");
    expect(failed.modelled.certainty).toBe("REQUIRES_PLANNING_CONFIRMATION");
    expect(failed.lmr.exclusionNotes.some((n) => n.includes("WALKING DISTANCE NOT CONFIRMED"))).toBe(true);
  });
});

describe("area scan generation", () => {
  it("generates assemblies without a user-selected start parcel", () => {
    const lots = row(5).map((l, i) => ({ ...l, fsr: 0.8, zone: "R1", areaSqm: 500 + i }));
    const adj = buildAdjacency(lots);
    const found = generateAreaAssemblies(lots, adj, DEFAULT_ASSUMPTIONS, { maxSeeds: 5, maxSize: 4, minAreaSqm: 900 });
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((c) => c.lotIds.length >= 2)).toBe(true);
  });

  it("groups overlapping assemblies into families", () => {
    const families = groupAssemblyFamilies([
      {
        key: "a|b|c",
        rank: 1,
        lotIds: ["a", "b", "c"],
        locationLabel: "Test",
        lotCount: 3,
        owners: 3,
        siteAreaSqm: 1500,
        lepFsr: 0.5,
        effectiveFsr: 0.8,
        effectiveCertainty: "REQUIRES_PLANNING_CONFIRMATION",
        developmentType: "rfb",
        indicativeUnits: 10,
        existingValue: 1,
        existingValueEstimated: true,
        maxPayable: 1,
        headroom: 1,
        headroomPercent: 1,
        financialRankingAvailable: false,
        planningPotentialScore: 80,
        constraints: [],
        scoreFactors: [],
        lmrCentre: null,
        lmrBand: "OUTER_400_800",
        metrics: { lotIds: ["a", "b", "c"] } as never,
        score: { score: 80, factors: [], components: {} as never, weights: {} as never },
        calculationSnapshot: { modelledEffectiveFsr: 0.8, maxPayable: 1, existingValue: 1, headroom: 1 } as never,
      },
      {
        key: "a|b|c|d",
        rank: 2,
        lotIds: ["a", "b", "c", "d"],
        locationLabel: "Test",
        lotCount: 4,
        owners: 4,
        siteAreaSqm: 2000,
        lepFsr: 0.5,
        effectiveFsr: 0.8,
        effectiveCertainty: "REQUIRES_PLANNING_CONFIRMATION",
        developmentType: "rfb",
        indicativeUnits: 12,
        existingValue: 1,
        existingValueEstimated: true,
        maxPayable: 1,
        headroom: 0.5,
        headroomPercent: 0.5,
        financialRankingAvailable: false,
        planningPotentialScore: 70,
        constraints: [],
        scoreFactors: [],
        lmrCentre: null,
        lmrBand: "OUTER_400_800",
        metrics: { lotIds: ["a", "b", "c", "d"] } as never,
        score: { score: 70, factors: [], components: {} as never, weights: {} as never },
        calculationSnapshot: { modelledEffectiveFsr: 0.8, maxPayable: 1, existingValue: 1, headroom: 0.5 } as never,
      },
    ]);
    expect(families).toHaveLength(1);
    expect(families[0]!.alternatives).toHaveLength(1);
  });

  it("rejects parks and explains reasons", () => {
    const p = {
      externalParcelId: "x",
      source: "LIVE_NSW",
      lot: "1",
      section: null,
      dp: "DP1",
      lotIdString: "1//DP1",
      address: "1 Park Lane",
      suburb: "Balgowlah",
      geometry: lot("x", 0).geometry,
      centroid: [151.264, -33.793] as [number, number],
      areaSqm: 800,
      isStrata: false,
      planning: {
        zone: "RE1",
        zoneName: "Public Recreation",
        fsr: null,
        fsrStatus: "NO_MAPPED",
        fsrControls: [],
        heightM: null,
        minLotSizeSqm: null,
        heritage: "None mapped",
        planningInstrument: "Manly LEP 2013",
        lga: "NORTHERN BEACHES",
        sources: {},
      },
      planningStatus: "ok",
      retrievedAt: "2026-10-02T00:00:00.000Z",
    } satisfies ParcelData;
    const el = assessParcelEligibility(p, [centre]);
    expect(el.eligible).toBe(false);
    expect(el.reasons.length).toBeGreaterThan(0);
  });
});
