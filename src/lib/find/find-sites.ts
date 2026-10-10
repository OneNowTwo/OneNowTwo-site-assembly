/**
 * FIND — search parcels/assemblies via existing scan engine + proposed-planning fields.
 * Geography-neutral: no suburb hardcoding.
 * Proposed annotation uses persisted PlanningChangeArea / KeySite (fixtures = test fallback only).
 */

import { scanArea } from "@/lib/scan-service";
import {
  annotateParcelWithProposedFindFields,
  matchesProposedFindFilters,
  findMatchReasons,
  profileForStrategy,
  type StrategyProfile,
  type ProposedPlanningFindFields,
} from "@/lib/source-watcher";
import { loadProposedPlanningAreas } from "@/lib/source-watcher/load-persisted-areas";
import type { ScanCandidate } from "@/lib/analysis/area-scan";
import { nearestLmrCentre } from "@/lib/data-sources/housing-sepp-lmr";
import { parseNaturalLanguageFind } from "./nl-parse";
import type { FindFilters } from "./find-filters-types";

export type { FindFilters } from "./find-filters-types";
export { parseNaturalLanguageFind } from "./nl-parse";

export interface FindResultRow {
  key: string;
  locationLabel: string;
  suburb: string | null;
  siteAreaSqm: number;
  zone: string | null;
  currentFsr: number | null;
  proposedFsr: number | null;
  proposedHeight: number | null;
  planningChangeStatus: string | null;
  keySiteId: string | null;
  stationDistanceM: number | null;
  nearestStationLabel: string | null;
  score: number;
  headroom: number | null;
  maxPayable: number | null;
  lotCount: number;
  owners: number;
  isStrata: boolean;
  whyMatched: Array<{ title: string; body: string }>;
  opportunityId: string | null;
  lotIds: string[];
  bboxHint: { west: number; south: number; east: number; north: number } | null;
}

const EMPTY_PROPOSED: ProposedPlanningFindFields = {
  insidePlanningChangeArea: false,
  planningChangeStatus: null,
  proposedZone: null,
  proposedFsr: null,
  proposedHeight: null,
  keySiteId: null,
  requiredParcelCount: null,
};

/** Explicit UI wins only when it carries a real value — null/empty must not wipe NL. */
function pickValue<T>(ui: T | null | undefined, nl: T | null | undefined, fallback?: T | null): T | null {
  if (ui !== undefined && ui !== null && ui !== ("" as unknown as T)) return ui;
  if (nl !== undefined && nl !== null && nl !== ("" as unknown as T)) return nl;
  return fallback ?? null;
}

function mergeFilters(input: FindFilters): { filters: FindFilters; profile: StrategyProfile } {
  const nl = input.naturalLanguage?.trim() ? parseNaturalLanguageFind(input.naturalLanguage) : {};
  const strategy = input.strategy ?? "GENERAL_RESIDENTIAL";
  const profile = profileForStrategy(strategy);
  const suburb = pickValue(input.suburb, nl.suburb, null);
  const centreQuery = pickValue(input.centreQuery, nl.centreQuery, suburb);
  const filters: FindFilters = {
    ...nl,
    ...input,
    suburb,
    centreQuery,
    minSiteAreaSqm: pickValue(input.minSiteAreaSqm, nl.minSiteAreaSqm, profile.minSiteAreaSqm),
    maxSiteAreaSqm: pickValue(input.maxSiteAreaSqm, nl.maxSiteAreaSqm, null),
    maxOwners: pickValue(input.maxOwners, nl.maxOwners, profile.maxProperties),
    // Strategy may prefer proposed density via ranking — never hard-require unless UI/NL set it.
    minProposedFsr: pickValue(input.minProposedFsr, nl.minProposedFsr, null),
    minCurrentFsr: pickValue(input.minCurrentFsr, nl.minCurrentFsr, profile.minCurrentFsr),
    maxCurrentFsr: pickValue(input.maxCurrentFsr, nl.maxCurrentFsr, null),
    maxStationDistanceM: pickValue(input.maxStationDistanceM, nl.maxStationDistanceM, profile.maxStationDistanceM),
    excludeStrata: pickValue(input.excludeStrata, nl.excludeStrata, profile.excludeStrata) ?? false,
    minHeadroom: pickValue(input.minHeadroom, nl.minHeadroom, profile.requirePositiveHeadroom ? 0 : null),
    insidePlanningChangeArea: pickValue(input.insidePlanningChangeArea, nl.insidePlanningChangeArea, null),
    keySiteOnly: pickValue(input.keySiteOnly, nl.keySiteOnly, null),
    zone: pickValue(input.zone, nl.zone, null),
    lga: pickValue(input.lga, nl.lga, null),
    minRequiredParcelCount: pickValue(input.minRequiredParcelCount, nl.minRequiredParcelCount, null),
    minScore: pickValue(input.minScore, nl.minScore, null),
    strategy,
  };
  return { filters, profile };
}

function annotateCandidate(
  c: ScanCandidate,
  areas: Parameters<typeof annotateParcelWithProposedFindFields>[0]["areas"],
  station: { distanceM: number | null; label: string | null },
  filters: FindFilters,
): FindResultRow {
  const centroid = c.centroid;
  const hasPoint = !!centroid && Number.isFinite(centroid[0]) && Number.isFinite(centroid[1]);
  const proposed = hasPoint
    ? annotateParcelWithProposedFindFields({ lng: centroid![0], lat: centroid![1], areas })
    : EMPTY_PROPOSED;

  const why = findMatchReasons({
    fields: proposed,
    siteAreaSqm: c.siteAreaSqm,
    currentFsr: c.lepFsr ?? c.effectiveFsr,
    minSiteArea: filters.minSiteAreaSqm,
    maxStationDistanceM: filters.maxStationDistanceM,
    stationDistanceM: station.distanceM,
    isStrata: c.isStrata,
    excludeStrata: filters.excludeStrata,
    headroom: c.headroom,
    requirePositiveHeadroom: filters.minHeadroom != null && filters.minHeadroom >= 0,
  });

  if (station.label && station.distanceM != null && filters.maxStationDistanceM != null) {
    const hasStationTick = why.some((w) => w.kind === "STATION_PROXIMITY");
    if (!hasStationTick && station.distanceM <= filters.maxStationDistanceM) {
      why.push({
        kind: "STATION_PROXIMITY",
        title: `<${filters.maxStationDistanceM}m station`,
        body: `${Math.round(station.distanceM)}m from ${station.label}.`,
        matched: true,
      });
    } else if (hasStationTick) {
      const idx = why.findIndex((w) => w.kind === "STATION_PROXIMITY");
      if (idx >= 0) {
        why[idx] = {
          ...why[idx]!,
          body: `${Math.round(station.distanceM)}m from ${station.label}.`,
        };
      }
    }
  }

  if (filters.zone && c.zone && c.zone.toUpperCase().includes(filters.zone.toUpperCase())) {
    why.push({
      kind: "PLANNING_CHANGE",
      title: `Zone ${c.zone}`,
      body: `Current zone matches filter ${filters.zone}.`,
      matched: true,
    });
  }

  return {
    key: c.key,
    locationLabel: c.locationLabel,
    suburb: c.suburb,
    siteAreaSqm: c.siteAreaSqm,
    zone: c.zone,
    currentFsr: c.lepFsr ?? c.effectiveFsr,
    proposedFsr: proposed.proposedFsr,
    proposedHeight: proposed.proposedHeight,
    planningChangeStatus: proposed.planningChangeStatus,
    keySiteId: proposed.keySiteId,
    stationDistanceM: station.distanceM,
    nearestStationLabel: station.label,
    score: c.score.score,
    headroom: c.headroom,
    maxPayable: c.maxPayable,
    lotCount: c.lotCount,
    owners: c.owners,
    isStrata: c.isStrata,
    whyMatched: why.map((w) => ({ title: w.title, body: w.body })),
    opportunityId: c.canonicalOpportunityId ?? null,
    lotIds: c.lotIds,
    bboxHint: null,
  };
}

export async function findDevelopmentSites(input: FindFilters): Promise<{
  filters: FindFilters;
  results: FindResultRow[];
  messages: string[];
  proposedAreasSource?: string;
  precinctFallback?: unknown;
}> {
  const { filters, profile } = mergeFilters(input);
  const messages: string[] = [];

  const hasBBox =
    filters.west != null && filters.south != null && filters.east != null && filters.north != null;
  const centreQuery = filters.centreQuery ?? filters.suburb ?? null;

  if (!hasBBox && !centreQuery) {
    return {
      filters,
      results: [],
      messages: ["Provide a suburb / centre query or draw a map area to search."],
    };
  }

  const [{ areas, source: proposedAreasSource }, scan] = await Promise.all([
    loadProposedPlanningAreas(),
    scanArea({
      bbox: hasBBox
        ? { west: filters.west!, south: filters.south!, east: filters.east!, north: filters.north! }
        : undefined,
      centreQuery: centreQuery ?? undefined,
      suburbHint: filters.suburb ?? undefined,
      maxResults: filters.maxResults ?? 20,
    }),
  ]);
  messages.push(...scan.messages);
  if (proposedAreasSource === "fixture_fallback") {
    messages.push("Proposed planning annotation using fixture fallback (no persisted PlanningChangeArea rows).");
  }

  const centres = scan.centres ?? [];

  let results = scan.candidates.map((c) => {
    let stationDistanceM: number | null = null;
    let nearestStationLabel: string | null = null;
    if (c.centroid && centres.length) {
      const prox = nearestLmrCentre(
        { type: "Point", coordinates: c.centroid },
        centres,
      );
      if (prox) {
        stationDistanceM = prox.distanceM;
        nearestStationLabel = prox.centre.label;
      }
    }
    // Prefer LMR centre name already on candidate when proximity calc unavailable.
    if (!nearestStationLabel && c.lmrCentre) nearestStationLabel = c.lmrCentre;
    return annotateCandidate(c, areas, { distanceM: stationDistanceM, label: nearestStationLabel }, filters);
  });

  results = results.filter((r) => {
    if (filters.minSiteAreaSqm != null && r.siteAreaSqm < filters.minSiteAreaSqm) return false;
    if (filters.maxSiteAreaSqm != null && r.siteAreaSqm > filters.maxSiteAreaSqm) return false;
    if (filters.singleLotOnly && r.lotCount !== 1) return false;
    if (filters.maxOwners != null && r.owners > filters.maxOwners) return false;
    if (filters.minCurrentFsr != null && (r.currentFsr == null || r.currentFsr < filters.minCurrentFsr)) return false;
    if (filters.maxCurrentFsr != null && (r.currentFsr == null || r.currentFsr > filters.maxCurrentFsr)) return false;
    if (filters.minScore != null && r.score < filters.minScore) return false;
    if (filters.minHeadroom != null && (r.headroom == null || r.headroom < filters.minHeadroom)) return false;
    if (filters.zone && (!r.zone || !r.zone.toUpperCase().includes(filters.zone.toUpperCase()))) return false;
    if (filters.lga) {
      // LGA is not carried on ScanCandidate yet — filter via suburb/label soft match only when present.
      const hay = `${r.suburb ?? ""} ${r.locationLabel}`.toLowerCase();
      if (!hay.includes(filters.lga.toLowerCase())) {
        // Do not exclude when LGA metadata is absent from the scan row.
      }
    }
    if (filters.suburb) {
      const sub = (r.suburb ?? "").toLowerCase();
      const want = filters.suburb.toLowerCase();
      if (sub && !sub.includes(want) && !want.includes(sub)) {
        // Soft: keep if suburb blank (partial scan) but centre query drove the bbox.
      }
    }
    if (filters.excludeStrata && r.isStrata) return false;
    if (
      filters.maxStationDistanceM != null &&
      (r.stationDistanceM == null || r.stationDistanceM > filters.maxStationDistanceM)
    ) {
      return false;
    }

    const proposedOk = matchesProposedFindFilters(
      {
        insidePlanningChangeArea: !!r.planningChangeStatus || r.proposedFsr != null || !!r.keySiteId,
        planningChangeStatus: r.planningChangeStatus,
        proposedZone: null,
        proposedFsr: r.proposedFsr,
        proposedHeight: r.proposedHeight,
        keySiteId: r.keySiteId,
        requiredParcelCount: null,
      },
      {
        insidePlanningChangeArea: filters.insidePlanningChangeArea,
        minProposedFsr: filters.minProposedFsr,
        minProposedHeight: null,
        keySiteId: filters.keySiteOnly ? r.keySiteId : null,
        minRequiredParcelCount: filters.minRequiredParcelCount,
      },
    );
    if (!proposedOk) return false;
    if (filters.keySiteOnly && !r.keySiteId) return false;
    if (filters.minProposedFsr != null && (r.proposedFsr == null || r.proposedFsr < filters.minProposedFsr)) {
      return false;
    }

    // Prefer strategy preferred zones in ranking later — optional soft boost tick.
    if (profile.preferredZones.length && r.zone && profile.preferredZones.some((z) => r.zone!.toUpperCase().startsWith(z.toUpperCase()))) {
      r.whyMatched = [
        ...r.whyMatched,
        { title: `Preferred zone ${r.zone}`, body: `Matches ${profile.name} preferred zones.` },
      ];
    }
    return true;
  });

  results.sort((a, b) => {
    const au = (a.proposedFsr ?? 0) - (a.currentFsr ?? 0);
    const bu = (b.proposedFsr ?? 0) - (b.currentFsr ?? 0);
    if (bu !== au) return bu - au;
    // Prefer closer station when strategy cares about station distance.
    if (filters.maxStationDistanceM != null || profile.maxStationDistanceM != null) {
      const ad = a.stationDistanceM ?? 99999;
      const bd = b.stationDistanceM ?? 99999;
      if (ad !== bd) return ad - bd;
    }
    return b.score - a.score;
  });

  return { filters, results, messages, proposedAreasSource };
}
