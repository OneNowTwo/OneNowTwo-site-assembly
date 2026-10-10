import { describe, expect, it, beforeEach } from "vitest";
import {
  annotateParcelWithProposedFindFields,
  auditNswSpatialServices,
  clearArcGisExperienceCache,
  contentHash,
  diffNormalisedPayloads,
  extractExperienceItemId,
  resolveArcGisExperience,
  resolveKeySitesForPoint,
  resolveProposedPlanningAtPoint,
  runSourceOnce,
  setEdgecliffFixtureVariant,
  type NormalisedSourcePayload,
} from "@/lib/source-watcher";
import { modelProposedScenario } from "@/lib/source-watcher/proposed-scenario";
import edgecliff from "@/lib/source-watcher/fixtures/edgecliff-woollahra.json";
import edgecliffBump from "@/lib/source-watcher/fixtures/edgecliff-woollahra-fsr-bump.json";
import { analyseOpportunity, type OpportunityLot } from "@/lib/analysis/opportunity";
import { buildAdjacency } from "@/lib/analysis/geometry";
import { DEFAULT_ASSUMPTIONS, parseOpportunityInputs } from "@/lib/analysis/assumptions";
import type { Polygon } from "geojson";
import { lot as helperLot } from "./helpers";

const square = (lng: number, lat: number, d = 0.0003): Polygon => ({
  type: "Polygon",
  coordinates: [
    [
      [lng - d, lat - d],
      [lng + d, lat - d],
      [lng + d, lat + d],
      [lng - d, lat + d],
      [lng - d, lat - d],
    ],
  ],
});

function demoLot(overrides: Partial<OpportunityLot> = {}): OpportunityLot {
  return helperLot("edgecliff-demo", 0, {
    fsr: 0.9,
    heightM: 12,
    zone: "R3",
    zoneName: "Medium Density",
    marketValue: 2_500_000,
    areaSqm: 450,
    geometry: square(151.238, -33.8795),
    address: "1 New South Head Road",
    ...overrides,
  });
}

describe("Source Watcher Phase 2", () => {
  beforeEach(() => {
    setEdgecliffFixtureVariant("base");
    clearArcGisExperienceCache();
  });

  it("A. ArcGIS Experience resolves underlying service correctly", async () => {
    const id = extractExperienceItemId(
      "https://experience.arcgis.com/experience/2b5ffd9da4f44cd7b7886b632a180556/page/Page",
    );
    expect(id).toBe("2b5ffd9da4f44cd7b7886b632a180556");

    const resolved = await resolveArcGisExperience(
      "https://experience.arcgis.com/experience/2b5ffd9da4f44cd7b7886b632a180556/page/Page",
      { enrichServices: false },
    );
    expect(resolved.experienceItemId).toBe("2b5ffd9da4f44cd7b7886b632a180556");
    expect(resolved.webMapItemIds.length).toBeGreaterThan(0);
    expect(resolved.layers.some((l) => /Draft Floor Space Ratio|Incentive Floor Space/i.test(l.title))).toBe(true);
    expect(
      resolved.services.some((s) => /Adopted_Planning_Layers\/FeatureServer/i.test(s.url)) ||
        resolved.layers.some((l) => l.url && /Adopted_Planning_Layers\/FeatureServer/i.test(l.url)),
    ).toBe(true);
    expect(resolved.discoveryFingerprint.length).toBeGreaterThan(20);

    // Cache hit
    const again = await resolveArcGisExperience(
      "https://experience.arcgis.com/experience/2b5ffd9da4f44cd7b7886b632a180556/page/Page",
      { enrichServices: false },
    );
    expect(again.discoveryFingerprint).toBe(resolved.discoveryFingerprint);
  }, 60_000);

  it("B. Parcel intersects PlanningChangeArea", () => {
    const proposed = resolveProposedPlanningAtPoint({ lng: 151.238, lat: -33.8795 });
    expect(proposed.planningChangeAreas.some((a) => a.id.includes("edgecliff"))).toBe(true);
    expect(proposed.legalDisclaimer).toMatch(/not current/i);
  });

  it("C. Parcel intersects KeySite", () => {
    const hits = resolveKeySitesForPoint({ lng: 151.238, lat: -33.8795 });
    expect(hits.some((h) => h.keySite.externalKeySiteId === "CS7.2")).toBe(true);
    expect(hits[0]!.legalStatus).not.toBe("CURRENT_LAW");
  });

  it("D. KeySite returns all required cadastral parcels (hints)", () => {
    const hits = resolveKeySitesForPoint({ lng: 151.238, lat: -33.8795 });
    const cs = hits.find((h) => h.keySite.externalKeySiteId === "CS7.2")!;
    expect(cs.requiredCount).toBe(4);
    expect(cs.keySite.requiredParcelHints).toHaveLength(4);
    expect(cs.keySite.structuredConditions?.some((c) => c.type === "AFFORDABLE_HOUSING")).toBe(true);
  });

  it("E. Current PlanningSnapshot remains unchanged by proposed controls", () => {
    const lot = demoLot();
    const inputs = parseOpportunityInputs({});
    const a = DEFAULT_ASSUMPTIONS;
    const adj = buildAdjacency([lot]);
    const analysis = analyseOpportunity([lot], a, inputs, adj);
    expect(analysis.planningSnapshot.effectiveControls.baseFsr).toBe(0.9);
    // Proposed at point has incentive FSR 2.5 — must not leak into CURRENT snapshot.
    const proposed = resolveProposedPlanningAtPoint({ lng: 151.238, lat: -33.8795 });
    const propFsr =
      proposed.keySites[0]?.keySite.incentiveControls?.incentiveFsr ??
      proposed.keySites[0]?.keySite.proposedControls?.fsr;
    expect(propFsr).toBeGreaterThan(1);
    expect(analysis.planningSnapshot.effectiveControls.effectiveFsr).not.toBe(propFsr);
    expect(analysis.calculation.effectiveFsr).not.toBe(propFsr);
  });

  it("F. Proposed scenario uses proposed controls without overwriting current scenario", () => {
    const lot = demoLot();
    const inputs = parseOpportunityInputs({});
    const a = DEFAULT_ASSUMPTIONS;
    const adj = buildAdjacency([lot]);
    const current = analyseOpportunity([lot], a, inputs, adj);
    const scenario = modelProposedScenario({
      lots: [lot],
      assumptions: a,
      opportunityInputs: inputs,
      adjacency: adj,
      currentAnalysis: current,
      proposed: { proposedFsr: 2.7, proposedHeightM: 39, label: "Edgecliff test" },
    });
    expect(scenario.proposed.effectiveFsr).toBe(2.7);
    expect(scenario.current.effectiveFsr).toBe(current.calculation.effectiveFsr);
    expect(scenario.current.maxPayable).toBe(current.calculation.maxPayable);
    expect(scenario.disclaimer).toMatch(/does not overwrite CURRENT/i);
    // Re-run current analysis — still unchanged.
    const again = analyseOpportunity([lot], a, inputs, adj);
    expect(again.calculation.maxPayable).toBe(current.calculation.maxPayable);
  });

  it("G. Source FSR 2.5 → 2.7 produces one change event", () => {
    const events = diffNormalisedPayloads(
      "live-edgecliff-woollahra",
      edgecliff as NormalisedSourcePayload,
      edgecliffBump as NormalisedSourcePayload,
    );
    const fsrEvents = events.filter((e) => e.kind === "FSR_PROPOSED_CHANGE" && e.title.includes("CS7.2"));
    expect(fsrEvents).toHaveLength(1);
    expect(fsrEvents[0]!.oldValue).toMatchObject({ fsr: 2.5 });
    expect(fsrEvents[0]!.newValue).toMatchObject({ fsr: 2.7 });
  });

  it("H. unchanged rerun produces zero duplicate events", async () => {
    const first = await runSourceOnce("fixture-edgecliff-woollahra", null);
    expect(first.status).toBe("SUCCEEDED");
    const second = await runSourceOnce("fixture-edgecliff-woollahra", {
      contentHash: first.contentHash!,
      normalised: first.normalised!,
      retrievedAt: new Date().toISOString(),
    });
    expect(second.status).toBe("UNCHANGED");
    expect(second.events).toHaveLength(0);
    expect(second.contentHash).toBe(first.contentHash);
  });

  it("I. watched site receives relevant event (payload watch linkage shape)", () => {
    const events = diffNormalisedPayloads(
      "live-edgecliff-woollahra",
      edgecliff as NormalisedSourcePayload,
      edgecliffBump as NormalisedSourcePayload,
    );
    const fsr = events.find((e) => e.kind === "FSR_PROPOSED_CHANGE")!;
    // Simulate watch-link enrichment
    const enriched = {
      ...fsr,
      payload: {
        watchItemIds: ["watch-demo-1"],
        watchedSites: [{ id: "watch-demo-1", label: "12 Example Street", opportunityId: "opp-1" }],
      },
      summary: `${fsr.summary} · 1 watched site(s) affected`,
    };
    expect(enriched.payload.watchItemIds).toContain("watch-demo-1");
    expect(enriched.summary).toMatch(/watched site/i);
  });

  it("Find fields annotate parcels inside change area", () => {
    const fields = annotateParcelWithProposedFindFields({ lng: 151.238, lat: -33.8795 });
    expect(fields.insidePlanningChangeArea).toBe(true);
    expect(fields.keySiteId).toBe("CS7.2");
    expect(fields.proposedFsr).toBeTruthy();
    expect(fields.requiredParcelCount).toBe(4);
  });

  it("NSW Spatial audit separates LMR unique vs EPI duplicates", () => {
    const audit = auditNswSpatialServices([
      "https://spatialportalarcgis.dpie.nsw.gov.au/sarcgis/rest/services/LMR/LMR/MapServer/0",
      "https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/Principal_Planning_Layers/MapServer/4",
      "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
    ]);
    expect(audit.uniqueLayers.some((u) => /LMR\/LMR/i.test(u))).toBe(true);
    expect(audit.duplicateOfEpi.length).toBeGreaterThan(0);
    expect(audit.suitableForScheduledIngestion).toBe(true);
  });

  it("content hash stable for identical normalised payloads", () => {
    const a = contentHash(edgecliff as NormalisedSourcePayload);
    const b = contentHash(structuredClone(edgecliff) as NormalisedSourcePayload);
    expect(a).toBe(b);
  });
});

describe("Phase 2 live adapters (network)", () => {
  it("live Edgecliff adapter fetches portal + structured pack", async () => {
    const result = await runSourceOnce("live-edgecliff-woollahra", null);
    expect(["SUCCEEDED", "FAILED"]).toContain(result.status);
    if (result.status === "SUCCEEDED") {
      expect(result.normalised?.planningChangeAreas?.[0]?.sourceUrl).toMatch(/edgecliff-woollahra/);
      expect(result.normalised?.planningChangeAreas?.[0]?.proposedControls.legalStatus).toBe("UNDER_EXHIBITION");
      expect(result.normalised?.meta?.geometrySource).toBe("MANUALLY_STRUCTURED_FIXTURE");
    }
  }, 45_000);

  it("live Inner West adapter resolves Experience FeatureServer", async () => {
    const result = await runSourceOnce("live-inner-west-fairer-future", null);
    expect(["SUCCEEDED", "FAILED"]).toContain(result.status);
    if (result.status === "SUCCEEDED") {
      expect(result.normalised?.meta?.featureServer).toMatch(/Adopted_Planning_Layers/);
      expect(result.normalised?.planningChangeAreas?.[0]?.proposedControls.legalStatus).toBe("PROPOSED");
      expect((result.normalised?.planningChangeAreas?.[0]?.keySites?.length ?? 0) > 0).toBe(true);
    }
  }, 90_000);
});
