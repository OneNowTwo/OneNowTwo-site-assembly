import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { placeMatches } from "@/lib/find/find-sites";
import {
  isFixtureOnlySource,
  presentPlanningEntitySource,
  presentSourceForUser,
} from "@/lib/monitoring/source-presentation";
import { listLiveProposedPointEnrichers } from "@/lib/source-watcher/live-point-enrichers";
// Ensure adapter enrichers are registered (same side-effect as production resolver).
import "@/lib/source-watcher/adapters/register-live-enrichers";

describe("Source Watcher Phase 3 final pass", () => {
  it("placeMatches excludes missing and non-matching LGA/suburb metadata", () => {
    expect(placeMatches("Inner West", null)).toBe(false);
    expect(placeMatches("Inner West", undefined)).toBe(false);
    expect(placeMatches("Inner West", "Woollahra")).toBe(false);
    expect(placeMatches("Inner West", "INNER WEST")).toBe(true);
    expect(placeMatches("Ashfield", "Summer Hill")).toBe(false);
    expect(placeMatches("Ashfield", "Ashfield")).toBe(true);
  });

  it("LGA A filter excludes candidate with LGA B (regression)", () => {
    // Mirrors find-sites hard filter: explicit LGA requires placeMatches.
    const filterLga = "Inner West";
    const candidates = [
      { key: "a", lga: "Inner West", suburb: "Ashfield" },
      { key: "b", lga: "Woollahra", suburb: "Edgecliff" },
      { key: "c", lga: null, suburb: "Ashfield" },
    ];
    const kept = candidates.filter((c) => placeMatches(filterLga, c.lga));
    expect(kept.map((c) => c.key)).toEqual(["a"]);
  });

  it("suburb filter excludes missing and other-suburb candidates", () => {
    const filterSuburb = "Ashfield";
    const candidates = [
      { key: "a", suburb: "Ashfield" },
      { key: "b", suburb: "Croydon" },
      { key: "c", suburb: null },
    ];
    const kept = candidates.filter((c) => placeMatches(filterSuburb, c.suburb));
    expect(kept.map((c) => c.key)).toEqual(["a"]);
  });

  it("presentSourceForUser never returns fixture-* labels", () => {
    expect(isFixtureOnlySource("fixture-edgecliff-woollahra")).toBe(true);
    expect(presentSourceForUser("fixture-edgecliff-woollahra")).toBeNull();
    expect(presentSourceForUser("fixture-inner-west-fairer-future")).toBeNull();
    const edge = presentSourceForUser("live-edgecliff-woollahra");
    expect(edge?.label).toMatch(/NSW Planning Portal/i);
    expect(edge?.label).not.toMatch(/fixture/i);
    expect(edge?.href).toBeTruthy();
    const fromPca = presentPlanningEntitySource({
      planningChangeAreaId: "nsw:edgecliff-woollahra-state-led-2026",
      sourceId: null,
    });
    expect(fromPca?.label).toMatch(/Edgecliff-Woollahra/i);
    expect(fromPca?.label).not.toMatch(/fixture/i);
    const iw = presentPlanningEntitySource({
      planningChangeAreaId: "council:inner-west-our-fairer-future",
      sourceId: null,
    });
    expect(iw?.label).toMatch(/Inner West/i);
  });

  it("live enricher registry is adapter-owned (Find does not hardcode IW)", () => {
    const ids = listLiveProposedPointEnrichers().map((e) => e.sourceId);
    expect(ids).toContain("live-inner-west-fairer-future");
    const findText = readFileSync(join(process.cwd(), "src/lib/find/find-sites.ts"), "utf8");
    expect(findText).toContain("resolveProposedPlanningForPoint");
    expect(findText).not.toContain("live-inner-west-fairer-future");
  });

  it("Find / Map / Site / Today business logic has no IW_BBOX or council branching", () => {
    const roots = [
      "src/lib/find/find-sites.ts",
      "src/lib/find/nl-parse.ts",
      "src/lib/source-watcher/strategy-profile.ts",
      "src/lib/source-watcher/find-fields.ts",
      "src/lib/source-watcher/resolve-proposed-at-point.ts",
      "src/lib/monitoring/today-intelligence.ts",
      "src/components/opportunity/site-intelligence.tsx",
      "src/app/api/planning/proposed/route.ts",
    ];
    const banned = [
      "IW_BBOX",
      "queryInnerWestProposedAtPoint",
      "Edgecliff",
      "Woollahra",
      "Manly Vale",
      "Kenneth",
      "Jacaranda",
      "Ashfield",
      "Neutral Bay",
      "Inner West",
    ];
    // Inner West / place names allowed only in presentation map + adapter register + tests/fixtures.
    for (const rel of roots) {
      const text = readFileSync(join(process.cwd(), rel), "utf8");
      expect(text.includes("IW_BBOX"), `${rel} must not contain IW_BBOX`).toBe(false);
      expect(text.includes("queryInnerWestProposedAtPoint"), `${rel} must not import IW query`).toBe(false);
      for (const name of banned.slice(2)) {
        // resolve-proposed + find-sites must stay geography-neutral
        if (rel.includes("source-presentation")) continue;
        expect(text.includes(name), `${rel} must not hardcode ${name}`).toBe(false);
      }
    }
    // Adapter register may mention Inner West internally; Find must not.
    const findText = readFileSync(join(process.cwd(), "src/lib/find/find-sites.ts"), "utf8");
    expect(findText).toContain("resolveProposedPlanningForPoint");
    expect(findText).not.toContain("inner-west");
  });
});
