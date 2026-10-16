import { describe, expect, it } from "vitest";
import {
  buildPlanningUpdateEvidence,
  buildStoryNavHrefs,
  isDocumentOnlyChange,
  isPlaceLikeLocation,
  isValidLgaFilter,
  resolveStoryLocation,
} from "@/lib/intelligence/planning-update-detail";
import { aggregateIntelligenceStories } from "@/lib/intelligence/stories";
import { DEFAULT_STRATEGY_PROFILE } from "@/lib/source-watcher/strategy-profile";

describe("planning update detail + navigation", () => {
  it("rejects Area L / Key site Area M as place or LGA", () => {
    expect(isPlaceLikeLocation("Key site Area L")).toBe(false);
    expect(isPlaceLikeLocation("Area L")).toBe(false);
    expect(isValidLgaFilter("Key site Area L")).toBe(false);
    expect(isValidLgaFilter("Inner West")).toBe(true);
    expect(
      resolveStoryLocation({
        locationLabel: "Key site Area L",
        title: "Key site Area L",
        pcaLgas: ["INNER WEST"],
      }),
    ).toBe("Inner West");
  });

  it("builds findHref with pca/keySite/candidateIds — never bare strategy=APARTMENTS", () => {
    const nav = buildStoryNavHrefs({
      strategy: "APARTMENTS",
      planningChangeAreaId: "council:inner-west-our-fairer-future",
      keySiteId: "Area L",
      locationLabel: "Inner West",
      affectedCandidateIds: ["cand-1", "cand-2"],
    });
    expect(nav.findHref).toContain("strategy=APARTMENTS");
    expect(nav.findHref).toContain("pca=council%3Ainner-west-our-fairer-future");
    expect(nav.findHref).toContain("keySite=Area+L");
    expect(nav.findHref).toContain("candidateIds=cand-1%2Ccand-2");
    expect(nav.findHref).toContain("lga=Inner+West");
    expect(nav.findHref).not.toMatch(/^\/find\?strategy=APARTMENTS$/);
    expect(nav.mapHref).toContain("pca=");
    expect(nav.mapHref).toContain("keySite=Area+L");
  });

  it("does not pass Area L as lga in story aggregation findHref", () => {
    const stories = aggregateIntelligenceStories(
      [
        {
          id: "e1",
          kind: "KEY_SITE_CHANGED",
          title: "Key site Area L — Inner West key site Area L",
          summary: "Linked to Inner West — Our Fairer Future / Endorsed Planning Controls.",
          createdAt: new Date().toISOString(),
          material: true,
          importance: 8,
          newValue: {
            name: "Inner West key site Area L",
            externalKeySiteId: "Area L",
            planningChangeAreaId: "council:inner-west-our-fairer-future",
          },
        },
      ],
      DEFAULT_STRATEGY_PROFILE,
    );
    expect(stories.length).toBeGreaterThan(0);
    const s = stories[0]!;
    expect(s.findHref).not.toMatch(/lga=Key\+site/i);
    expect(s.findHref).toContain("keySite=");
    expect(s.locationLabel).not.toMatch(/Key site/i);
  });

  it("marks document-only changes as awaiting verification — no invented controls", () => {
    expect(isDocumentOnlyChange("SOURCE_DOCUMENT_CHANGED", "SOURCE_DOCUMENT_CHANGED — portal", "hash")).toBe(true);
    const evidence = buildPlanningUpdateEvidence({
      storyTitle: "SOURCE_DOCUMENT_CHANGED — official portal document changed",
      storySummary: "Portal page changed. Structured controls marked NEEDS_RE_EXTRACTION.",
      eventKinds: ["SOURCE_DOCUMENT_CHANGED"],
      eventTitles: ["SOURCE_DOCUMENT_CHANGED — official portal document changed"],
      eventSummaries: ["Portal page changed."],
      sourceName: "Inner West Council — Our Fairer Future",
    });
    expect(evidence.awaitingVerification).toBe(true);
    expect(evidence.proposedControls).toBeNull();
    expect(evidence.plainSummary).toMatch(/awaiting verification/i);
  });

  it("surfaces previous → proposed controls only from evidence", () => {
    const evidence = buildPlanningUpdateEvidence({
      storyTitle: "Inner West Area L",
      storySummary: "Proposed FSR change",
      oldControls: { fsr: 0.7, zone: "R2" },
      newControls: { fsr: 2.2, zone: "R3", heightM: 21 },
      pca: {
        id: "council:inner-west-our-fairer-future",
        title: "Inner West — Our Fairer Future",
        status: "PROPOSED",
        lgas: ["INNER WEST"],
        sourceUrl: "https://example.com",
        proposedControls: { fsr: 2.2, zone: "R3", heightM: 21 },
      },
    });
    expect(evidence.awaitingVerification).toBe(false);
    expect(evidence.previousControls?.fsr).toBe(0.7);
    expect(evidence.proposedControls?.fsr).toBe(2.2);
    expect(evidence.proposedControls?.heightM).toBe(21);
    expect(evidence.locationLabel).toMatch(/Inner West/i);
  });

  it("treats notes-only proposedControls as awaiting verification — no placeholder controls", () => {
    const evidence = buildPlanningUpdateEvidence({
      storyTitle: "Key site Area L updated",
      storySummary: "Inner West key site Area L",
      keySites: [
        {
          externalKeySiteId: "Area L",
          name: "Inner West key site Area L",
          proposedControls: {
            legalStatus: "PROPOSED",
            machineReadable: true,
            notes: "Draft Key Sites layer from Adopted_Planning_Layers FeatureServer",
          },
        },
      ],
      pca: {
        id: "council:inner-west-our-fairer-future",
        title: "Inner West — Our Fairer Future / Endorsed Planning Controls",
        status: "PROPOSED",
        lgas: ["INNER WEST"],
        sourceUrl: "https://experience.arcgis.com/experience/2b5ffd9da4f44cd7b7886b632a180556/page/Page",
        proposedControls: { notes: "Draft only" },
      },
      sourceName: "Inner West Council — Our Fairer Future",
    });
    expect(evidence.awaitingVerification).toBe(true);
    expect(evidence.proposedControls).toBeNull();
    expect(evidence.plainSummary).toMatch(/Source updated — change details awaiting verification/i);
  });

  it("shows structured Area L controls from key-site FeatureServer evidence when uniform", () => {
    const evidence = buildPlanningUpdateEvidence({
      storyTitle: "Key site Area L updated",
      storySummary: "Inner West key site Area L",
      detectedAt: "2026-10-16T05:00:00.000Z",
      keySites: [
        {
          externalKeySiteId: "Area L",
          name: "Inner West key site Area L",
          sourceUrl: "https://experience.arcgis.com/experience/2b5ffd9da4f44cd7b7886b632a180556/page/Page",
          proposedControls: {
            legalStatus: "PROPOSED",
            zone: "R3",
            fsr: 1.75,
            heightM: 17,
            machineReadable: true,
            screeningSample: {
              lng: 151.168,
              lat: -33.899,
              zone: "R3",
              fsr: 1.75,
              heightM: 17,
              mixedAcrossKeySite: false,
              scope: "INTERIOR_POINT_SAMPLE",
            },
          },
        },
      ],
      pca: {
        id: "council:inner-west-our-fairer-future",
        title: "Inner West — Our Fairer Future / Endorsed Planning Controls",
        status: "PROPOSED",
        lgas: ["INNER WEST"],
        sourceUrl: "https://experience.arcgis.com/experience/2b5ffd9da4f44cd7b7886b632a180556/page/Page",
      },
      sourceName: "Inner West Council — Our Fairer Future",
      sourceUrl: "https://experience.arcgis.com/experience/2b5ffd9da4f44cd7b7886b632a180556/page/Page",
    });
    expect(evidence.awaitingVerification).toBe(false);
    expect(evidence.proposedControls).toEqual(
      expect.objectContaining({ zone: "R3", fsr: 1.75, heightM: 17 }),
    );
    expect(evidence.screeningSample?.scope).toBe("INTERIOR_POINT_SAMPLE");
    expect(evidence.plainSummary).toMatch(/1\.75/);
    expect(evidence.plainSummary).toMatch(/Interior-point screening sample/i);
    expect(evidence.plainSummary).not.toMatch(/awaiting verification/i);
    expect(evidence.whyItMatters).toMatch(/Area L/);
    expect(evidence.webpageUrl).toContain("arcgis.com");
  });

  it("does not present mixed key-site point samples as uniform proposed controls", () => {
    const evidence = buildPlanningUpdateEvidence({
      storyTitle: "Key site Area L updated",
      keySites: [
        {
          externalKeySiteId: "Area L",
          name: "Inner West key site Area L",
          proposedControls: {
            legalStatus: "PROPOSED",
            zone: null,
            fsr: null,
            heightM: null,
            machineReadable: true,
            notes: "Mixed proposed controls",
            screeningSample: {
              lng: 151.168,
              lat: -33.899,
              zone: "R3",
              fsr: 1.75,
              heightM: 17,
              mixedAcrossKeySite: true,
              distinctFsrs: [1.75, 2.0],
              distinctZones: ["R3"],
              scope: "INTERIOR_POINT_SAMPLE",
            },
          },
        },
      ],
      pca: {
        id: "council:inner-west-our-fairer-future",
        title: "Inner West — Our Fairer Future",
        status: "PROPOSED",
        lgas: ["INNER WEST"],
      },
    });
    expect(evidence.awaitingVerification).toBe(true);
    expect(evidence.proposedControls).toBeNull();
    expect(evidence.screeningSample?.mixedAcrossKeySite).toBe(true);
    expect(evidence.plainSummary).toMatch(/Mixed proposed controls/i);
    expect(evidence.plainSummary).toMatch(/screening sample/i);
    expect(evidence.plainSummary).not.toMatch(/Proposed controls for Inner West · Area L: FSR/);
  });
});
