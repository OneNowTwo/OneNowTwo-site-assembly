import { describe, expect, it, beforeEach } from "vitest";
import {
  contentHash,
  diffNormalisedPayloads,
  getEdgecliffFixtureVariant,
  resolveKeySitesForPoint,
  resolveProposedPlanningAtPoint,
  runSourceOnce,
  setEdgecliffFixtureVariant,
  type NormalisedSourcePayload,
} from "@/lib/source-watcher";
import edgecliff from "@/lib/source-watcher/fixtures/edgecliff-woollahra.json";
import edgecliffBump from "@/lib/source-watcher/fixtures/edgecliff-woollahra-fsr-bump.json";
import innerWest from "@/lib/source-watcher/fixtures/inner-west-fairer-future.json";

describe("Source Watcher — Edgecliff / Inner West / change engine", () => {
  beforeEach(() => {
    setEdgecliffFixtureVariant("base");
  });

  it("Edgecliff fixture exposes proposed zoning, incentive HOB/FSR, key sites, AH, active frontage", () => {
    const area = (edgecliff as NormalisedSourcePayload).planningChangeAreas![0]!;
    expect(area.status).toBe("UNDER_EXHIBITION");
    expect(area.proposedControls.legalStatus).toBe("UNDER_EXHIBITION");
    expect(area.proposedControls.legalStatus).not.toBe("CURRENT_LAW");
    expect(area.keySites?.length).toBeGreaterThanOrEqual(2);

    const cs = area.keySites!.find((s) => s.externalKeySiteId === "CS7.2")!;
    expect(cs.proposedControls?.zone).toBeTruthy();
    expect(cs.incentiveControls?.incentiveFsr).toBe(2.5);
    expect(cs.incentiveControls?.incentiveHeightM).toBeTruthy();
    expect(cs.proposedControls?.nonResidentialFsr).toBe(1.0);
    expect(cs.proposedControls?.activeStreetFrontage).toBe(true);
    expect(cs.requiredParcelHints?.length).toBe(4);
    expect(cs.incentiveControls?.affordableHousingContributionPct).toBeGreaterThan(0);

    const ed = area.keySites!.find((s) => s.externalKeySiteId === "ED1.2")!;
    expect(ed.conditions?.some((c) => /affordable|community/i.test(c))).toBe(true);
  });

  it("parcel in CS7.2 key site reports assembly requirements without treating as current law", () => {
    // Point inside CS7.2 bbox
    const hit = resolveKeySitesForPoint({ lng: 151.238, lat: -33.8795 });
    const cs = hit.find((h) => h.keySite.externalKeySiteId === "CS7.2");
    expect(cs).toBeTruthy();
    expect(cs!.legalStatus).not.toBe("CURRENT_LAW");
    expect(cs!.requiredCount).toBe(4);
    expect(cs!.status).toBe("UNDER_EXHIBITION");

    const proposed = resolveProposedPlanningAtPoint({ lng: 151.238, lat: -33.8795 });
    expect(proposed.applies.keySite).toBe(true);
    expect(proposed.applies.incentiveFsr).toBe(true);
    expect(proposed.applies.activeStreetFrontage).toBe(true);
    expect(proposed.legalDisclaimer).toMatch(/not current/i);
  });

  it("Inner West Fairer Future fixture is proposed / draft, not current law", () => {
    const area = (innerWest as NormalisedSourcePayload).planningChangeAreas![0]!;
    expect(area.id).toContain("inner-west");
    expect(area.proposedControls.legalStatus).toBe("PROPOSED");
    const hit = resolveKeySitesForPoint({ lng: 151.156, lat: -33.91 });
    expect(hit.some((h) => h.planningChangeAreaId === area.id)).toBe(true);
  });

  it("Phase 1 change test: FSR 2.5 → 2.7 creates event; unchanged re-run is empty", async () => {
    setEdgecliffFixtureVariant("base");
    const first = await runSourceOnce("fixture-edgecliff-woollahra", null);
    expect(first.status).toBe("SUCCEEDED");
    expect(first.contentHash).toBeTruthy();
    expect(first.events.length).toBeGreaterThan(0);

    const unchanged = await runSourceOnce("fixture-edgecliff-woollahra", {
      contentHash: first.contentHash!,
      normalised: first.normalised!,
      retrievedAt: new Date().toISOString(),
    });
    expect(unchanged.status).toBe("UNCHANGED");
    expect(unchanged.events).toHaveLength(0);

    // Simulate source field change via bump fixture
    const events = diffNormalisedPayloads(
      "fixture-edgecliff-woollahra",
      edgecliff as NormalisedSourcePayload,
      edgecliffBump as NormalisedSourcePayload,
    );
    const fsr = events.find((e) => e.kind === "FSR_PROPOSED_CHANGE" && e.title.includes("CS7.2"));
    expect(fsr).toBeTruthy();
    expect(fsr!.oldValue).toMatchObject({ fsr: 2.5 });
    expect(fsr!.newValue).toMatchObject({ fsr: 2.7 });
    expect(fsr!.summary).toMatch(/PROPOSED/i);

    setEdgecliffFixtureVariant("fsr-bump");
    const second = await runSourceOnce("fixture-edgecliff-woollahra", {
      contentHash: first.contentHash!,
      normalised: first.normalised!,
      retrievedAt: new Date().toISOString(),
    });
    expect(second.status).toBe("SUCCEEDED");
    expect(second.contentHash).not.toBe(first.contentHash);
    expect(second.events.some((e) => e.kind === "FSR_PROPOSED_CHANGE")).toBe(true);

    // Same bump again → unchanged
    const third = await runSourceOnce("fixture-edgecliff-woollahra", {
      contentHash: second.contentHash!,
      normalised: second.normalised!,
      retrievedAt: new Date().toISOString(),
    });
    expect(third.status).toBe("UNCHANGED");
    expect(third.events).toHaveLength(0);
    expect(getEdgecliffFixtureVariant()).toBe("fsr-bump");
  });

  it("content hashes are stable for identical normalised payloads", () => {
    const a = contentHash(edgecliff);
    const b = contentHash(structuredClone(edgecliff));
    expect(a).toBe(b);
    expect(contentHash(edgecliffBump)).not.toBe(a);
  });
});
