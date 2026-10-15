import { describe, expect, it } from "vitest";
import { analyseOpportunity } from "@/lib/analysis/opportunity";
import { DEFAULT_ASSUMPTIONS, parseOpportunityInputs } from "@/lib/analysis/assumptions";
import {
  displayEffectiveFsr,
  displayPlanningMoney,
  effectiveFsrSurfacesAgree,
} from "@/lib/analysis/planning-economics-display";
import { resolvePlanning } from "@/lib/planning/resolve-planning";
import {
  groupIndexCandidateFamilies,
  pickBestPerIndexFamily,
  sameIndexFamily,
} from "@/lib/intelligence/index-candidate-families";
import { estimatePropertyLevelValue } from "@/lib/analysis/property-level-valuation";
import { resolveDisplayScore } from "@/lib/intelligence/display-score";
import { row } from "./helpers";

const A = { ...DEFAULT_ASSUMPTIONS, revenueMode: "UNIT_MIX" as const, planningAdjustment: 0.9 };

function unmappedLots(n: number) {
  const lots = row(n);
  for (const l of lots) {
    l.fsr = null;
    l.fsrStatus = "NO_MAPPED";
    l.fsrControls = [];
    l.zone = "R2";
    l.heightM = 8.5;
    l.areaSqm = 900;
    l.marketValue = 1_200_000;
  }
  return lots;
}

describe("pass-2: Analyse assembly dedupe helpers", () => {
  it("dedupes parcel IDs so 2-lot indexed + accidental add stays 2", () => {
    const ids = ["nsw-cadid:1", "nsw-cadid:2", "nsw-cadid:1"];
    const unique = [...new Set(ids.filter(Boolean))];
    expect(unique).toHaveLength(2);
  });

  it("idempotent add cannot duplicate", () => {
    const add = (a: string[], id: string) => (a.includes(id) ? a : [...a, id]);
    let assembly = ["a", "b"];
    assembly = add(assembly, "b");
    assembly = add(assembly, "b");
    expect(assembly).toEqual(["a", "b"]);
  });
});

describe("pass-2: index planning snapshot fallback", () => {
  it("uses INDEX_SNAPSHOT currentFsr when parcels have no mapped FSR", () => {
    const lots = unmappedLots(2);
    const inputs = parseOpportunityInputs({
      indexPlanningSnapshot: {
        candidateId: "cand-1",
        canonicalKey: "nsw-cadid:1|nsw-cadid:2",
        zone: "R2",
        currentFsr: 0.7,
        proposedFsr: null,
        proposedHeightM: null,
        source: "SITE_CANDIDATE_INDEX",
        provenance: "STORED_OFFICIAL_NSW_PLANNING",
        indexedAt: "2026-10-01T00:00:00.000Z",
      },
    });
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
    expect(planning.effectiveControls.fsrSource).toBe("INDEX_SNAPSHOT");
    expect(planning.effectiveControls.yieldStatus).toBe("CALCULABLE");
    expect(planning.effectiveControls.effectiveFsr).toBe(0.7);
    expect(planning.effectiveControls.source).toBe("STORED INDEX EVIDENCE");
    expect(planning.effectiveControls.baseFsr).toBe(0.7);

    const analysis = analyseOpportunity(lots, A, inputs);
    expect(analysis.feasibilityCalculable).toBe(true);
    expect(analysis.planningSnapshot.effectiveControls.effectiveFsr).toBe(0.7);
    expect(analysis.calculation.effectiveFsr).toBe(0.7);
    expect(analysis.base.feasibility.grv).toBeGreaterThan(0);
    expect(analysis.maxPayableToOwners).toBeGreaterThan(0);
  });

  it("does not invent 0.0:1 / $0 when planning truly missing", () => {
    const lots = unmappedLots(2);
    const inputs = parseOpportunityInputs({});
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
    expect(planning.effectiveControls.fsrSource).toBe("NO_MAPPED");
    expect(planning.effectiveControls.effectiveFsr).toBeNull();

    const analysis = analyseOpportunity(lots, A, inputs);
    expect(analysis.feasibilityCalculable).toBe(false);

    const eff = displayEffectiveFsr(
      analysis.planningSnapshot.effectiveControls.effectiveFsr,
      analysis.feasibilityCalculable,
    );
    const hdr = analysis.calculation.effectiveFsr != null ? `${analysis.calculation.effectiveFsr.toFixed(2)}:1` : "—";
    const body = eff;
    expect(hdr).toBe("—");
    expect(body).toBe("—");
    expect(effectiveFsrSurfacesAgree([hdr, body, "—"])).toBe(true);
    expect(displayPlanningMoney(analysis.base.feasibility.grv, analysis.feasibilityCalculable)).toBe("—");
    expect(displayPlanningMoney(analysis.maxPayableToOwners, analysis.feasibilityCalculable)).toBe("—");
    // Engine may still hold numeric 0 internally — UI helpers must not render them as decisions.
    expect(analysis.base.feasibility.grv).toBe(0);
  });

  it("prefers live parcel official FSR over index snapshot", () => {
    const lots = unmappedLots(2);
    lots[0]!.fsr = 0.5;
    lots[0]!.fsrStatus = "MAPPED";
    lots[1]!.fsr = 0.5;
    lots[1]!.fsrStatus = "MAPPED";
    const inputs = parseOpportunityInputs({
      indexPlanningSnapshot: {
        candidateId: "cand-1",
        canonicalKey: "a|b",
        currentFsr: 0.9,
        source: "SITE_CANDIDATE_INDEX",
        provenance: "STORED_OFFICIAL_NSW_PLANNING",
      },
    });
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
    expect(planning.effectiveControls.fsrSource).toBe("OFFICIAL");
    expect(planning.effectiveControls.effectiveFsr).toBeCloseTo(0.5, 5);
  });
});

describe("pass-2: one Effective FSR across surfaces", () => {
  it("header / overview / planning / yield / feasibility agree on INDEX 0.70:1", () => {
    const lots = unmappedLots(2);
    const inputs = parseOpportunityInputs({
      indexPlanningSnapshot: {
        candidateId: "c",
        canonicalKey: "x|y",
        currentFsr: 0.7,
        source: "SITE_CANDIDATE_INDEX",
        provenance: "STORED_OFFICIAL_NSW_PLANNING",
      },
    });
    const analysis = analyseOpportunity(lots, A, inputs);
    const canonical = analysis.planningSnapshot.effectiveControls.effectiveFsr;
    expect(canonical).toBe(0.7);
    const surfaces = [
      displayEffectiveFsr(canonical, analysis.feasibilityCalculable),
      displayEffectiveFsr(analysis.calculation.effectiveFsr, analysis.feasibilityCalculable),
      displayEffectiveFsr(analysis.planningSnapshot.effectiveControls.effectiveFsr, true),
    ];
    expect(effectiveFsrSurfacesAgree(surfaces)).toBe(true);
    expect(surfaces[0]).toMatch(/^0\.7/);
  });
});

describe("pass-2: Today family connected components", () => {
  it("collapses transitive assembly variants into one family", () => {
    // A ⊂ B; B overlaps C (Jaccard 0.6); A ≉ C — greedy seed absorbs B then leaves C.
    const members = [
      {
        id: "a",
        canonicalKey: "p1|p2",
        parcelIds: ["p1", "p2"],
        score: 90,
        siteAreaSqm: 900,
        lotCount: 2,
      },
      {
        id: "b",
        canonicalKey: "p1|p2|p3|p4",
        parcelIds: ["p1", "p2", "p3", "p4"],
        score: 80,
        siteAreaSqm: 1600,
        lotCount: 4,
      },
      {
        id: "c",
        canonicalKey: "p2|p3|p4|p5",
        parcelIds: ["p2", "p3", "p4", "p5"],
        score: 70,
        siteAreaSqm: 1400,
        lotCount: 4,
      },
      {
        id: "d",
        canonicalKey: "q1|q2",
        parcelIds: ["q1", "q2"],
        score: 85,
        siteAreaSqm: 900,
        lotCount: 2,
      },
    ];
    expect(sameIndexFamily(members[0]!.parcelIds, members[1]!.parcelIds)).toBe(true); // subset
    expect(sameIndexFamily(members[1]!.parcelIds, members[2]!.parcelIds)).toBe(true); // 3/5 = 0.6
    expect(sameIndexFamily(members[0]!.parcelIds, members[2]!.parcelIds)).toBe(false); // 1/5 = 0.2
    const families = groupIndexCandidateFamilies(members);
    expect(families).toHaveLength(2);
    const familyA = families.find((f) => f.best.id === "a" || f.alternatives.some((x) => x.id === "a"));
    expect(familyA).toBeTruthy();
    const ids = [familyA!.best.id, ...familyA!.alternatives.map((x) => x.id)].sort();
    expect(ids).toEqual(["a", "b", "c"]);
    const today = pickBestPerIndexFamily(members);
    expect(today.map((m) => m.id).sort()).toEqual(["a", "d"]);
  });

  it("leaves genuinely disjoint parcel sets separate", () => {
    const members = [
      {
        id: "a",
        canonicalKey: "p1|p2",
        parcelIds: ["p1", "p2"],
        score: 90,
        siteAreaSqm: 1000,
        lotCount: 2,
      },
      {
        id: "b",
        canonicalKey: "q1|q2",
        parcelIds: ["q1", "q2"],
        score: 80,
        siteAreaSqm: 1000,
        lotCount: 2,
      },
    ];
    expect(groupIndexCandidateFamilies(members)).toHaveLength(2);
  });
});

describe("pass-2: numberOfComps semantics", () => {
  it("LOCAL_LAND_RATE does not use uncapped rateSales.length as numberOfComps", () => {
    // Large site (≥1000 sqm) + many house-band sales → LOCAL_LAND_RATE path.
    // numberOfComps must be the direct comparable set size (capped), not 399.
    const sales = Array.from({ length: 399 }, (_, i) => ({
      id: `sale-${i}`,
      address: `${i} Rate St`,
      salePrice: 1_200_000 + (i % 50) * 10_000,
      saleDate: "2024-06-01",
      saleDateMs: Date.parse("2024-06-01"),
      landAreaSqm: 450,
      distanceM: 100 + (i % 40) * 5,
      strata: false,
      suburb: "Ashfield",
      source: "NSW",
    }));
    const result = estimatePropertyLevelValue({
      areaSqm: 1600,
      suburb: "Ashfield",
      sales,
      isStrata: false,
    });
    expect(result.methodDetail).toBe("LOCAL_LAND_RATE");
    expect(result.numberOfComps).toBeLessThanOrEqual(10);
    expect(result.numberOfComps).not.toBe(399);
    expect(result.note).toMatch(/rate sample 399/);
  });
});

describe("pass-2: DETAILED score after link", () => {
  it("prefers DETAILED when opportunityId + score present", () => {
    const d = resolveDisplayScore({
      screeningScore: 53,
      opportunityId: "opp-1",
      opportunityScore: 34,
    });
    expect(d.provenance).toBe("DETAILED");
    expect(d.score).toBe(34);
  });

  it("stays SCREENING without linked opportunity", () => {
    const d = resolveDisplayScore({ screeningScore: 53, opportunityId: null, opportunityScore: 34 });
    expect(d.provenance).toBe("SCREENING");
    expect(d.score).toBe(53);
  });
});

describe("pass-2: incomplete valuation still allows GRV when planning calculable", () => {
  it("GRV/max payable calculate; existing/headroom stay null when a lot has NO_VALUE", () => {
    const lots = unmappedLots(2);
    lots[0]!.marketValue = 1_500_000;
    lots[1]!.marketValue = null;
    const inputs = parseOpportunityInputs({
      indexPlanningSnapshot: {
        candidateId: "c",
        canonicalKey: "x|y",
        currentFsr: 0.7,
        source: "SITE_CANDIDATE_INDEX",
        provenance: "STORED_OFFICIAL_NSW_PLANNING",
      },
    });
    const analysis = analyseOpportunity(lots, A, inputs);
    expect(analysis.feasibilityCalculable).toBe(true);
    expect(analysis.base.feasibility.grv).toBeGreaterThan(0);
    expect(analysis.maxPayableToOwners).toBeGreaterThan(0);
    expect(analysis.marketValueComplete).toBe(false);
    expect(analysis.combinedExistingValue).toBeNull();
    expect(analysis.acquisitionHeadroom).toBeNull();
  });
});
