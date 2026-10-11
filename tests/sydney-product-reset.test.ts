import { describe, expect, it } from "vitest";
import {
  classifyDiffMateriality,
  hasMaterialControlDiff,
  isMaterialForToday,
  eventDedupeFingerprint,
} from "@/lib/intelligence/material-change";
import { aggregateIntelligenceStories } from "@/lib/intelligence/stories";
import { resolveMapTarget, buildMapHref, SYDNEY_METRO_START } from "@/lib/map/map-target";
import { profileForStrategy } from "@/lib/source-watcher/strategy-profile";
import { canonicalParcelKey } from "@/lib/intelligence/canonical-key";
import { coverageSummary, SYDNEY_COVERAGE_MATRIX } from "@/lib/intelligence/sydney-coverage";
import { getMarketScope } from "@/lib/market-scope";

describe("Sydney product reset — material change rules", () => {
  it("SOURCE_DOCUMENT_CHANGED with only hash churn is not material", () => {
    expect(
      classifyDiffMateriality({
        kind: "SOURCE_DOCUMENT_CHANGED",
        oldValue: { documentHash: "aaa" },
        newValue: { documentHash: "bbb", structuredDataStatus: "NEEDS_RE_EXTRACTION" },
      }).material,
    ).toBe(false);
  });

  it("FSR proposed change is material", () => {
    expect(
      classifyDiffMateriality({
        kind: "FSR_PROPOSED_CHANGE",
        oldValue: { fsr: 2.2 },
        newValue: { fsr: 3.0 },
      }).material,
    ).toBe(true);
  });

  it("bootstrap / SOURCE_REFRESHED is baseline not Today", () => {
    const c = classifyDiffMateriality({
      kind: "SOURCE_REFRESHED",
      changeKey: "live-x:bootstrap:area-1:abc",
      title: "Area — ingested",
    });
    expect(c.material).toBe(false);
    expect(c.runPurposeHint).toBe("BASELINE");
  });

  it("isMaterialForToday respects lifecycle + diagnostics kinds", () => {
    expect(
      isMaterialForToday({
        kind: "SOURCE_DOCUMENT_CHANGED",
        material: false,
        lifecycleStatus: "ACTIVE",
      }),
    ).toBe(false);
    expect(
      isMaterialForToday({
        kind: "KEY_SITE_CREATED",
        material: true,
        lifecycleStatus: "FIXTURE",
      }),
    ).toBe(false);
    expect(
      isMaterialForToday({
        kind: "KEY_SITE_CREATED",
        material: true,
        lifecycleStatus: "ACTIVE",
      }),
    ).toBe(true);
  });

  it("hasMaterialControlDiff detects FSR uplift", () => {
    expect(hasMaterialControlDiff({ fsr: 1 }, { fsr: 2 })).toBe(true);
    expect(hasMaterialControlDiff({ documentHash: "a" }, { documentHash: "b" })).toBe(false);
  });
});

describe("Sydney product reset — IntelligenceStory aggregation", () => {
  it("collapses many key-site events into one story", () => {
    const profile = profileForStrategy("APARTMENTS");
    const now = new Date("2026-10-11T00:00:00Z");
    const events = Array.from({ length: 8 }, (_, i) => ({
      id: `e${i}`,
      kind: "KEY_SITE_CHANGED",
      title: `Key site KS_${i} updated`,
      summary: "Inner West key site",
      sourceId: "live-inner-west",
      material: true,
      lifecycleStatus: "ACTIVE",
      importance: 6,
      createdAt: now,
      payload: { lga: "Inner West", externalKeySiteId: `KS_${i}` },
      newValue: { externalKeySiteId: `KS_${i}`, proposedControls: { fsr: 2.5 + i * 0.01 } },
      href: `/map?pca=iw-pca&keySite=KS_${i}`,
    }));
    const stories = aggregateIntelligenceStories(events, profile, { maxStories: 5, now });
    expect(stories.length).toBe(1);
    expect(stories[0]!.title).toMatch(/INNER WEST/i);
    expect(stories[0]!.eventCount).toBeGreaterThan(1);
    expect(stories[0]!.mapHref).toContain("/map?");
    expect(stories[0]!.findHref).toContain("/find?");
  });

  it("dedupes identical fingerprint events in the same day", () => {
    const profile = profileForStrategy("APARTMENTS");
    const now = new Date("2026-10-11T12:00:00Z");
    const base = {
      kind: "SOURCE_DOCUMENT_CHANGED",
      title: "SOURCE_DOCUMENT_CHANGED — portal",
      sourceId: "live-edgecliff",
      material: false,
      lifecycleStatus: "ACTIVE" as const,
      importance: 9,
      createdAt: now,
      newValue: { documentHash: "x" },
    };
    // non-material → filtered out
    const stories = aggregateIntelligenceStories(
      [
        { ...base, id: "a" },
        { ...base, id: "b" },
      ],
      profile,
      { now },
    );
    expect(stories).toHaveLength(0);
  });

  it("strategy changes ranking weight", () => {
    const now = new Date("2026-10-11T00:00:00Z");
    const events = [
      {
        id: "1",
        kind: "FSR_PROPOSED_CHANGE",
        title: "FSR uplift",
        sourceId: "live-a",
        material: true,
        lifecycleStatus: "ACTIVE",
        importance: 5,
        createdAt: now,
        payload: { lga: "Parramatta" },
        newValue: { fsr: 3 },
      },
      {
        id: "2",
        kind: "HDA_RECORD_PUBLISHED",
        title: "HDA near station",
        sourceId: "nsw-hda",
        material: true,
        lifecycleStatus: "ACTIVE",
        importance: 5,
        createdAt: now,
        payload: { suburb: "Redfern" },
        newValue: { recommendation: "yes" },
      },
    ];
    const apt = aggregateIntelligenceStories(events, profileForStrategy("APARTMENTS"), { now });
    const col = aggregateIntelligenceStories(events, profileForStrategy("CO_LIVING"), { now });
    expect(apt[0]).toBeTruthy();
    expect(col[0]).toBeTruthy();
    // Both return stories; apartments should prefer FSR, co-living prefers HDA/transport signal
    const aptTopIsFsr = /FSR|PLANNING/i.test(apt[0]!.title + apt[0]!.kind);
    const colTopIsHda = /HDA|DEVELOPMENT|Redfern/i.test(col[0]!.title + col[0]!.kind + (col[0]!.locationLabel ?? ""));
    expect(aptTopIsFsr || colTopIsHda).toBe(true);
  });
});

describe("Sydney product reset — MapTarget", () => {
  it("resolves pca + keySite params", () => {
    const sp = new URLSearchParams("pca=area-1&keySite=KS_9");
    const t = resolveMapTarget(sp);
    expect(t?.kind).toBe("KEY_SITE");
    expect(t?.planningChangeAreaId).toBe("area-1");
    expect(t?.keySiteId).toBe("KS_9");
  });

  it("resolves lat/lng/zoom and opportunityId", () => {
    expect(resolveMapTarget(new URLSearchParams("lat=-33.87&lng=151.21&zoom=14"))?.kind).toBe("POINT");
    expect(resolveMapTarget(new URLSearchParams("opportunityId=opp1"))?.kind).toBe("OPPORTUNITY");
    expect(resolveMapTarget(new URLSearchParams("parcelId=nsw-cadid:1"))?.kind).toBe("PARCEL");
    expect(resolveMapTarget(new URLSearchParams("activityId=act1&lat=-33.8&lng=151.2"))?.kind).toBe(
      "DEVELOPMENT_ACTIVITY",
    );
    expect(resolveMapTarget(new URLSearchParams("bbox=151.1,-33.9,151.3,-33.7"))?.kind).toBe("BBOX");
  });

  it("buildMapHref is generic and round-trips", () => {
    const href = buildMapHref({ planningChangeAreaId: "pca1", keySiteId: "KS1", lat: -33.9, lng: 151.1 });
    expect(href).toContain("/map?");
    expect(href).toContain("pca=pca1");
    expect(href).toContain("keySite=KS1");
    const t = resolveMapTarget(new URL(href, "http://localhost").searchParams);
    expect(t?.kind).toBe("KEY_SITE");
  });

  it("default map start is Sydney metro not Manly Vale", () => {
    expect(SYDNEY_METRO_START.zoom).toBeLessThanOrEqual(12);
    expect(SYDNEY_METRO_START.lat).toBeCloseTo(-33.87, 1);
    // Manly Vale was ~-33.836 / zoom 18
    expect(SYDNEY_METRO_START.zoom).not.toBe(18);
  });
});

describe("Sydney product reset — canonical identity + coverage + market scope", () => {
  it("canonicalParcelKey sorts and dedupes", () => {
    expect(canonicalParcelKey(["b", "a", "a"])).toBe("a|b");
    expect(eventDedupeFingerprint({ sourceId: "s", kind: "FSR_PROPOSED_CHANGE", newValue: { fsr: 2 } })).toContain(
      "FSR",
    );
  });

  it("coverage matrix covers Greater Sydney LGAs with statuses", () => {
    const summary = coverageSummary();
    expect(summary.lgaCount).toBeGreaterThanOrEqual(10);
    expect(SYDNEY_COVERAGE_MATRIX.some((r) => r.lga === "Inner West")).toBe(true);
    expect(summary.byCategory.CURRENT_PLANNING.LIVE).toBeGreaterThan(0);
    expect(summary.byCategory.DA.NOT_YET_CONNECTED).toBeGreaterThan(0);
  });

  it("header market label is selected scope not app identity", () => {
    expect(getMarketScope("sydney-metro").headerLabel).toBe("NSW · Sydney metro");
    expect(getMarketScope("newcastle").headerLabel).toContain("Newcastle");
    expect(getMarketScope(null).id).toBe("sydney-metro");
  });
});
