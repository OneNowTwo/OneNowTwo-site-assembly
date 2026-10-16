import { describe, expect, it } from "vitest";
import {
  containsTodayJargon,
  presentTodayStory,
  sitesWorthLookingSubheading,
  strategyAdjective,
  todayTypeLabel,
} from "@/lib/intelligence/today-agent-copy";
import { whyItMattersSentence } from "@/lib/intelligence/site-candidate-index";

describe("today agent copy — four named updates", () => {
  it("humanizes Sydney key-site cluster (25)", () => {
    const p = presentTodayStory(
      {
        type: "KEY_SITE_PROGRAM",
        location: null,
        title: "SYDNEY KEY SITE UPDATE",
        whatChanged: "25 key site / assembly signals across the planning program.",
        whyItMatters:
          "25 key-site signals in this area. 25 parcels/sites in the change cluster — review assemblies that match apartments.",
        affectedSites: 25,
      },
      "APARTMENTS",
    );
    expect(p.typeLabel).toBe("PLANNING UPDATE");
    expect(p.title).toBe("Planning update affects 25 potential apartment sites");
    expect(p.explanation).toMatch(/25 potential apartment sites/i);
    expect(containsTodayJargon(p.title)).toBe(false);
    expect(containsTodayJargon(p.explanation)).toBe(false);
  });

  it("humanizes Sydney key-site cluster (7)", () => {
    const p = presentTodayStory(
      {
        type: "KEY_SITE_PROGRAM",
        location: null,
        title: "SYDNEY KEY SITE UPDATE",
        whatChanged: "4 key site / assembly signals across the planning program.",
        whyItMatters:
          "4 key-site signals in this area. 7 parcels/sites in the change cluster — review assemblies that match apartments.",
        affectedSites: 7,
      },
      "APARTMENTS",
    );
    expect(p.typeLabel).toBe("PLANNING UPDATE");
    expect(p.title).toBe("Planning update affects 7 potential apartment sites");
    expect(containsTodayJargon(p.explanation)).toBe(false);
  });

  it("humanizes Inner West Area L", () => {
    const p = presentTodayStory(
      {
        type: "KEY_SITE_PROGRAM",
        location: "Key site Area L",
        title: "Key site Area L — Inner West key site Area L",
        whatChanged: "Linked to Inner West — Our Fairer Future / Endorsed Planning Controls.",
        whyItMatters: "Material change with 1 related signal for apartments.",
        affectedSites: 1,
      },
      "APARTMENTS",
    );
    expect(p.typeLabel).toBe("KEY SITE UPDATE");
    expect(p.title).toBe("Inner West planning update — Area L");
    expect(p.explanation).toMatch(/One potential apartment site/i);
    expect(containsTodayJargon(p.explanation)).toBe(false);
  });

  it("humanizes Inner West Area M", () => {
    const p = presentTodayStory(
      {
        type: "KEY_SITE_PROGRAM",
        location: "Key site Area M",
        title: "Key site Area M — Inner West key site Area M",
        whatChanged: "Linked to Inner West — Our Fairer Future / Endorsed Planning Controls.",
        whyItMatters: "Material change with 1 related signal for apartments.",
        affectedSites: 1,
      },
      "APARTMENTS",
    );
    expect(p.typeLabel).toBe("KEY SITE UPDATE");
    expect(p.title).toBe("Inner West planning update — Area M");
    expect(containsTodayJargon(p.title + p.explanation)).toBe(false);
  });
});

describe("today agent copy — helpers", () => {
  it("strategy adjective and sites subheading", () => {
    expect(strategyAdjective("APARTMENTS")).toBe("apartment");
    expect(strategyAdjective("CO_LIVING")).toBe("co-living");
    expect(sitesWorthLookingSubheading("TOWNHOUSES")).toBe(
      "Potential development opportunities ranked for Townhouses.",
    );
  });

  it("type labels stay human", () => {
    expect(todayTypeLabel("KEY_SITE_PROGRAM", "SYDNEY KEY SITE UPDATE")).toBe("PLANNING UPDATE");
    expect(todayTypeLabel("KEY_SITE_PROGRAM", "Key site Area L")).toBe("KEY SITE UPDATE");
    expect(todayTypeLabel("DA_LODGED")).toBe("DEVELOPMENT APPLICATION");
  });

  it("why-it-matters avoids modelled pathway / outer screening jargon", () => {
    const line = whyItMattersSentence({
      zone: "R3",
      currentFsr: 0.7,
      siteAreaSqm: 1550,
      lotCount: 3,
      suburb: "Kogarah",
      stationDistanceM: 450,
    });
    expect(line).toContain("R3");
    expect(line).toContain("0.7:1");
    expect(line).toContain("1,550 sqm");
    expect(line).toContain("Kogarah");
    expect(line.toLowerCase()).not.toMatch(/modelled pathway|outer\/centre|indexed|discovery/);
  });
});
