import { describe, expect, it, vi, afterEach } from "vitest";
import { modelInfillAffordableHousing, affordableHousingScenarios } from "@/lib/analysis/affordable-housing";
import { matchPlanningChanges, pointInBBox, CURATED_PLANNING_CHANGES } from "@/lib/planning/change-registry";
import { getParcelPlanningContext, resolvePendingPlanningChanges } from "@/lib/planning/planning-rules-service";
import type { ParcelData } from "@/lib/types";
import type { NominatedCentre } from "@/lib/data-sources/housing-sepp-lmr";
import * as nswPp from "@/lib/data-sources/nsw-planning-proposals";

describe("affordable housing pathway", () => {
  it("models 10% and 15% AH bonuses without inventing stacking certainty", () => {
    const s10 = modelInfillAffordableHousing({
      baseFsr: 0.8,
      baseHeightM: 9.5,
      siteAreaSqm: 2000,
      affordableShare: 0.1,
      stackingConfirmed: false,
    });
    expect(s10.bonusPct).toBe(0.2);
    expect(s10.effectiveFsr).toBeCloseTo(0.96, 5);
    expect(s10.certainty).toBe("REQUIRES_PLANNING_CONFIRMATION");
    expect(s10.policyStatus).toBe("CURRENT_POLICY_SUBJECT_TO_ELIGIBILITY");

    const s15 = modelInfillAffordableHousing({
      baseFsr: 0.8,
      baseHeightM: 9.5,
      siteAreaSqm: 2000,
      affordableShare: 0.15,
      stackingConfirmed: true,
    });
    expect(s15.bonusPct).toBe(0.3);
    expect(s15.effectiveFsr).toBeCloseTo(1.04, 5);
    expect(s15.certainty).toBe("CANDIDATE");
  });

  it("returns both scenario shares", () => {
    const all = affordableHousingScenarios({ baseFsr: 0.5, baseHeightM: 8.5, siteAreaSqm: 1000 });
    expect(all).toHaveLength(2);
  });
});

describe("planning change registry", () => {
  it("never treats Mosman Masterplan as CURRENT law", () => {
    const mosman = CURATED_PLANNING_CHANGES.find((c) => c.id.includes("mosman"));
    expect(mosman).toBeTruthy();
    expect(mosman!.status).toBe("GATEWAY");
    expect(["CURRENT", "SUPERSEDED"]).not.toContain(mosman!.status);
  });

  it("matches Mosman bbox as pending GATEWAY", () => {
    const hits = matchPlanningChanges({ lng: 151.24, lat: -33.84, lga: "MOSMAN" });
    expect(hits.some((h) => h.planningProposalNumber === "PP-2026-1946")).toBe(true);
    expect(hits.every((h) => h.status !== "CURRENT")).toBe(true);
  });

  it("matches Edgecliff–Woollahra as EXHIBITED / not in force", () => {
    const hits = matchPlanningChanges({ lng: 151.236, lat: -33.879, lga: "WOOLLAHRA", suburb: "Edgecliff" });
    expect(hits.some((h) => h.id.includes("woollahra"))).toBe(true);
    const w = hits.find((h) => h.id.includes("woollahra"))!;
    expect(w.status).toBe("EXHIBITED");
    expect(w.proposedControls?.machineReadable).toBe(false);
  });

  it("pointInBBox works", () => {
    expect(pointInBBox(151.24, -33.84, { west: 151.22, south: -33.88, east: 151.27, north: -33.8 })).toBe(true);
    expect(pointInBBox(151.0, -33.84, { west: 151.22, south: -33.88, east: 151.27, north: -33.8 })).toBe(false);
  });
});

describe("statewide pending merge", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("merges live NSW PP layers outside Edgecliff/Mosman and never marks CURRENT", async () => {
    vi.spyOn(nswPp, "fetchPlanningProposalsNear").mockResolvedValue([
      {
        id: "nsw:pp-layer:PP-2024-2710",
        title: "PP-2024-2710 — PARRAMATTA",
        description: "test",
        status: "PROPOSED",
        instrumentName: "Parramatta LEP",
        planningProposalNumber: "PP-2024-2710",
        authority: "PARRAMATTA / NSW DPHI",
        sourceUrl: "https://www.planningportal.nsw.gov.au/",
        sourceAuthority: "NSW Planning Portal",
        lastChecked: new Date().toISOString(),
        lgas: ["PARRAMATTA"],
        proposedControls: { machineReadable: true, fsr: 2.0, notes: "NOT CURRENT LAW" },
      },
    ]);
    const hits = await resolvePendingPlanningChanges({ lng: 151.01, lat: -33.815, lga: "PARRAMATTA" });
    expect(hits.some((h) => h.planningProposalNumber === "PP-2024-2710")).toBe(true);
    expect(hits.every((h) => h.status !== "CURRENT")).toBe(true);
  });

  it("filters SUPERSEDED live rows and prefers curated on same PP number", async () => {
    vi.spyOn(nswPp, "fetchPlanningProposalsNear").mockResolvedValue([
      {
        id: "nsw:pp-layer:PP-2026-1946",
        title: "live duplicate",
        description: "should lose to curated",
        status: "PROPOSED",
        instrumentName: "x",
        planningProposalNumber: "PP-2026-1946",
        authority: "x",
        sourceUrl: "https://example.com",
        sourceAuthority: "x",
        lastChecked: new Date().toISOString(),
      },
      {
        id: "nsw:pp-layer:OLD",
        title: "superseded",
        description: "skip",
        status: "SUPERSEDED",
        instrumentName: "x",
        planningProposalNumber: "PP-OLD",
        authority: "x",
        sourceUrl: "https://example.com",
        sourceAuthority: "x",
        lastChecked: new Date().toISOString(),
      },
    ]);
    const hits = await resolvePendingPlanningChanges({ lng: 151.24, lat: -33.84, lga: "MOSMAN" });
    const mosman = hits.find((h) => h.planningProposalNumber === "PP-2026-1946");
    expect(mosman?.status).toBe("GATEWAY");
    expect(mosman?.title).toMatch(/Mosman Masterplan/i);
    expect(hits.some((h) => h.status === "SUPERSEDED")).toBe(false);
  });
});

describe("parcel planning context separation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps proposed changes out of current statutory FSR", async () => {
    vi.spyOn(nswPp, "fetchPlanningProposalsNear").mockResolvedValue([]);
    const parcel: ParcelData = {
      externalParcelId: "nsw-cadid:mosman-1",
      source: "LIVE_NSW",
      lot: "1",
      section: null,
      dp: "DP1",
      lotIdString: "1//DP1",
      address: "1 Test Street",
      suburb: "Mosman",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [151.24, -33.84],
            [151.2402, -33.84],
            [151.2402, -33.8398],
            [151.24, -33.8398],
            [151.24, -33.84],
          ],
        ],
      },
      centroid: [151.24, -33.84],
      areaSqm: 500,
      isStrata: false,
      planning: {
        zone: "R2",
        zoneName: "Low Density",
        fsr: 0.5,
        fsrStatus: "MAPPED",
        fsrControls: [],
        heightM: 8.5,
        minLotSizeSqm: 450,
        heritage: "None mapped",
        planningInstrument: "Mosman LEP 2012",
        lga: "MOSMAN",
        sources: {},
      },
      planningStatus: "ok",
      retrievedAt: "2026-10-03T00:00:00.000Z",
    };
    const centres: NominatedCentre[] = [];
    const ctx = await getParcelPlanningContext({ parcel, centres });
    expect(ctx.currentStatutory.fsr).toBe(0.5);
    expect(ctx.pendingChanges.some((c) => c.status === "GATEWAY")).toBe(true);
    // Proposed must not overwrite statutory
    for (const c of ctx.pendingChanges) {
      expect(c.status).not.toBe("CURRENT");
    }
    expect(ctx.safetyNote).toMatch(/never alter max payable/i);
  });
});
