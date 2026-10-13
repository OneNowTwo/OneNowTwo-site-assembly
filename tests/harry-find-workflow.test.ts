import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildAdjacency } from "@/lib/analysis/geometry";
import { generateAreaAssemblies } from "@/lib/analysis/area-scan";
import { DEFAULT_ASSUMPTIONS } from "@/lib/analysis/assumptions";
import { buildIndexPlaceWhere, mergeFilters, placeScopeThenTake } from "@/lib/find/find-sites";
import { findResultMapHref, type FindMapHrefInput } from "@/lib/find/find-map-href";
import { resolveMapTarget } from "@/lib/map/map-target";
import { lot } from "./helpers";

function sampleFindRow(overrides: Partial<FindMapHrefInput> = {}): FindMapHrefInput {
  return {
    key: "nsw-cadid:1|nsw-cadid:2",
    candidateId: "cand-index-1",
    locationLabel: "Example Street, Parramatta",
    suburb: "Parramatta",
    keySiteId: "KS_1",
    opportunityId: "opp-1",
    lotIds: ["nsw-cadid:1", "nsw-cadid:2"],
    bboxHint: { west: 150.98, south: -33.84, east: 151.02, north: -33.8 },
    ...overrides,
  };
}

describe("Harry Find workflow #1", () => {
  it("Apartments blank Minimum Headroom does not invent minHeadroom=0", () => {
    const { filters, profile } = mergeFilters({
      strategy: "APARTMENTS",
      suburb: "Parramatta",
      minSiteAreaSqm: 450,
      minHeadroom: null,
      excludeStrata: true,
      naturalLanguage: null,
    });
    expect(profile.requirePositiveHeadroom).toBe(true);
    expect(filters.minHeadroom).toBeNull();
    expect(filters.minSiteAreaSqm).toBe(450);
    // Invisible preset maxProperties / station caps must not become hard filters.
    expect(filters.maxOwners).toBeNull();
    expect(filters.maxStationDistanceM).toBeNull();
  });

  it("explicit Minimum Headroom from UI remains a hard filter", () => {
    const { filters } = mergeFilters({
      strategy: "APARTMENTS",
      minHeadroom: 250_000,
    });
    expect(filters.minHeadroom).toBe(250_000);
  });

  it("Find min area 450 lets a valid 600 sqm assembly survive generation", () => {
    // Two ~300 sqm lots → ~600 sqm assembly (below old 800 floor, above Find 450).
    const lots = [
      lot("A", 0, { areaSqm: 300, fsr: 1.2, zone: "R4", isStrata: false }),
      lot("B", 20, { areaSqm: 300, fsr: 1.2, zone: "R4", isStrata: false }),
      lot("C", 40, { areaSqm: 300, fsr: 1.2, zone: "R4", isStrata: false }),
    ];
    const adj = buildAdjacency(lots);
    const at450 = generateAreaAssemblies(lots, adj, DEFAULT_ASSUMPTIONS, {
      maxSeeds: 5,
      maxSize: 3,
      minAreaSqm: 450,
    });
    const at800 = generateAreaAssemblies(lots, adj, DEFAULT_ASSUMPTIONS, {
      maxSeeds: 5,
      maxSize: 3,
      minAreaSqm: 800,
    });
    expect(at450.some((c) => c.metrics.totalAreaSqm >= 450 && c.metrics.totalAreaSqm < 800)).toBe(true);
    expect(at800.every((c) => c.metrics.totalAreaSqm >= 800)).toBe(true);
    expect(at450.some((c) => Math.abs(c.metrics.totalAreaSqm - 600) < 1)).toBe(true);
  });

  it("NL example is not required — empty naturalLanguage leaves filters from UI only", () => {
    const { filters } = mergeFilters({
      strategy: "APARTMENTS",
      suburb: "Parramatta",
      minSiteAreaSqm: 450,
      naturalLanguage: "",
      minProposedFsr: null,
      minHeadroom: null,
    });
    expect(filters.suburb?.toLowerCase()).toBe("parramatta");
    expect(filters.minProposedFsr).toBeNull();
    expect(filters.minHeadroom).toBeNull();
  });

  it("place-scopes before take so a lower-scoring Parramatta row is not drowned by Sydney", () => {
    const elsewhere = Array.from({ length: 300 }, (_, i) => ({
      id: `elsewhere-${i}`,
      suburb: "Blacktown",
      lga: "BLACKTOWN",
      address: `Street ${i}, Blacktown`,
      quickScore: 200 - (i % 50),
    }));
    const parramatta = {
      id: "parra-low",
      suburb: "Northmead",
      lga: "CITY OF PARRAMATTA",
      address: "Fletcher Street, Northmead",
      quickScore: 40, // below many global scores
    };
    const all = [...elsewhere, parramatta];

    // Bug pattern: global top 180 then filter → Parramatta missing.
    const globalThenFilter = [...all]
      .sort((a, b) => b.quickScore - a.quickScore)
      .slice(0, 180)
      .filter((r) => /parramatta/i.test(r.lga) || /parramatta/i.test(r.suburb ?? ""));
    expect(globalThenFilter.find((r) => r.id === "parra-low")).toBeUndefined();

    // Correct: place scope then take.
    const scoped = placeScopeThenTake(all, "Parramatta", 180);
    expect(scoped.find((r) => r.id === "parra-low")).toBeTruthy();
    expect(scoped.every((r) => /parramatta/i.test(r.lga) || /parramatta/i.test(r.suburb ?? "") || /parramatta/i.test(r.address))).toBe(
      true,
    );
  });

  it("index Find builds DB place where before take (not global-then-filter)", () => {
    const where = buildIndexPlaceWhere("Parramatta");
    expect(where.OR).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ suburb: expect.objectContaining({ contains: "Parramatta" }) }),
        expect.objectContaining({ lga: expect.objectContaining({ contains: "Parramatta" }) }),
      ]),
    );
    const src = readFileSync(join(process.cwd(), "src/lib/find/find-sites.ts"), "utf8");
    expect(src).toContain("buildIndexPlaceWhere(place)");
    expect(src).toContain("Index fetch (place-scoped)");
    // Guard: must not reintroduce global fetch then in-memory place filter as the primary path.
    expect(src).not.toMatch(
      /findMany\(\{\s*where:\s*\{\s*lifecycleStatus:\s*"ACTIVE",\s*provenance:\s*"INDEX_DISCOVERY"\s*\},\s*orderBy:[\s\S]*?take,\s*\}\);\s*[\s\S]*?rows\.filter\(\s*\(r\)\s*=>\s*[\s\S]*?placeMatches\(place,\s*r\.suburb\)/,
    );
  });

  it("index Find View on map → INDEX_CANDIDATE (no parcelId / tile bbox / scan)", () => {
    const href = findResultMapHref(sampleFindRow(), "index");
    const t = resolveMapTarget(new URL(href, "http://localhost").searchParams);
    expect(t?.kind).toBe("INDEX_CANDIDATE");
    expect(t?.candidateId).toBe("cand-index-1");
    expect(t?.canonicalKey).toBe("nsw-cadid:1|nsw-cadid:2");
    expect(href).not.toContain("parcelId=");
    expect(href).not.toContain("bbox=");
    expect(href).not.toContain("scan=");
    expect(href).not.toContain("opportunityId=");
  });

  it("index Find falls back to canonicalKey when candidateId missing", () => {
    const href = findResultMapHref(sampleFindRow({ candidateId: null }), "index");
    const t = resolveMapTarget(new URL(href, "http://localhost").searchParams);
    expect(t?.kind).toBe("INDEX_CANDIDATE");
    expect(t?.canonicalKey).toBe("nsw-cadid:1|nsw-cadid:2");
    expect(href).not.toContain("parcelId=");
  });

  it("live deep-scan Find View on map retains live parcel/scan path", () => {
    const href = findResultMapHref(sampleFindRow({ candidateId: null }), "live");
    const t = resolveMapTarget(new URL(href, "http://localhost").searchParams);
    expect(t?.kind).not.toBe("INDEX_CANDIDATE");
    // keySite wins over parcel in resolveMapTarget — still the live entity path.
    expect(["KEY_SITE", "OPPORTUNITY", "PARCEL", "SCAN"]).toContain(t?.kind);
    expect(href).toMatch(/parcelId=|opportunityId=|keySite=|scan=/);
    expect(href).not.toContain("candidateId=");
    expect(href).not.toContain("canonicalKey=");
  });
});
