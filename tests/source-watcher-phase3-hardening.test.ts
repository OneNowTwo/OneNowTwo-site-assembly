import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  annotateParcelWithProposedFindFields,
  parseNaturalLanguageFind,
  profileForStrategy,
  parseHdaProjectsFromText,
  parseMajorProjectDetail,
  majorProjectsToDevelopmentActivities,
} from "./phase3-helpers";
import { proposedFindFieldsAtPoint } from "@/lib/source-watcher/parcel-link";
import { loadFixturePlanningAreas } from "@/lib/source-watcher/key-sites";

/** Merge helper mirroring find-sites pickValue — UI null must not wipe NL. */
function pickValue<T>(ui: T | null | undefined, nl: T | null | undefined, fallback?: T | null): T | null {
  if (ui !== undefined && ui !== null && ui !== ("" as unknown as T)) return ui;
  if (nl !== undefined && nl !== null && nl !== ("" as unknown as T)) return nl;
  return fallback ?? null;
}

describe("Source Watcher Phase 3 hardening", () => {
  it("NL Ashfield query resolves filters without UI suburb", () => {
    const nl = parseNaturalLanguageFind(
      "Show me non-strata sites over 450 sqm in Ashfield inside proposed FSR 2.5+ within 400m of a station",
    );
    const suburb = pickValue(null, nl.suburb, null);
    const centreQuery = pickValue(null, nl.centreQuery, suburb);
    const minSiteAreaSqm = pickValue(null, nl.minSiteAreaSqm, profileForStrategy("APARTMENTS").minSiteAreaSqm);
    const minProposedFsr = pickValue(null, nl.minProposedFsr, profileForStrategy("APARTMENTS").minProposedFsr);
    const maxStationDistanceM = pickValue(null, nl.maxStationDistanceM, null);
    const excludeStrata = pickValue(null, nl.excludeStrata, true);
    expect(suburb?.toLowerCase()).toContain("ashfield");
    expect(centreQuery?.toLowerCase()).toContain("ashfield");
    expect(minSiteAreaSqm).toBe(450);
    expect(minProposedFsr).toBe(2.5);
    expect(maxStationDistanceM).toBe(400);
    expect(excludeStrata).toBe(true);
  });

  it("APARTMENTS strategy does not require minProposedFsr", () => {
    expect(profileForStrategy("APARTMENTS").minProposedFsr).toBeNull();
  });

  it("Find annotation accepts persisted areas (not only fixtures)", () => {
    const areas = loadFixturePlanningAreas();
    const fields = proposedFindFieldsAtPoint({ lng: 151.238, lat: -33.8795, areas });
    expect(fields).toHaveProperty("insidePlanningChangeArea");
    // Sync helper remains for tests; production Find loads areas async.
    const viaAnnotate = annotateParcelWithProposedFindFields({ lng: 151.238, lat: -33.8795, areas });
    expect(viaAnnotate.insidePlanningChangeArea).toBe(fields.insidePlanningChangeArea);
  });

  it("HDA project text parser extracts address/dwellings when present", () => {
    const text = `
      HDA-1234 Proponent: Example Pty Ltd
      12 Sample Street, Ashfield NSW 2131
      48 dwellings recommended for SSD pathway
    `;
    const projects = parseHdaProjectsFromText(text, {
      sourceUrl: "https://example.test/briefing.pdf",
      meetingDate: "2026-09-15",
    });
    expect(projects.length).toBeGreaterThan(0);
    expect(projects[0]!.eoiId).toMatch(/HDA/i);
    expect(projects[0]!.dwellings).toBe(48);
  });

  it("SSD detail parser extracts coordinates when present", () => {
    const html = `
      <div>Address: 60 Union Street, Pyrmont, NSW 2009</div>
      <script>window.__MAP__ = { "longitude": 151.195, "latitude": -33.870 };</script>
    `;
    const detail = parseMajorProjectDetail(html);
    expect(detail.lng).toBeCloseTo(151.195, 3);
    expect(detail.lat).toBeCloseTo(-33.87, 2);
    const acts = majorProjectsToDevelopmentActivities(
      [
        {
          externalId: "SSD-1",
          name: "Test",
          address: detail.address,
          lga: null,
          status: "Exhibition",
          caseType: "State Significant Development",
          caseNumber: "SSD-1",
          sourceUrl: "https://example.test",
          developmentType: "Residential / mixed use",
          lng: detail.lng,
          lat: detail.lat,
        },
      ],
      new Date().toISOString(),
    );
    expect(acts[0]!.geometry?.type).toBe("Point");
  });

  it("geography-neutral: no hardcoded suburb names in Find / strategy / today business logic", () => {
    const roots = [
      "src/lib/find/find-sites.ts",
      "src/lib/find/nl-parse.ts",
      "src/lib/source-watcher/strategy-profile.ts",
      "src/lib/source-watcher/find-fields.ts",
      "src/lib/source-watcher/resolve-proposed-at-point.ts",
      "src/lib/monitoring/today-intelligence.ts",
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
    for (const rel of roots) {
      const text = readFileSync(join(process.cwd(), rel), "utf8");
      for (const name of banned) {
        expect(text.includes(name), `${rel} must not hardcode ${name}`).toBe(false);
      }
    }
  });
});
