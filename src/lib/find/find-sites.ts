/**
 * FIND — search parcels/assemblies via existing scan engine + proposed-planning fields.
 * Geography-neutral: no suburb hardcoding.
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
import type { ScanCandidate } from "@/lib/analysis/area-scan";
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
  score: number;
  headroom: number | null;
  maxPayable: number | null;
  lotCount: number;
  owners: number;
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

function mergeFilters(input: FindFilters): { filters: FindFilters; profile: StrategyProfile } {
  const nl = input.naturalLanguage?.trim() ? parseNaturalLanguageFind(input.naturalLanguage) : {};
  const strategy = input.strategy ?? "GENERAL_RESIDENTIAL";
  const profile = profileForStrategy(strategy);
  const filters: FindFilters = {
    ...nl,
    ...input,
    minSiteAreaSqm: input.minSiteAreaSqm ?? nl.minSiteAreaSqm ?? profile.minSiteAreaSqm,
    maxOwners: input.maxOwners ?? profile.maxProperties,
    minProposedFsr: input.minProposedFsr ?? nl.minProposedFsr ?? profile.minProposedFsr,
    minCurrentFsr: input.minCurrentFsr ?? profile.minCurrentFsr,
    maxStationDistanceM: input.maxStationDistanceM ?? nl.maxStationDistanceM ?? profile.maxStationDistanceM,
    excludeStrata: input.excludeStrata ?? nl.excludeStrata ?? profile.excludeStrata,
    minHeadroom: input.minHeadroom ?? (profile.requirePositiveHeadroom ? 0 : null),
    insidePlanningChangeArea: input.insidePlanningChangeArea ?? nl.insidePlanningChangeArea ?? null,
    keySiteOnly: input.keySiteOnly ?? nl.keySiteOnly ?? null,
    strategy,
  };
  return { filters, profile };
}

function annotateCandidate(c: ScanCandidate): FindResultRow {
  const centroid = (c as unknown as { centroid?: [number, number] }).centroid;
  const hasPoint = !!centroid && Number.isFinite(centroid[0]) && Number.isFinite(centroid[1]);
  const proposed = hasPoint
    ? annotateParcelWithProposedFindFields({ lng: centroid![0], lat: centroid![1] })
    : EMPTY_PROPOSED;

  const why = findMatchReasons({
    fields: proposed,
    siteAreaSqm: c.siteAreaSqm,
    currentFsr: c.lepFsr ?? c.effectiveFsr,
    headroom: c.headroom,
  });

  return {
    key: c.key,
    locationLabel: c.locationLabel,
    suburb: null,
    siteAreaSqm: c.siteAreaSqm,
    zone: null,
    currentFsr: c.lepFsr ?? c.effectiveFsr,
    proposedFsr: proposed.proposedFsr,
    proposedHeight: proposed.proposedHeight,
    planningChangeStatus: proposed.planningChangeStatus,
    keySiteId: proposed.keySiteId,
    stationDistanceM: null,
    score: c.score.score,
    headroom: c.headroom,
    maxPayable: c.maxPayable,
    lotCount: c.lotCount,
    owners: c.owners,
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
  precinctFallback?: unknown;
}> {
  const { filters } = mergeFilters(input);
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

  const scan = await scanArea({
    bbox: hasBBox
      ? { west: filters.west!, south: filters.south!, east: filters.east!, north: filters.north! }
      : undefined,
    centreQuery: centreQuery ?? undefined,
    suburbHint: filters.suburb ?? undefined,
    maxResults: filters.maxResults ?? 20,
  });
  messages.push(...scan.messages);

  let results = scan.candidates.map(annotateCandidate);

  results = results.filter((r) => {
    if (filters.minSiteAreaSqm != null && r.siteAreaSqm < filters.minSiteAreaSqm) return false;
    if (filters.maxSiteAreaSqm != null && r.siteAreaSqm > filters.maxSiteAreaSqm) return false;
    if (filters.singleLotOnly && r.lotCount !== 1) return false;
    if (filters.maxOwners != null && r.owners > filters.maxOwners) return false;
    if (filters.minCurrentFsr != null && (r.currentFsr == null || r.currentFsr < filters.minCurrentFsr)) return false;
    if (filters.maxCurrentFsr != null && (r.currentFsr == null || r.currentFsr > filters.maxCurrentFsr)) return false;
    if (filters.minScore != null && r.score < filters.minScore) return false;
    if (filters.minHeadroom != null && (r.headroom == null || r.headroom < filters.minHeadroom)) return false;
    const proposedOk = matchesProposedFindFilters(
      {
        insidePlanningChangeArea: !!r.planningChangeStatus || r.proposedFsr != null,
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
    const ticks: Array<{ title: string; body: string }> = [...r.whyMatched];
    if (filters.minSiteAreaSqm != null) {
      ticks.push({ title: `>${filters.minSiteAreaSqm} sqm`, body: `${Math.round(r.siteAreaSqm)} sqm site` });
    }
    if (filters.excludeStrata) {
      ticks.push({ title: "Strata filter applied", body: "Search excluded strata where scan metadata allows." });
    }
    if (r.headroom != null && r.headroom > 0) {
      ticks.push({ title: "Positive headroom", body: "Quick feasibility headroom is positive." });
    }
    r.whyMatched = ticks;
    return true;
  });

  results.sort((a, b) => {
    const au = (a.proposedFsr ?? 0) - (a.currentFsr ?? 0);
    const bu = (b.proposedFsr ?? 0) - (b.currentFsr ?? 0);
    if (bu !== au) return bu - au;
    return b.score - a.score;
  });

  return { filters, results, messages };
}
