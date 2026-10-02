import { describe, expect, it } from "vitest";
import { buildAdjacency, isConnected, components } from "@/lib/analysis/geometry";
import { computeAssemblyMetrics, effectiveFsr, generateAssemblies, scoreAssembly } from "@/lib/analysis/assembly";
import { DEFAULT_ASSUMPTIONS } from "@/lib/analysis/assumptions";
import { lot, rect, row } from "./helpers";

const A = DEFAULT_ASSUMPTIONS;

describe("adjacency", () => {
  it("links lots sharing a boundary and ignores distant ones", () => {
    const lots = [...row(3), lot("FAR", 200)];
    const adj = buildAdjacency(lots);
    expect([...adj.get("A")!]).toEqual(["B"]);
    expect(adj.get("B")!.has("A") && adj.get("B")!.has("C")).toBe(true);
    expect(adj.get("FAR")!.size).toBe(0);
  });

  it("tolerates small digitising gaps but not corner-only contact", () => {
    const gap = [
      { id: "x", geometry: rect(0, 0, 20, 30) },
      { id: "y", geometry: rect(20.4, 0, 20, 30) }, // 0.4 m gap
      { id: "z", geometry: rect(40.4, 30, 20, 30) }, // touches y only at a corner
    ];
    const adj = buildAdjacency(gap, { toleranceM: 1 });
    expect(adj.get("x")!.has("y")).toBe(true);
    expect(adj.get("y")!.has("z")).toBe(false);
  });

  it("detects connectivity and fragments", () => {
    const adj = buildAdjacency(row(5));
    expect(isConnected(["A", "B", "C"], adj)).toBe(true);
    expect(isConnected(["A", "C"], adj)).toBe(false);
    expect(components(["A", "B", "D", "E"], adj)).toHaveLength(2);
  });
});

describe("assembly metrics", () => {
  it("sums combined site area and area-weights FSR", () => {
    const lots = [lot("A", 0, { fsr: 1 }), lot("B", 20, { fsr: 2 }), lot("C", 40, { fsr: null, zone: "R2", heightM: 8.5 })];
    const m = computeAssemblyMetrics(lots, { ...A, planningAdjustment: 1, revenueMode: "PER_SQM" });
    expect(m.totalAreaSqm).toBe(2100);
    expect(m.theoreticalGfa).toBeCloseTo(700 * 1 + 700 * 2 + 700 * A.fallbackFsr);
    expect(m.gfa).toBeCloseTo(m.theoreticalGfa);
    expect(m.weightedFsr).toBeCloseTo((1 + 2 + A.fallbackFsr) / 3);
    expect(m.fsrEstimated).toBe(true);
    expect(m.combinedValue).toBe(3_900_000);
  });

  it("estimates FSR from the height control where none is mapped in apartment zones", () => {
    // 12 m ÷ 3.1 m = 3 storeys × 45% coverage = 1.35:1
    expect(effectiveFsr({ fsr: null, heightM: 12, zone: "R4" }, A)).toEqual({ fsr: 1.35, basis: "HEIGHT_ESTIMATE" });
    expect(effectiveFsr({ fsr: null, heightM: 8.5, zone: "R2" }, A)).toEqual({ fsr: A.fallbackFsr, basis: "FALLBACK" });
    expect(effectiveFsr({ fsr: 2, heightM: null, zone: "R2" }, A).basis).toBe("OFFICIAL");
  });

  it("explains the score with positive and negative factors", () => {
    const lots = row(4);
    lots[1]!.heritage = "Item - General — House — Local";
    const s = scoreAssembly(computeAssemblyMetrics(lots, { ...A, revenueMode: "PER_SQM", planningAdjustment: 1 }), A);
    expect(s.score).toBeGreaterThan(0);
    expect(s.score).toBeLessThanOrEqual(100);
    expect(s.factors.some((f) => f.sign === "+" && f.text.includes("2,800 sqm combined site"))).toBe(true);
    expect(s.factors.some((f) => f.sign === "-" && f.text.includes("heritage item"))).toBe(true);
  });
});

describe("assembly generation", () => {
  it("returns only connected combinations of 2..max lots containing the start lot", () => {
    const lots = row(7);
    const adj = buildAdjacency(lots);
    const res = generateAssemblies(lots, adj, "D", A, { maxSize: 6, maxResults: 20 });
    expect(res.length).toBeGreaterThan(5);
    for (const c of res) {
      expect(c.lotIds).toContain("D");
      expect(c.lotIds.length).toBeGreaterThanOrEqual(2);
      expect(c.lotIds.length).toBeLessThanOrEqual(6);
      expect(isConnected(c.lotIds, adj)).toBe(true);
    }
    expect(new Set(res.map((c) => c.key)).size).toBe(res.length);
    const sizes = new Set(res.map((c) => c.lotIds.length));
    expect(sizes.size).toBeGreaterThanOrEqual(4);
  });

  it("skips non-developable zones and stays bounded on a dense grid", () => {
    const grid = [];
    for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) grid.push({ ...lot(`${i}-${j}`, i * 20), geometry: rect(i * 20, j * 35, 20, 35) });
    grid.find((l) => l.id === "6-5")!.zone = "RE1";
    grid.find((l) => l.id === "7-6")!.isStrata = true;
    const adj = buildAdjacency(grid);
    const t = Date.now();
    const res = generateAssemblies(grid, adj, "6-6", A, { maxSize: 6 });
    expect(Date.now() - t).toBeLessThan(5000);
    expect(res.length).toBeGreaterThan(0);
    expect(res.every((c) => !c.lotIds.includes("6-5"))).toBe(true);
    expect(res.every((c) => !c.lotIds.includes("7-6"))).toBe(true);
  });
});
