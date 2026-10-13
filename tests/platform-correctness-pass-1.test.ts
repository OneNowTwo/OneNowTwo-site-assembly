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
import {
  resolveLinkedOpportunityScore,
  type LinkedOpportunityScoreIndex,
} from "@/lib/intelligence/linked-opportunity-scores";
import {
  stableBackfillPageIds,
  stableBackfillPageSequence,
} from "@/lib/intelligence/backfill-pagination";
import { failsMaxOwnersFilter } from "@/lib/find/find-sites";
import { lotCountPenalty } from "@/lib/analysis/area-scan";
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

  it("defensively clamps DETAILED scores to 0–100", () => {
    expect(
      resolveDisplayScore({
        screeningScore: 50,
        opportunityId: "opp-hi",
        opportunityScore: 104,
      }),
    ).toEqual({ score: 100, provenance: "DETAILED" });
    expect(
      resolveDisplayScore({
        screeningScore: 50,
        opportunityId: "opp-lo",
        opportunityScore: -4,
      }),
    ).toEqual({ score: 0, provenance: "DETAILED" });
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

describe("exact opportunityId wins over canonical fallback", () => {
  it("uses linked Opportunity A even when B has a higher score on the same key", () => {
    const index: LinkedOpportunityScoreIndex = {
      byId: new Map([
        ["opp-a", { opportunityId: "opp-a", score: 39 }],
        ["opp-b", { opportunityId: "opp-b", score: 90 }],
      ]),
      byCanonicalKey: new Map([
        // Canonical fallback would prefer the higher score (B).
        ["p1|p2", { opportunityId: "opp-b", score: 90 }],
      ]),
    };
    const linked = resolveLinkedOpportunityScore("opp-a", "p1|p2", index);
    expect(linked).toEqual({ opportunityId: "opp-a", score: 39 });
    const display = resolveDisplayScore({
      screeningScore: 105,
      opportunityId: linked!.opportunityId,
      opportunityScore: linked!.score,
    });
    expect(display).toEqual({ score: 39, provenance: "DETAILED" });
  });

  it("does not swap to canonical B when opportunityId A is missing from ACTIVE scored set", () => {
    const index: LinkedOpportunityScoreIndex = {
      byId: new Map([["opp-b", { opportunityId: "opp-b", score: 90 }]]),
      byCanonicalKey: new Map([["p1|p2", { opportunityId: "opp-b", score: 90 }]]),
    };
    expect(resolveLinkedOpportunityScore("opp-a", "p1|p2", index)).toBeNull();
  });

  it("falls back to canonical only when opportunityId is absent", () => {
    const index: LinkedOpportunityScoreIndex = {
      byId: new Map([["opp-b", { opportunityId: "opp-b", score: 90 }]]),
      byCanonicalKey: new Map([["p1|p2", { opportunityId: "opp-b", score: 90 }]]),
    };
    expect(resolveLinkedOpportunityScore(null, "p1|p2", index)).toEqual({
      opportunityId: "opp-b",
      score: 90,
    });
  });
});

describe("maxOwners hard filter", () => {
  it("rejects unknown owners when maxOwners is set", () => {
    expect(failsMaxOwnersFilter(2, null)).toBe(true);
    expect(failsMaxOwnersFilter(2, undefined)).toBe(true);
  });

  it("rejects known owners above max", () => {
    expect(failsMaxOwnersFilter(2, 3)).toBe(true);
  });

  it("accepts known owners within max", () => {
    expect(failsMaxOwnersFilter(2, 2)).toBe(false);
    expect(failsMaxOwnersFilter(2, 1)).toBe(false);
  });

  it("allows unknown owners when maxOwners is not set", () => {
    expect(failsMaxOwnersFilter(null, null)).toBe(false);
    expect(failsMaxOwnersFilter(undefined, null)).toBe(false);
  });
});

describe("lotCountPenalty is assembly complexity, not ownership", () => {
  it("matches prior lot-count curve without reading owners", () => {
    expect(lotCountPenalty(2)).toBe(0);
    expect(lotCountPenalty(5)).toBe(0.5);
    expect(lotCountPenalty(8)).toBe(1);
  });
});

describe("stable backfill pagination", () => {
  it("successful geometry writes do not change id-ordered page sequence", () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({
      id: `id-${String(i).padStart(3, "0")}`,
      geometry: null as unknown,
      updatedAt: "2026-01-01T00:00:00.000Z",
    }));
    const withoutMutate = stableBackfillPageSequence(rows, 25, false);
    const withMutate = stableBackfillPageSequence(rows, 25, true);
    expect(withMutate).toEqual(withoutMutate);
    expect(withMutate).toHaveLength(3);
    expect(withMutate[0]).toHaveLength(25);
    expect(withMutate[1]).toHaveLength(25);
    expect(withMutate[2]).toHaveLength(10);
    // No overlap / skip across pages
    const flat = withMutate.flat();
    expect(new Set(flat).size).toBe(60);
    expect(flat).toEqual([...rows].map((r) => r.id).sort());
  });

  it("page membership is stable after mutating geometry on page 0", () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({
      id: `c${String(i).padStart(2, "0")}`,
      geometry: null as unknown,
      updatedAt: null as string | null,
    }));
    const page0 = stableBackfillPageIds(rows, 25, 0);
    for (const row of rows) {
      if (page0.includes(row.id)) {
        row.geometry = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
        row.updatedAt = "2026-10-14T00:00:00.000Z";
      }
    }
    expect(stableBackfillPageIds(rows, 25, 0)).toEqual(page0);
    expect(stableBackfillPageIds(rows, 25, 25)).toEqual(
      [...rows].map((r) => r.id).sort().slice(25, 50),
    );
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
