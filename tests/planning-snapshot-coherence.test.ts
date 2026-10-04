import { describe, expect, it } from "vitest";
import { analyseOpportunity } from "@/lib/analysis/opportunity";
import { DEFAULT_ASSUMPTIONS, parseOpportunityInputs } from "@/lib/analysis/assumptions";
import { resolvePlanning } from "@/lib/planning/resolve-planning";
import { formatLepFsr } from "@/lib/planning/planning-snapshot";
import { row } from "./helpers";

const A = { ...DEFAULT_ASSUMPTIONS, revenueMode: "UNIT_MIX" as const, planningAdjustment: 0.9, salePricePerSqm: 15500 };

/** Inner-LMR assembly shape — acceptance fixture, not a hard-coded address. */
function innerLmrLots() {
  const lots = row(2);
  for (const l of lots) {
    l.areaSqm = 691;
    l.fsr = null;
    l.fsrStatus = "NO_MAPPED";
    l.fsrControls = [];
    l.zone = "R3";
    l.zoneName = "Medium Density Residential";
    l.heightM = 11;
    l.planningInstrument = "Warringah Local Environmental Plan 2011";
    l.ownerName = null;
  }
  return lots;
}

const INNER_PATHWAY = {
  fsrOverride: 2.2,
  fsrOverrideKind: "SCAN_MODELLED" as const,
  fsrOverrideCertainty: "REQUIRES_PLANNING_CONFIRMATION",
  heightOverrideM: 22,
  pathwaySnapshot: {
    lepFsr: null,
    statePathwayFsr: 2.2,
    statePathwayName: "Low & Mid-Rise Housing (Housing SEPP)",
    modelledFsr: 2.2,
    modelledHeightM: 22,
    certainty: "REQUIRES_PLANNING_CONFIRMATION",
    lmrCentre: "Manly Vale",
    lmrBand: "INNER_0_400",
    nearestDistanceM: 189,
    furthestDistanceM: 208,
    proximityScreen: "PASS" as const,
    proximityLabel: "PASS — ESTIMATED",
  },
};

describe("resolvePlanning → calculateOpportunity single-source coherence", () => {
  it("PlanningSnapshot and CalculationSnapshot agree on effective 2.2:1 / 22m", () => {
    const lots = innerLmrLots();
    const inputs = parseOpportunityInputs(INNER_PATHWAY);
    const planning = resolvePlanning({
      lots: lots.map((l) => ({
        id: l.id,
        label: l.label,
        included: true,
        areaSqm: l.areaSqm,
        zone: l.zone,
        zoneName: l.zoneName,
        fsr: l.fsr,
        heightM: l.heightM,
        minLotSizeSqm: l.minLotSizeSqm,
        heritage: l.heritage,
        planningInstrument: l.planningInstrument ?? null,
        planningCheckedAt: null,
      })),
      inputs,
    });

    expect(formatLepFsr(planning.currentStatutoryControls.lepFsr)).toBe("Not mapped");
    expect(planning.currentStatutoryControls.lepHeightM).toBe(11);
    expect(planning.currentStatePathways.some((p) => p.kind === "LMR")).toBe(true);
    const lmr = planning.currentStatePathways.find((p) => p.kind === "LMR")!;
    expect(lmr.stateFsr).toBe(2.2);
    expect(lmr.stateHeightM).toBe(22);
    expect(lmr.effectiveFsr).toBe(2.2);
    expect(lmr.effectiveHeightM).toBe(22);
    expect(lmr.proximityBand).toBe("INNER_0_400");
    expect(planning.effectiveControls.effectiveFsr).toBe(2.2);
    expect(planning.effectiveControls.effectiveHeightM).toBe(22);
    expect(planning.effectiveControls.baseFsr).toBeNull();
    expect(formatLepFsr(planning.effectiveControls.baseFsr)).toBe("Not mapped");
    // No contradictory empty pathway when State pathway drives yield.
    expect(planning.currentStatePathways.filter((p) => p.kind === "LMR")).toHaveLength(1);

    const analysis = analyseOpportunity(lots, A, inputs);
    expect(analysis.planningSnapshot.effectiveControls.effectiveFsr).toBe(2.2);
    expect(analysis.planningSnapshot.effectiveControls.effectiveHeightM).toBe(22);
    expect(analysis.calculation.effectiveFsr).toBe(2.2);
    expect(analysis.calculation.effectiveHeightM).toBe(22);
    expect(analysis.calculation.calculable).toBe(true);
    expect(analysis.site.fsr).toBe(2.2);
    expect(analysis.base.fsr).toBe(2.2);
    expect(analysis.base.yield.theoreticalGfa).toBeCloseTo(1382 * 2.2, 1);
    expect(analysis.metrics.weightedFsr).toBeCloseTo(2.2, 3);
    // Unmapped must never surface as 0.0:1 capacity.
    expect(analysis.score.factors.some((f) => /official FSR 0\.00/i.test(f.text))).toBe(false);
    expect(analysis.score.factors.some((f) => /USER ASSUMPTION/i.test(f.text))).toBe(false);
    expect(analysis.score.factors.some((f) => /USER FSR REQUIRED/i.test(f.text))).toBe(false);
    // Stale outer-band values must not appear.
    expect(analysis.planningSnapshot.effectiveControls.stateFsr).not.toBe(1.5);
    expect(analysis.planningSnapshot.effectiveControls.stateHeightM).not.toBe(17.5);
    expect(analysis.calculation.effectiveHeightM).not.toBe(17.5);
  });

  it("does not ask for USER FSR when State pathway supplies modelled FSR", () => {
    const lots = innerLmrLots();
    const bare = analyseOpportunity(lots, A, parseOpportunityInputs({}));
    expect(bare.planningSnapshot.effectiveControls.fsrSource).toBe("NO_MAPPED");
    expect(bare.calculation.calculable).toBe(false);
    expect(formatLepFsr(bare.planningSnapshot.effectiveControls.baseFsr)).toBe("Not mapped");

    const withPathway = analyseOpportunity(lots, A, parseOpportunityInputs(INNER_PATHWAY));
    expect(withPathway.planningSnapshot.lots.every((l) => l.planningStatus === "Requires confirmation")).toBe(true);
    expect(withPathway.planningSnapshot.lots.every((l) => l.modelledFsr === 2.2)).toBe(true);
  });
});
