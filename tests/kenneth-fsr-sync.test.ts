import { describe, expect, it } from "vitest";
import { analyseOpportunity } from "@/lib/analysis/opportunity";
import { scoreAssembly, computeAssemblyMetrics } from "@/lib/analysis/assembly";
import { computeFeasibility, grvCrossCheckDiscrepancy } from "@/lib/analysis/feasibility";
import { DEFAULT_ASSUMPTIONS, parseOpportunityInputs } from "@/lib/analysis/assumptions";
import { row } from "./helpers";

const A = { ...DEFAULT_ASSUMPTIONS, revenueMode: "UNIT_MIX" as const, planningAdjustment: 0.9, salePricePerSqm: 15500 };

/** Two-lot Kenneth-like assembly: 1,382 sqm, unmapped LEP FSR, R3. */
function kennethLots() {
  const lots = row(2);
  // helpers row uses 700 sqm — rescale to 691 each ≈ 1,382
  for (const l of lots) {
    l.areaSqm = 691;
    l.fsr = null;
    l.fsrStatus = "NO_MAPPED";
    l.fsrControls = [];
    l.zone = "R3";
    l.heightM = 8.5;
    l.ownerName = null;
  }
  return lots;
}

describe("Kenneth Road effective FSR sync", () => {
  it("uses current SCAN_MODELLED 2.2:1 for theoretical GFA (~3,040 sqm), not stale 1.5:1", () => {
    const lots = kennethLots();
    const siteArea = lots.reduce((s, l) => s + l.areaSqm, 0);
    expect(siteArea).toBe(1382);

    // Stale SCAN_MODELLED 1.5 with INNER proximity must not drive capacity — resolvePlanning
    // recomputes from persisted proximity + zone (same LMR standards, no address hardcoding).
    const staleInputsInner = analyseOpportunity(
      lots,
      A,
      parseOpportunityInputs({
        fsrOverride: 1.5,
        fsrOverrideKind: "SCAN_MODELLED",
        fsrOverrideCertainty: "REQUIRES_PLANNING_CONFIRMATION",
        heightOverrideM: 17.5,
        pathwaySnapshot: {
          lepFsr: null,
          statePathwayFsr: 1.5,
          statePathwayName: "Low & Mid-Rise Housing (Housing SEPP)",
          modelledFsr: 1.5,
          certainty: "REQUIRES_PLANNING_CONFIRMATION",
          lmrCentre: "Manly Vale",
          nearestDistanceM: 189,
          furthestDistanceM: 189,
          proximityScreen: "PASS",
          proximityLabel: "PASS — ESTIMATED",
        },
      }),
    );
    expect(staleInputsInner.site.fsr).toBe(2.2);
    expect(staleInputsInner.base.yield.theoreticalGfa).toBeCloseTo(1382 * 2.2, 1);
    expect(staleInputsInner.planningSnapshot.effectiveControls.effectiveHeightM).toBe(22);

    const current = analyseOpportunity(
      lots,
      A,
      parseOpportunityInputs({
        fsrOverride: 2.2,
        fsrOverrideKind: "SCAN_MODELLED",
        fsrOverrideCertainty: "REQUIRES_PLANNING_CONFIRMATION",
        originalScanFsr: 1.5,
        fsrRecalculationStatus: "RECALCULATED_FROM_UPDATED_PLANNING_PATHWAY",
        heightOverrideM: 22,
        pathwaySnapshot: {
          lepFsr: null,
          statePathwayFsr: 2.2,
          statePathwayName: "Low & Mid-Rise Housing (Housing SEPP)",
          modelledFsr: 2.2,
          certainty: "REQUIRES_PLANNING_CONFIRMATION",
          lmrCentre: "Manly Vale",
          nearestDistanceM: 189,
          furthestDistanceM: 189,
          proximityScreen: "PASS",
          proximityLabel: "PASS — ESTIMATED",
        },
      }),
    );

    expect(current.site.fsr).toBe(2.2);
    expect(current.site.fsrSource).toBe("STATE_PATHWAY");
    expect(current.base.yield.theoreticalGfa).toBeCloseTo(1382 * 2.2, 1);
    expect(current.base.yield.theoreticalGfa).toBeCloseTo(3040.4, 1);
    expect(current.base.yield.achievableGfa).toBeCloseTo(3040.4 * A.planningAdjustment, 0);
    expect(current.metrics.weightedFsr).toBeCloseTo(2.2, 3);
    // Overview / Yield / Feasibility / score all share the same effective FSR.
    expect(current.base.fsr).toBeCloseTo(2.2, 3);
    expect(current.score.factors.some((f) => /Modelled effective FSR 2\.20:1/i.test(f.text))).toBe(true);
    expect(current.score.factors.some((f) => /USER ASSUMPTION/i.test(f.text))).toBe(false);
    expect(current.score.factors.some((f) => /official FSR 0\.00/i.test(f.text))).toBe(false);
    expect(current.score.factors.some((f) => /minimum viable site/i.test(f.text))).toBe(false);
    expect(current.score.factors.some((f) => /preferred scanner site-size threshold/i.test(f.text))).toBe(true);
    expect(current.score.factors.some((f) => /Owner count unknown/i.test(f.text))).toBe(true);
    expect(current.score.factors.some((f) => /two owners/i.test(f.text))).toBe(false);
  });

  it("only asks for USER FSR when no LEP or State pathway FSR is available", () => {
    const lots = kennethLots();
    const bare = analyseOpportunity(lots, A, parseOpportunityInputs({}));
    expect(bare.site.yieldStatus).toBe("REQUIRES_PLANNING_INPUT");
    expect(bare.score.factors.some((f) => /USER FSR REQUIRED/i.test(f.text))).toBe(true);

    const m = computeAssemblyMetrics(lots, A);
    const scored = scoreAssembly(m, A, {
      effectiveFsr: 2.2,
      fsrSource: "STATE_PATHWAY",
      statePathwayName: "LMR",
      lepFsr: null,
      proximityLabel: "PASS — ESTIMATED",
    });
    expect(scored.factors.some((f) => /USER ASSUMPTION/i.test(f.text))).toBe(false);
    expect(scored.factors.some((f) => /USER FSR REQUIRED/i.test(f.text))).toBe(false);
    expect(scored.factors.some((f) => /Modelled effective FSR 2\.20:1/i.test(f.text))).toBe(true);
  });

  it("does not flag lift/basement when BMT all-in rate is used; still sense-checks GRV $/sqm", () => {
    const f = computeFeasibility({
      gfa: 2700,
      saleableArea: 1545,
      dwellings: 20,
      lotCount: 2,
      unitMix: [
        { name: "2 bed", count: 20, avgInternalArea: 70, avgExternalArea: 7, avgSaleableArea: 77.25, salePricePerUnit: 1_467_500 },
      ],
      a: {
        ...A,
        constructionCostPerSqm: 4154,
        basementParkingCost: 0,
        liftsCost: 0,
        siteWorksCost: 0,
        remediationCost: 0,
      },
    });
    // BMT all-in includes lift + basement — only optional site lines remain.
    expect(f.costInputGaps.map((g) => g.key)).toEqual(
      expect.arrayContaining(["siteWorksCost", "remediationCost"]),
    );
    expect(f.costInputGaps.map((g) => g.key)).not.toEqual(
      expect.arrayContaining(["basementParkingCost", "liftsCost"]),
    );
    expect(f.grvCrossCheckWarning).not.toBeNull();
    expect(f.grvCrossCheckWarning!.status).toBe("EXIT_VALUE_VALIDATION_REQUIRED");
    expect(f.grvCrossCheckWarning!.crossCheckRatePerSqm).toBe(15500);
    expect(f.grv).toBe(20 * 1_467_500);

    const warn = grvCrossCheckDiscrepancy(29_350_000, 1545, 15500);
    expect(warn).not.toBeNull();
    expect(warn!.differencePct).toBeGreaterThan(0.2);
  });
});
