import { describe, expect, it } from "vitest";
import {
  annotateParcelWithProposedFindFields,
  matchesProposedFindFilters,
  parseNaturalLanguageFind,
  findMatchReasons,
  whyProposedFsrUplift,
  theoreticalGfaIncreaseSqm,
  parseHdaPublishedRecordsHtml,
  diffHdaDocumentIndex,
  parseMajorProjectsHtml,
  majorProjectsToDevelopmentActivities,
  normaliseOnlineDaRecord,
  classifyDaStatus,
  filterActivitiesNear,
  profileForStrategy,
  PRIMARY_NAV_LABELS_FOR_TEST,
} from "./phase3-helpers";

describe("Source Watcher Phase 3", () => {
  it("nav primary labels are Today / Find / Map / Sites / Pipeline", () => {
    expect(PRIMARY_NAV_LABELS_FOR_TEST).toEqual(["Today", "Find", "Map", "Sites", "Pipeline"]);
  });

  it("Find uses generic proposed-planning fields without geography hardcoding", () => {
    const fields = annotateParcelWithProposedFindFields({ lng: 151.01, lat: -33.88 });
    expect(fields).toHaveProperty("insidePlanningChangeArea");
    expect(fields).toHaveProperty("proposedFsr");
    expect(fields).toHaveProperty("keySiteId");
    expect(matchesProposedFindFilters(fields, { minProposedFsr: 99 })).toBe(false);
    expect(matchesProposedFindFilters(fields, {})).toBe(true);
  });

  it("Find NL parser extracts filters (no suburb === hardcode)", () => {
    const parsed = parseNaturalLanguageFind(
      "Show me non-strata sites over 450 sqm in Ashfield inside proposed FSR 2.5+ within 400m of a station",
    );
    expect(parsed.minSiteAreaSqm).toBe(450);
    expect(parsed.minProposedFsr).toBe(2.5);
    expect(parsed.maxStationDistanceM).toBe(400);
    expect(parsed.excludeStrata).toBe(true);
    expect(parsed.suburb?.toLowerCase()).toContain("ashfield");
  });

  it("Find works without a PlanningChangeArea", () => {
    const empty = {
      insidePlanningChangeArea: false,
      planningChangeStatus: null,
      proposedZone: null,
      proposedFsr: null,
      proposedHeight: null,
      keySiteId: null,
      requiredParcelCount: null,
    };
    expect(matchesProposedFindFilters(empty, { insidePlanningChangeArea: true })).toBe(false);
    expect(matchesProposedFindFilters(empty, {})).toBe(true);
    const reasons = findMatchReasons({
      fields: empty,
      siteAreaSqm: 612,
      currentFsr: 0.9,
      minSiteArea: 450,
      isStrata: false,
      excludeStrata: true,
      headroom: 100000,
    });
    expect(reasons.some((r) => r.kind === "SITE_SIZE")).toBe(true);
    expect(reasons.some((r) => r.kind === "NOT_STRATA")).toBe(true);
  });

  it("why-it-matters is deterministic and separates proposed uplift", () => {
    const gfa = theoreticalGfaIncreaseSqm(700, 0.9, 2.5);
    expect(gfa).toBe(Math.round(700 * (2.5 - 0.9)));
    const why = whyProposedFsrUplift({ currentFsr: 0.9, proposedFsr: 2.5, siteAreaSqm: 700 });
    expect(why?.title).toMatch(/Proposed FSR uplift/i);
    expect(why?.body).toContain("0.9");
    expect(why?.body).toContain("2.5");
  });

  it("HDA live parser indexes published briefing PDFs", () => {
    const html = `
      <a href="/sites/default/files/2026-09/housing-delivery-authority-record-of-briefing-20260915.pdf">Rob</a>
      <a href="/sites/default/files/2026-08/housing-delivery-authority-record-of-briefing-20260818.pdf">Rob</a>
      <a href="/sites/default/files/2024-12/housing-delivery-authority-ssd-criteria.pdf">Criteria</a>
    `;
    const docs = parseHdaPublishedRecordsHtml(html);
    expect(docs.length).toBe(3);
    expect(docs[0]!.meetingDate).toBe("2026-09-15");
    const events = diffHdaDocumentIndex([], docs);
    expect(events.some((e) => e.kind === "HDA_RECORD_PUBLISHED")).toBe(true);
  });

  it("SSD live parser extracts major project listings", () => {
    const html = `
      <a href="/major-projects/projects/mixed-use-development-60-union-street-pyrmont">x</a>
      City of Sydney Mixed Use Development at 60 Union Street, Pyrmont 60 Union Street, Pyrmont Read more SSD-123 Exhibition State Significant Development
    `;
    const listings = parseMajorProjectsHtml(html, "Exhibition");
    expect(listings.length).toBeGreaterThan(0);
    const acts = majorProjectsToDevelopmentActivities(listings, new Date().toISOString());
    expect(acts[0]!.type).toBe("SSD");
    expect(acts[0]!.status).toBe("EXHIBITION");
  });

  it("DA normaliser does not invent storeys/dwellings", () => {
    const act = normaliseOnlineDaRecord(
      {
        PlanningPortalApplicationNumber: "PAN-1",
        ApplicationStatus: "Approved",
        CouncilName: "Test Council",
        Location: [{ FullAddress: "1 Example St", Suburb: "Testville", X: 151.2, Y: -33.87 }],
      },
      new Date().toISOString(),
    );
    expect(act?.status).toBe("APPROVED");
    expect(act?.dwellings).toBeNull();
    expect(act?.storeys).toBeNull();
    expect(classifyDaStatus("Lodged")).toBe("LODGED");
  });

  it("nearby DevelopmentActivity filter is geography-neutral", () => {
    const checkedAt = new Date().toISOString();
    const near = filterActivitiesNear(
      [
        {
          id: "a",
          sourceId: "nsw-da-cdc-pcc",
          externalId: "1",
          type: "DA",
          status: "APPROVED",
          address: "Near",
          geometry: { type: "Point", coordinates: [151.2001, -33.8701] },
          developmentType: "RFB",
          description: null,
          dwellings: 42,
          storeys: 7,
          estimatedCost: null,
          lodgedAt: null,
          determinedAt: "2026-09-14",
          sourceUrl: null,
          checkedAt,
        },
        {
          id: "b",
          sourceId: "nsw-da-cdc-pcc",
          externalId: "2",
          type: "DA",
          status: "LODGED",
          address: "Far",
          geometry: { type: "Point", coordinates: [150.0, -34.0] },
          developmentType: null,
          description: null,
          dwellings: null,
          storeys: null,
          estimatedCost: null,
          lodgedAt: null,
          determinedAt: null,
          sourceUrl: null,
          checkedAt,
        },
      ],
      { lng: 151.2, lat: -33.87 },
      500,
    );
    expect(near).toHaveLength(1);
    expect(near[0]!.address).toBe("Near");
    expect(near[0]!.distanceM).toBeLessThan(500);
  });

  it("strategy profiles are extensible and default-safe", () => {
    const apt = profileForStrategy("APARTMENTS");
    expect(apt.excludeStrata).toBe(true);
    expect(apt.minSiteAreaSqm).toBe(450);
    const def = profileForStrategy("GENERAL_RESIDENTIAL");
    expect(def.requirePositiveHeadroom).toBe(false);
  });

  it("random NSW point does not require Edgecliff/Inner West code paths for find fields", () => {
    // Parramatta CBD-ish — outside pilot datasets
    const fields = annotateParcelWithProposedFindFields({ lng: 151.002, lat: -33.815 });
    expect(typeof fields.insidePlanningChangeArea).toBe("boolean");
    // May or may not intersect a PCA; product must still return the generic shape.
    expect(Object.keys(fields).sort()).toEqual(
      [
        "insidePlanningChangeArea",
        "keySiteId",
        "planningChangeStatus",
        "proposedFsr",
        "proposedHeight",
        "proposedZone",
        "requiredParcelCount",
      ].sort(),
    );
  });
});
