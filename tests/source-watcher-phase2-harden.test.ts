import { describe, expect, it, beforeEach } from "vitest";
import {
  clearArcGisExperienceCache,
  contentHash,
  diffNormalisedPayloads,
  intersectionAreaSqm,
  setEdgecliffFixtureVariant,
  type NormalisedSourcePayload,
} from "@/lib/source-watcher";
import { modelProposedScenario } from "@/lib/source-watcher/proposed-scenario";
import {
  edgecliffLiveAdapter,
  setEdgecliffLiveBumpVariant,
  structuredPackDocumentHash,
} from "@/lib/source-watcher/adapters/edgecliff-live";
import { analyseOpportunity } from "@/lib/analysis/opportunity";
import { buildAdjacency } from "@/lib/analysis/geometry";
import { DEFAULT_ASSUMPTIONS, parseOpportunityInputs } from "@/lib/analysis/assumptions";
import { lot as helperLot } from "./helpers";
import type { Polygon } from "geojson";

const square = (lng: number, lat: number, d = 0.0004): Polygon => ({
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

describe("Phase 2 pre-merge hardening", () => {
  beforeEach(() => {
    setEdgecliffFixtureVariant("base");
    setEdgecliffLiveBumpVariant(false);
    clearArcGisExperienceCache();
    edgecliffLiveAdapter.previousMeta = null;
  });

  it("polygon intersection is material and ignores non-overlap", () => {
    const a = square(151.238, -33.8795, 0.001);
    const b = square(151.238, -33.8795, 0.0005);
    const far = square(151.25, -33.89, 0.0003);
    expect(intersectionAreaSqm(a, b)).toBeGreaterThan(1);
    expect(intersectionAreaSqm(a, far)).toBe(0);
  });

  it("Edgecliff structured pack exposes document hash + provenance (not live vector)", async () => {
    const result = await edgecliffLiveAdapter.fetch();
    expect(result.normalised).toBeTruthy();
    const meta = result.normalised.meta as Record<string, unknown>;
    expect(meta.geometrySource).toBe("MANUALLY_STRUCTURED_FIXTURE");
    expect(meta.vectorServiceAvailable).toBe(false);
    expect(typeof meta.documentHash).toBe("string");
    expect((meta.provenance as { portal?: string }).portal).toBe("LIVE");
    expect((meta.provenance as { controlsAndGeometry?: string }).controlsAndGeometry).toBe(
      "MANUALLY_STRUCTURED_FIXTURE",
    );
    expect(meta.structuredDataStatus).toBe("CURRENT_STRUCTURED");
    expect(String(meta.documentHash)).toHaveLength(32);
    // documentHash is computed from the structured pack before live notes are attached.
    const { default: edgecliffFixture } = await import(
      "@/lib/source-watcher/fixtures/edgecliff-woollahra.json"
    );
    expect(structuredPackDocumentHash(edgecliffFixture as NormalisedSourcePayload)).toBe(meta.documentHash);
  }, 45_000);

  it("portal body hash change with same structured pack → SOURCE_DOCUMENT_CHANGED + NEEDS_RE_EXTRACTION", async () => {
    const first = await edgecliffLiveAdapter.fetch();
    const meta1 = first.normalised.meta as {
      documentHash: string;
      livePortal: { bodyHash: string };
    };
    // Simulate previous snapshot with different portal hash, same document hash
    const previous: NormalisedSourcePayload = {
      ...first.normalised,
      meta: {
        ...first.normalised.meta,
        livePortal: { ...(meta1.livePortal as object), bodyHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
        documentHash: meta1.documentHash,
      },
    };
    edgecliffLiveAdapter.previousMeta = {
      documentHash: meta1.documentHash,
      portalBodyHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    };
    const second = await edgecliffLiveAdapter.fetch();
    expect(second.normalised.meta?.needsReExtraction).toBe(true);
    expect(second.normalised.meta?.structuredDataStatus).toBe("NEEDS_RE_EXTRACTION");

    const events = diffNormalisedPayloads("live-edgecliff-woollahra", previous, second.normalised);
    expect(events.some((e) => e.kind === "SOURCE_DOCUMENT_CHANGED")).toBe(true);
    expect(events.find((e) => e.kind === "SOURCE_DOCUMENT_CHANGED")?.newValue).toMatchObject({
      needsReExtraction: true,
    });
  }, 60_000);

  it("proposed scenario recalculates GFA/GRV/cost/dwellings/score not just FSR display", () => {
    const lot = helperLot("harden", 0, {
      fsr: 0.9,
      heightM: 12,
      marketValue: 2_500_000,
      areaSqm: 500,
      geometry: square(151.238, -33.8795),
    });
    const inputs = parseOpportunityInputs({});
    const adj = buildAdjacency([lot]);
    const current = analyseOpportunity([lot], DEFAULT_ASSUMPTIONS, inputs, adj);
    const scenario = modelProposedScenario({
      lots: [lot],
      assumptions: DEFAULT_ASSUMPTIONS,
      opportunityInputs: inputs,
      adjacency: adj,
      currentAnalysis: current,
      proposed: { proposedFsr: 2.7, proposedHeightM: 39 },
    });
    expect(scenario.proposedOutputs.theoreticalGfa).toBeGreaterThan(scenario.currentOutputs.theoreticalGfa);
    expect(scenario.proposedOutputs.grv).not.toBe(scenario.currentOutputs.grv);
    expect(scenario.proposedOutputs.totalCost).not.toBe(scenario.currentOutputs.totalCost);
    expect(scenario.proposedOutputs.dwellings).toBeGreaterThanOrEqual(scenario.currentOutputs.dwellings);
    expect(scenario.proposed.maxPayable).not.toBe(scenario.current.maxPayable);
    expect(scenario.uplift.theoreticalGfa).toBeGreaterThan(0);
    // CURRENT analysis unchanged
    const again = analyseOpportunity([lot], DEFAULT_ASSUMPTIONS, inputs, adj);
    expect(again.calculation.maxPayable).toBe(current.calculation.maxPayable);
  });

  it("document hash is stable for identical structured controls", async () => {
    const a = await edgecliffLiveAdapter.fetch();
    const b = await edgecliffLiveAdapter.fetch();
    expect(a.normalised.meta?.documentHash).toBe(b.normalised.meta?.documentHash);
    expect(contentHash({ x: 1 })).toBe(contentHash({ x: 1 }));
  }, 60_000);
});
