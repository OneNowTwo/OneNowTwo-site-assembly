import { describe, expect, it } from "vitest";
import {
  clampScreeningScore,
  resolveDisplayScore,
} from "@/lib/intelligence/display-score";
import {
  groupIndexCandidateFamilies,
  pickBestPerIndexFamily,
  sameIndexFamily,
} from "@/lib/intelligence/index-candidate-families";
import { indicativeGfaDisplay } from "@/lib/analysis/indicative-gfa-display";
import { computeAssemblyMetrics, scoreAssembly } from "@/lib/analysis/assembly";
import { DEFAULT_ASSUMPTIONS } from "@/lib/analysis/assumptions";
import { lot } from "./helpers";

describe("display score rule", () => {
  it("clamps screening 113 → 100", () => {
    expect(clampScreeningScore(113)).toBe(100);
    expect(resolveDisplayScore({ screeningScore: 113 }).score).toBe(100);
    expect(resolveDisplayScore({ screeningScore: 113 }).provenance).toBe("SCREENING");
  });

  it("keeps screening 72 → 72", () => {
    expect(resolveDisplayScore({ screeningScore: 72 })).toEqual({
      score: 72,
      provenance: "SCREENING",
    });
  });

  it("linked Opportunity score 39 overrides screening 100", () => {
    expect(
      resolveDisplayScore({
        screeningScore: 100,
        opportunityId: "opp-1",
        opportunityScore: 39,
      }),
    ).toEqual({ score: 39, provenance: "DETAILED" });
  });

  it("no linked Opportunity → screening score remains", () => {
    expect(
      resolveDisplayScore({
        screeningScore: 88,
        opportunityId: null,
        opportunityScore: 39,
      }),
    ).toEqual({ score: 88, provenance: "SCREENING" });
  });

  it("score is deterministic for same inputs (Today / Find)", () => {
    const a = resolveDisplayScore({
      screeningScore: 105,
      opportunityId: "opp-bexley",
      opportunityScore: 39,
    });
    const b = resolveDisplayScore({
      screeningScore: 105,
      opportunityId: "opp-bexley",
      opportunityScore: 39,
    });
    expect(a).toEqual(b);
    expect(a.score).toBeLessThanOrEqual(100);
  });
});

describe("index candidate families", () => {
  it("groups subset / overlapping parcel sets; keeps best", () => {
    const members = [
      {
        id: "a",
        canonicalKey: "p1|p2|p3|p4",
        parcelIds: ["p1", "p2", "p3", "p4"],
        score: 90,
        siteAreaSqm: 1834,
        lotCount: 4,
      },
      {
        id: "b",
        canonicalKey: "p1|p2|p3",
        parcelIds: ["p1", "p2", "p3"],
        score: 89,
        siteAreaSqm: 1400,
        lotCount: 3,
      },
      {
        id: "c",
        canonicalKey: "p1|p2",
        parcelIds: ["p1", "p2"],
        score: 85,
        siteAreaSqm: 900,
        lotCount: 2,
      },
      {
        id: "d",
        canonicalKey: "q1|q2",
        parcelIds: ["q1", "q2"],
        score: 80,
        siteAreaSqm: 800,
        lotCount: 2,
      },
    ];
    expect(sameIndexFamily(["p1", "p2"], ["p1", "p2", "p3"])).toBe(true);
    expect(sameIndexFamily(["p1", "p2"], ["q1", "q2"])).toBe(false);

    const families = groupIndexCandidateFamilies(members);
    expect(families).toHaveLength(2);
    expect(families[0]!.best.id).toBe("a");
    expect(families[0]!.alternatives.map((x) => x.id).sort()).toEqual(["b", "c"]);
    expect(families[1]!.best.id).toBe("d");

    const today = pickBestPerIndexFamily(members);
    expect(today.map((m) => m.id)).toEqual(["a", "d"]);
  });
});

describe("indicative GFA when planning missing", () => {
  it("shows planning_required instead of 0 when all lots unmapped", () => {
    expect(
      indicativeGfaDisplay({ lotCount: 2, fsrUnmappedLots: 2, gfa: 0 }),
    ).toEqual({ kind: "planning_required" });
  });

  it("shows numeric GFA when official FSR is mapped (including genuine 0)", () => {
    expect(
      indicativeGfaDisplay({ lotCount: 2, fsrUnmappedLots: 0, gfa: 0 }),
    ).toEqual({ kind: "value", gfaSqm: 0 });
    expect(
      indicativeGfaDisplay({ lotCount: 2, fsrUnmappedLots: 0, gfa: 1200 }),
    ).toEqual({ kind: "value", gfaSqm: 1200 });
  });

  it("scoreAssembly does not treat all-unmapped as FSR 0:1 capacity", () => {
    const lots = [
      lot("A", 0, { fsr: null, zone: "R3", heightM: null }),
      lot("B", 20, { fsr: null, zone: "R3", heightM: null }),
    ];
    const m = computeAssemblyMetrics(lots, {
      ...DEFAULT_ASSUMPTIONS,
      revenueMode: "PER_SQM",
      planningAdjustment: 1,
    });
    expect(m.fsrUnmappedLots).toBe(2);
    expect(m.gfa).toBe(0);
    const s = scoreAssembly(m, DEFAULT_ASSUMPTIONS, { fsrSource: "NO_MAPPED" });
    expect(s.factors.some((f) => f.text.includes("Planning required"))).toBe(true);
    expect(s.factors.some((f) => f.text.includes("missing FSR is not FSR 0:1"))).toBe(true);
    expect(s.score).toBeGreaterThan(0);
    expect(s.score).toBeLessThanOrEqual(100);
  });
});
