import { describe, expect, it } from "vitest";
import { applyCanonicalOverlay, syncCandidatesWithCanonical } from "@/lib/analysis/sync-scan-canonical";
import type { ScanCandidate } from "@/lib/analysis/area-scan";
import { groupAcquisitionProperties, acquisitionPropertyTotal } from "@/lib/analysis/acquisition-property";

function stubCandidate(partial: Partial<ScanCandidate> & { key: string }): ScanCandidate {
  return {
    key: partial.key,
    rank: 1,
    label: "Test",
    lotIds: ["a", "b"],
    lotCount: 2,
    owners: 2,
    siteAreaSqm: 1382,
    lepFsr: null,
    effectiveFsr: 1.5,
    effectiveCertainty: "REQUIRES_PLANNING_CONFIRMATION",
    developmentType: "rfb",
    indicativeUnits: 18,
    existingValue: 3_500_000,
    existingValueLow: null,
    existingValueHigh: null,
    existingValueEstimated: false,
    maxPayable: 10_900_000,
    headroom: 7_340_000,
    headroomLow: null,
    headroomHigh: null,
    headroomPercent: null,
    financialRankingAvailable: true,
    planningPotentialScore: 80,
    constraints: [],
    scoreFactors: [],
    lmrCentre: "Manly Vale",
    lmrBand: "INNER_0_400",
    metrics: {} as ScanCandidate["metrics"],
    score: { score: 89, components: {} as never, factors: [] },
    calculationSnapshot: {
      version: "v1",
      calculatedAt: "2026-01-01T00:00:00.000Z",
      lotIds: ["a", "b"],
      lepFsr: null,
      statePolicyFsr: 1.5,
      modelledEffectiveFsr: 1.5,
      effectiveCertainty: "REQUIRES_PLANNING_CONFIRMATION",
      effectiveHeightM: 17.5,
      existingValue: 3_500_000,
      existingValueEstimated: false,
      maxPayable: 10_900_000,
      headroom: 7_340_000,
      headroomPercent: null,
      grv: 29_000_000,
      theoreticalGfa: 2073,
      achievableGfa: 1866,
      dwellings: 18,
      siteAreaSqm: 1382,
      score: 89,
      lmrCentre: "Manly Vale",
      lmrBand: "INNER_0_400",
      developmentType: "rfb",
      perLot: {},
    },
    ...partial,
  };
}

describe("sync scan canonical", () => {
  it("overlays CalculationSnapshot as current and keeps original scan as history", () => {
    const c = stubCandidate({ key: "nsw-a|nsw-b" });
    const next = applyCanonicalOverlay(c, {
      opportunityId: "opp1",
      assemblyKey: "nsw-a|nsw-b",
      scanSessionId: "scan1",
      currentEffectiveFsr: 2.2,
      currentEffectiveHeightM: 22,
      currentMaxPayable: 15_700_000,
      currentHeadroom: 12_200_000,
      currentScore: 98,
      currentGrv: 42_600_000,
      currentTheoreticalGfa: 3040,
      currentAchievableGfa: 2736,
      originalScanFsr: 1.5,
      originalScanMaxPayable: 10_900_000,
      originalScanHeadroom: 7_340_000,
      originalScanScore: 89,
      analysedAt: "2026-10-04T00:00:00.000Z",
    });
    expect(next.effectiveFsr).toBe(2.2);
    expect(next.maxPayable).toBe(15_700_000);
    expect(next.headroom).toBe(12_200_000);
    expect(next.score.score).toBe(98);
    expect(next.originalScanFsr).toBe(1.5);
    expect(next.originalScanMaxPayable).toBe(10_900_000);
    expect(next.originalScanScore).toBe(89);
    expect(next.canonicalOpportunityId).toBe("opp1");
  });

  it("reranks after sync so higher canonical score rises", () => {
    const a = stubCandidate({ key: "a", rank: 1 });
    const b = stubCandidate({ key: "b", rank: 2, score: { score: 70, components: {} as never, factors: [] } });
    const synced = syncCandidatesWithCanonical([a, b], [
      {
        opportunityId: "opp-b",
        assemblyKey: "b",
        scanSessionId: null,
        currentEffectiveFsr: 2.2,
        currentEffectiveHeightM: 22,
        currentMaxPayable: 20_000_000,
        currentHeadroom: 15_000_000,
        currentScore: 99,
        currentGrv: 50_000_000,
        currentTheoreticalGfa: 3000,
        currentAchievableGfa: 2700,
        originalScanFsr: 1.5,
        originalScanMaxPayable: 10_000_000,
        originalScanHeadroom: 5_000_000,
        originalScanScore: 70,
        analysedAt: "2026-10-04T00:00:00.000Z",
      },
    ]);
    expect(synced[0]!.key).toBe("b");
    expect(synced[0]!.rank).toBe(1);
    expect(synced[0]!.score.score).toBe(99);
  });
});

describe("acquisition property grouping", () => {
  it("does not sum two cadastral lots that share one address", () => {
    const props = groupAcquisitionProperties([
      { id: "1", address: "66-68 Kenneth Road, Manly Vale", areaSqm: 909, marketValue: 1_897_061, marketValueLow: 1_500_000, marketValueHigh: 2_200_000 },
      { id: "2", address: "66-68 Kenneth Road, Manly Vale", areaSqm: 473, marketValue: 1_631_517, marketValueLow: 1_400_000, marketValueHigh: 1_800_000 },
    ]);
    expect(props).toHaveLength(1);
    expect(props[0]!.valueBasis).toBe("MAX_OF_SHARED_ADDRESS");
    expect(props[0]!.marketValue).toBe(1_897_061);
    const total = acquisitionPropertyTotal(props);
    expect(total.mid).toBe(1_897_061);
    expect(total.complete).toBe(true);
  });
});
