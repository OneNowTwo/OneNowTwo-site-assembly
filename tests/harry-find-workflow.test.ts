import { describe, expect, it } from "vitest";
import { buildAdjacency } from "@/lib/analysis/geometry";
import { generateAreaAssemblies } from "@/lib/analysis/area-scan";
import { DEFAULT_ASSUMPTIONS } from "@/lib/analysis/assumptions";
import { mergeFilters } from "@/lib/find/find-sites";
import { lot } from "./helpers";

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
});
