import { describe, expect, it } from "vitest";
import { analyseOpportunity, applyScenario } from "@/lib/analysis/opportunity";
import { DEFAULT_ASSUMPTIONS, DEFAULT_SCENARIOS, parseOpportunityInputs } from "@/lib/analysis/assumptions";
import { analyseCriticalLots } from "@/lib/analysis/critical";
import { buildAdjacency } from "@/lib/analysis/geometry";
import { row } from "./helpers";

const A = { ...DEFAULT_ASSUMPTIONS, minViableSiteAreaSqm: 2000 };
const inputs = parseOpportunityInputs({});

describe("critical lot analysis", () => {
  it("flags the middle lot of a row as a critical connector and end lots as optional", () => {
    const lots = row(5);
    const res = analyseOpportunity(lots, A, inputs);
    const byId = new Map(res.critical.map((c) => [c.id, c]));
    expect(byId.get("C")!.status).toBe("CRITICAL");
    expect(byId.get("C")!.connector).toBe(true);
    expect(byId.get("A")!.status).toBe("OPTIONAL");
    expect(byId.get("A")!.areaReductionPct).toBeCloseTo(0.2);
    expect(byId.get("A")!.remainingConnected).toBe(true);
  });

  it("marks a lot critical when the remainder falls below the minimum viable area", () => {
    const lots = row(3); // 2,100 sqm; any removal leaves 1,400 < 2,000
    const adj = buildAdjacency(lots);
    const econ = (ids: string[]) => ({ areaSqm: ids.length * 700, gfa: ids.length * 1050, budget: ids.length * 3e6 });
    const res = analyseCriticalLots(lots.map((l) => ({ id: l.id, areaSqm: 700, marketValue: 1.3e6 })), adj, econ(["A", "B", "C"]), econ, { minViableSiteAreaSqm: 2000 });
    expect(res.every((r) => r.status === "CRITICAL" && r.belowMinViable)).toBe(true);
  });
});

describe("removing a property changes the economics", () => {
  it("reduces site area, GFA and budget when a lot is excluded", () => {
    const lots = row(5);
    const all = analyseOpportunity(lots, A, inputs);
    lots[4].included = false;
    const without = analyseOpportunity(lots, A, inputs);
    expect(without.site.siteAreaSqm).toBe(all.site.siteAreaSqm - 700);
    expect(without.base.yield.gfa).toBeLessThan(all.base.yield.gfa);
    expect(without.base.feasibility.maxAcquisitionBudget).toBeLessThan(all.base.feasibility.maxAcquisitionBudget);
    expect(without.allocation.lots).toHaveLength(4);
    expect(without.excludedIds).toEqual(["E"]);
  });
});

describe("scenarios", () => {
  it("applies sale price, build cost, FSR, finance and margin adjustments", () => {
    const s = applyScenario(A, DEFAULT_SCENARIOS.DOWNSIDE);
    expect(s.salePricePerSqm).toBeCloseTo(A.salePricePerSqm * 0.9);
    expect(s.constructionCostPerSqm).toBeCloseTo(A.constructionCostPerSqm * 1.08);
    expect(s.financePct).toBeCloseTo(A.financePct + 0.015);
    expect(s.targetMarginOnCost).toBeCloseTo(A.targetMarginOnCost + 0.03);

    const r = analyseOpportunity(row(5), A, inputs);
    expect(r.scenarios.DOWNSIDE.fsr).toBeCloseTo(r.scenarios.BASE.fsr * 0.9);
    expect(r.scenarios.UPSIDE.feasibility.maxAcquisitionBudget).toBeGreaterThan(r.base.feasibility.maxAcquisitionBudget);
    expect(r.scenarios.DOWNSIDE.feasibility.maxAcquisitionBudget).toBeLessThan(r.base.feasibility.maxAcquisitionBudget);
  });

  it("allocates the base budget across lots and builds an acquisition sequence", () => {
    const r = analyseOpportunity(row(5), A, inputs);
    expect(r.allocation.totalMaximum).toBeCloseTo(r.base.feasibility.maxAcquisitionBudget);
    expect(r.strategy[0].role).toBe("Critical connector");
    expect(r.strategy.some((s) => s.kind === "milestone")).toBe(true);
    expect(r.strategy.filter((s) => s.kind === "lot")).toHaveLength(5);
  });
});
