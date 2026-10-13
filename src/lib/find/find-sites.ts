/**
 * FIND — search development sites.
 * Default path: SiteCandidateIndex (INDEX_DISCOVERY) for fast indexed results.
 * On-demand path: existing live parcel/assembly scan ("Run live deep scan").
 * Geography-neutral: no suburb / council hardcoding.
 */

import { scanArea } from "@/lib/scan-service";
import {
  matchesProposedFindFilters,
  findMatchReasons,
  profileForStrategy,
  resolveProposedPlanningForPoint,
  type StrategyProfile,
  type ProposedPlanningFindFields,
} from "@/lib/source-watcher";
import type { ScanCandidate } from "@/lib/analysis/area-scan";
import { nearestLmrCentre } from "@/lib/data-sources/housing-sepp-lmr";
import { fetchTrainStations, nearestTrainStation } from "@/lib/data-sources/nsw-train-stations";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { parseNaturalLanguageFind } from "./nl-parse";
import type { FindFilters } from "./find-filters-types";
import { resolveDisplayScore, type ScoreProvenance } from "@/lib/intelligence/display-score";
import { loadLinkedOpportunityScoresByCanonicalKey } from "@/lib/intelligence/linked-opportunity-scores";

export type { FindFilters } from "./find-filters-types";
export { parseNaturalLanguageFind } from "./nl-parse";
export { findResultMapHref, type FindMapHrefInput } from "@/lib/find/find-map-href";

export interface FindResultRow {
  key: string;
  /** SiteCandidateIndex row id — set for index-mode results only. */
  candidateId?: string | null;
  locationLabel: string;
  suburb: string | null;
  lga: string | null;
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
  scoreProvenance?: ScoreProvenance;
  headroom: number | null;
  maxPayable: number | null;
  lotCount: number;
  /** Confirmed owners only — null when unknown (INDEX_DISCOVERY never invents from lot count). */
  owners: number | null;
  isStrata: boolean;
  whyMatched: Array<{ title: string; body: string }>;
  opportunityId: string | null;
  lotIds: string[];
  bboxHint: { west: number; south: number; east: number; north: number } | null;
}

export type FindAppliedFilter = { label: string; value: string };

export type FindResponse = {
  filters: FindFilters;
  results: FindResultRow[];
  /** Short user-facing status lines only. */
  messages: string[];
  /** Engineering / PERF / funnel detail — UI shows collapsed. */
  diagnostics: string[];
  source: "index" | "live";
  assessedCount: number;
  matchedCount: number;
  elapsedMs: number;
  appliedFilters: FindAppliedFilter[];
  proposedAreasSource?: string;
  precinctFallback?: unknown;
};

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

function normPlace(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Deterministic place match — filter value must appear in candidate metadata. */
export function placeMatches(filter: string, candidate: string | null | undefined): boolean {
  if (!candidate) return false;
  const f = normPlace(filter);
  const c = normPlace(candidate);
  if (!f || !c) return false;
  return c === f || c.includes(f) || f.includes(c);
}

/**
 * Merge UI + NL into hard filters.
 * Strategy presets may affect ranking only — never silent hard filters.
 * Blank Minimum Headroom → minHeadroom=null (never requirePositiveHeadroom→0).
 */
export function mergeFilters(input: FindFilters): { filters: FindFilters; profile: StrategyProfile } {
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
    // Explicit UI / NL only — do not pull invisible hard floors from strategy presets.
    minSiteAreaSqm: pickValue(input.minSiteAreaSqm, nl.minSiteAreaSqm, null),
    maxSiteAreaSqm: pickValue(input.maxSiteAreaSqm, nl.maxSiteAreaSqm, null),
    maxOwners: pickValue(input.maxOwners, nl.maxOwners, null),
    minProposedFsr: pickValue(input.minProposedFsr, nl.minProposedFsr, null),
    minCurrentFsr: pickValue(input.minCurrentFsr, nl.minCurrentFsr, null),
    maxCurrentFsr: pickValue(input.maxCurrentFsr, nl.maxCurrentFsr, null),
    maxStationDistanceM: pickValue(input.maxStationDistanceM, nl.maxStationDistanceM, null),
    excludeStrata: pickValue(input.excludeStrata, nl.excludeStrata, false) ?? false,
    // Critical: blank headroom must stay null — never invent 0 from requirePositiveHeadroom.
    minHeadroom: pickValue(input.minHeadroom, nl.minHeadroom, null),
    insidePlanningChangeArea: pickValue(input.insidePlanningChangeArea, nl.insidePlanningChangeArea, null),
    keySiteOnly: pickValue(input.keySiteOnly, nl.keySiteOnly, null),
    zone: pickValue(input.zone, nl.zone, null),
    lga: pickValue(input.lga, nl.lga, null),
    minRequiredParcelCount: pickValue(input.minRequiredParcelCount, nl.minRequiredParcelCount, null),
    minScore: pickValue(input.minScore, nl.minScore, null),
    strategy,
    mode: input.mode === "live" ? "live" : "index",
  };
  return { filters, profile };
}

export function describeAppliedFilters(filters: FindFilters): FindAppliedFilter[] {
  const out: FindAppliedFilter[] = [];
  if (filters.strategy) out.push({ label: "Strategy", value: filters.strategy.replace(/_/g, " ") });
  if (filters.suburb) out.push({ label: "Suburb", value: filters.suburb });
  if (filters.lga) out.push({ label: "LGA", value: filters.lga });
  if (filters.minSiteAreaSqm != null) out.push({ label: "Min site area", value: `${filters.minSiteAreaSqm} sqm` });
  if (filters.minProposedFsr != null) out.push({ label: "Min proposed FSR", value: String(filters.minProposedFsr) });
  if (filters.minHeadroom != null) out.push({ label: "Min headroom", value: `$${filters.minHeadroom}` });
  if (filters.excludeStrata) out.push({ label: "Exclude strata", value: "yes" });
  if (filters.maxStationDistanceM != null) {
    out.push({ label: "Max station distance", value: `${filters.maxStationDistanceM}m` });
  }
  if (filters.insidePlanningChangeArea) out.push({ label: "Inside planning change area", value: "yes" });
  if (filters.keySiteOnly) out.push({ label: "Key site only", value: "yes" });
  if (filters.zone) out.push({ label: "Zone", value: filters.zone });
  if (filters.maxOwners != null) out.push({ label: "Max owners", value: String(filters.maxOwners) });
  return out;
}

function annotateCandidate(
  c: ScanCandidate,
  station: { distanceM: number | null; label: string | null },
  filters: FindFilters,
  proposed: ProposedPlanningFindFields,
): FindResultRow {
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
    // Ranking / explanation only — hard headroom filter uses filters.minHeadroom separately.
    requirePositiveHeadroom: false,
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
    lga: c.lga,
    siteAreaSqm: c.siteAreaSqm,
    zone: c.zone,
    currentFsr: c.lepFsr ?? c.effectiveFsr,
    proposedFsr: proposed.proposedFsr,
    proposedHeight: proposed.proposedHeight,
    planningChangeStatus: proposed.planningChangeStatus,
    keySiteId: proposed.keySiteId,
    stationDistanceM: station.distanceM,
    nearestStationLabel: station.label,
    score: resolveDisplayScore({ screeningScore: c.score.score }).score,
    scoreProvenance: "SCREENING",
    headroom: c.headroom,
    maxPayable: c.maxPayable,
    lotCount: c.lotCount,
    // Lot count is not proven owner count — leave unknown unless title data exists.
    owners: null,
    isStrata: c.isStrata,
    whyMatched: why.map((w) => ({ title: w.title, body: w.body })),
    opportunityId: c.canonicalOpportunityId ?? null,
    lotIds: c.lotIds,
    bboxHint: null,
  };
}

function passesHardFilters(r: FindResultRow, filters: FindFilters): boolean {
  if (filters.minSiteAreaSqm != null && r.siteAreaSqm < filters.minSiteAreaSqm) return false;
  if (filters.maxSiteAreaSqm != null && r.siteAreaSqm > filters.maxSiteAreaSqm) return false;
  if (filters.singleLotOnly && r.lotCount !== 1) return false;
  if (filters.maxOwners != null && r.owners != null && r.owners > filters.maxOwners) return false;
  if (filters.minCurrentFsr != null && (r.currentFsr == null || r.currentFsr < filters.minCurrentFsr)) return false;
  if (filters.maxCurrentFsr != null && (r.currentFsr == null || r.currentFsr > filters.maxCurrentFsr)) return false;
  if (filters.minScore != null && r.score < filters.minScore) return false;
  // Only when user explicitly set a minimum — unknown/negative headroom otherwise allowed.
  if (filters.minHeadroom != null && (r.headroom == null || r.headroom < filters.minHeadroom)) return false;
  if (filters.zone && (!r.zone || !r.zone.toUpperCase().includes(filters.zone.toUpperCase()))) return false;

  if (filters.lga) {
    if (!placeMatches(filters.lga, r.lga)) return false;
  }
  if (filters.suburb) {
    if (!placeMatches(filters.suburb, r.suburb) && !placeMatches(filters.suburb, r.lga)) return false;
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
  return true;
}

function rankResults(results: FindResultRow[], filters: FindFilters, profile: StrategyProfile): FindResultRow[] {
  const ranked = [...results];
  for (const r of ranked) {
    // Ranking boosts apply only to SCREENING scores — DETAILED Opportunity.score stays as persisted.
    if (r.scoreProvenance !== "DETAILED") {
      if (
        profile.preferredZones.length &&
        r.zone &&
        profile.preferredZones.some((z) => r.zone!.toUpperCase().startsWith(z.toUpperCase()))
      ) {
        if (!r.whyMatched.some((w) => w.title.startsWith("Preferred zone"))) {
          r.whyMatched = [
            ...r.whyMatched,
            { title: `Preferred zone ${r.zone}`, body: `Matches ${profile.name} preferred zones.` },
          ];
        }
        r.score += 8;
      }
      // Ranking preference only — does not exclude negative/unknown headroom.
      if (profile.requirePositiveHeadroom && r.headroom != null && r.headroom > 0) {
        r.score += 6;
      }
      const clamped = resolveDisplayScore({ screeningScore: r.score });
      r.score = clamped.score;
      r.scoreProvenance = "SCREENING";
    }
  }
  ranked.sort((a, b) => {
    const au = (a.proposedFsr ?? 0) - (a.currentFsr ?? 0);
    const bu = (b.proposedFsr ?? 0) - (b.currentFsr ?? 0);
    if (bu !== au) return bu - au;
    if (filters.maxStationDistanceM != null || profile.maxStationDistanceM != null) {
      const ad = a.stationDistanceM ?? 99999;
      const bd = b.stationDistanceM ?? 99999;
      if (ad !== bd) return ad - bd;
    }
    return b.score - a.score;
  });
  return ranked;
}

/**
 * DB place scope for index Find — applied BEFORE orderBy/take.
 * Matches suburb and LGA (e.g. "Parramatta" → suburb or "CITY OF PARRAMATTA").
 * Address is optional fallback only when suburb/LGA return nothing.
 */
export function buildIndexPlaceWhere(place: string): Prisma.SiteCandidateIndexWhereInput {
  const p = place.trim();
  return {
    OR: [
      { suburb: { equals: p, mode: "insensitive" } },
      { suburb: { contains: p, mode: "insensitive" } },
      { lga: { equals: p, mode: "insensitive" } },
      { lga: { contains: p, mode: "insensitive" } },
    ],
  };
}

/**
 * Pure helper for regression: place-scope first, then take top N by score.
 * Proves a lower-scoring in-place row survives when out-of-place rows dominate globally.
 */
export function placeScopeThenTake<T extends { suburb?: string | null; lga?: string | null; address?: string | null; quickScore?: number | null }>(
  rows: T[],
  place: string | null,
  take: number,
): T[] {
  const scoped = place
    ? rows.filter(
        (r) => placeMatches(place, r.suburb) || placeMatches(place, r.lga) || placeMatches(place, r.address),
      )
    : rows;
  return [...scoped]
    .sort((a, b) => (b.quickScore ?? 0) - (a.quickScore ?? 0))
    .slice(0, take);
}

async function findFromIndex(
  filters: FindFilters,
  profile: StrategyProfile,
): Promise<{ results: FindResultRow[]; assessedCount: number; diagnostics: string[] }> {
  const diagnostics: string[] = [];
  const place = (filters.suburb ?? filters.lga ?? filters.centreQuery ?? null)?.trim() || null;
  // Cap after place scope — never "global top N then filter place in memory".
  const take = Math.min(Math.max((filters.maxResults ?? 15) * 20, 120), 500);

  const baseWhere: Prisma.SiteCandidateIndexWhereInput = {
    lifecycleStatus: "ACTIVE",
    provenance: "INDEX_DISCOVERY",
  };

  const linkedScores = await loadLinkedOpportunityScoresByCanonicalKey();

  let rows = await prisma.siteCandidateIndex.findMany({
    where: place ? { AND: [baseWhere, buildIndexPlaceWhere(place)] } : baseWhere,
    orderBy: [{ quickScore: "desc" }, { updatedAt: "desc" }],
    take,
  });
  diagnostics.push(
    place
      ? `Index fetch (place-scoped): ${rows.length} rows for "${place}" (cap ${take}).`
      : `Index fetch: ${rows.length} ACTIVE INDEX_DISCOVERY rows (cap ${take}).`,
  );

  // Address fallback only when suburb/LGA scope returned nothing.
  if (place && rows.length === 0) {
    rows = await prisma.siteCandidateIndex.findMany({
      where: {
        AND: [
          baseWhere,
          { address: { contains: place, mode: "insensitive" } },
        ],
      },
      orderBy: [{ quickScore: "desc" }, { updatedAt: "desc" }],
      take,
    });
    diagnostics.push(`Index address fallback: ${rows.length} rows for "${place}".`);
  }

  const mapped: FindResultRow[] = rows.map((r) => {
    const flags =
      r.planningChangeFlags && typeof r.planningChangeFlags === "object"
        ? (r.planningChangeFlags as Record<string, unknown>)
        : {};
    const keySiteId =
      typeof flags.keySiteId === "string"
        ? flags.keySiteId
        : r.keySiteStatus?.match(/Key site\s+(\S+)/i)?.[1] ?? null;
    const planningChangeStatus =
      typeof flags.planningChangeStatus === "string"
        ? flags.planningChangeStatus
        : flags.insidePlanningChangeArea
          ? "PLANNING_CHANGE"
          : null;
    const reasons = Array.isArray(r.reasonHints)
      ? (r.reasonHints as string[]).map((t) => ({ title: t, body: "From Sydney candidate index." }))
      : [];
    const parcelIds = Array.isArray(r.parcelIds) ? (r.parcelIds as string[]) : [];
    const cachedScore =
      r.strategyScores && typeof r.strategyScores === "object"
        ? (r.strategyScores as Record<string, number>)[profile.strategy]
        : undefined;
    const screening = typeof cachedScore === "number" ? cachedScore : (r.quickScore ?? 40);
    const linked = linkedScores.get(r.canonicalKey);
    const opportunityId = r.opportunityId ?? linked?.opportunityId ?? null;
    const display = resolveDisplayScore({
      screeningScore: screening,
      opportunityId,
      opportunityScore: linked?.score ?? null,
    });
    return {
      key: r.canonicalKey,
      candidateId: r.id,
      locationLabel: r.address ?? r.suburb ?? r.canonicalKey,
      suburb: r.suburb,
      lga: r.lga,
      siteAreaSqm: r.siteAreaSqm ?? 0,
      zone: r.zone,
      currentFsr: r.currentFsr,
      proposedFsr: r.proposedFsr,
      proposedHeight: r.proposedHeightM,
      planningChangeStatus,
      keySiteId,
      stationDistanceM: r.stationDistanceM,
      nearestStationLabel: null,
      score: display.score,
      scoreProvenance: display.provenance,
      headroom: r.quickHeadroom,
      maxPayable: r.maxPayable,
      lotCount: r.lotCount ?? parcelIds.length,
      // Never invent owners from lot count for INDEX_DISCOVERY.
      owners: null,
      // Index assemblies are generated from non-strata seeds; treat as non-strata for Find.
      isStrata: false,
      whyMatched: reasons.length
        ? reasons
        : [{ title: "Indexed candidate", body: "Active INDEX_DISCOVERY site from the Sydney baseline." }],
      opportunityId,
      lotIds: parcelIds,
      // Never expose discovery-tile bbox to the client map link.
      bboxHint: null,
    };
  });

  const matched = mapped.filter((r) => passesHardFilters(r, filters));
  return {
    results: rankResults(matched, filters, profile).slice(0, filters.maxResults ?? 15),
    assessedCount: rows.length,
    diagnostics,
  };
}

async function findFromLiveScan(
  filters: FindFilters,
  profile: StrategyProfile,
): Promise<{
  results: FindResultRow[];
  assessedCount: number;
  diagnostics: string[];
  proposedAreasSource?: string;
}> {
  const diagnostics: string[] = [];
  const hasBBox =
    filters.west != null && filters.south != null && filters.east != null && filters.north != null;
  const centreQuery = filters.centreQuery ?? filters.suburb ?? null;

  const scan = await scanArea({
    bbox: hasBBox
      ? { west: filters.west!, south: filters.south!, east: filters.east!, north: filters.north! }
      : undefined,
    centreQuery: centreQuery ?? undefined,
    suburbHint: filters.suburb ?? undefined,
    maxResults: filters.maxResults ?? 20,
    minSiteAreaSqm: filters.minSiteAreaSqm ?? undefined,
  });
  diagnostics.push(...scan.messages);

  const centres = scan.centres ?? [];
  const stationPad = Math.max(filters.maxStationDistanceM ?? 800, 800) / 111_320 + 0.01;
  const stations = await fetchTrainStations({
    west: scan.bbox.west - stationPad,
    south: scan.bbox.south - stationPad,
    east: scan.bbox.east + stationPad,
    north: scan.bbox.north + stationPad,
  });
  if (stations.length) {
    diagnostics.push(`Station proximity: ${stations.length} official NSW train/metro stops in search envelope.`);
  }

  const proposedByKey = new Map<string, ProposedPlanningFindFields>();
  let proposedAreasSource: string | undefined;
  await Promise.all(
    scan.candidates.map(async (c) => {
      if (!c.centroid) {
        proposedByKey.set(c.key, EMPTY_PROPOSED);
        return;
      }
      const resolved = await resolveProposedPlanningForPoint({
        lng: c.centroid[0],
        lat: c.centroid[1],
      });
      proposedAreasSource = resolved.areasSource;
      proposedByKey.set(c.key, resolved);
    }),
  );
  if (proposedAreasSource === "fixture_fallback") {
    diagnostics.push("Proposed planning annotation using fixture fallback (no persisted PlanningChangeArea rows).");
  }

  let results = scan.candidates.map((c) => {
    let stationDistanceM: number | null = null;
    let nearestStationLabel: string | null = null;
    if (c.centroid) {
      const train = nearestTrainStation({ lng: c.centroid[0], lat: c.centroid[1] }, stations);
      if (train) {
        stationDistanceM = train.distanceM;
        nearestStationLabel = train.station.label;
      } else if (centres.length) {
        const prox = nearestLmrCentre({ type: "Point", coordinates: c.centroid }, centres);
        if (prox) {
          stationDistanceM = prox.distanceM;
          nearestStationLabel = prox.centre.label;
        }
      }
    }
    if (!nearestStationLabel && c.lmrCentre) nearestStationLabel = c.lmrCentre;
    return annotateCandidate(
      c,
      { distanceM: stationDistanceM, label: nearestStationLabel },
      filters,
      proposedByKey.get(c.key) ?? EMPTY_PROPOSED,
    );
  });

  const assessedCount = results.length;
  results = results.filter((r) => passesHardFilters(r, filters));
  results = rankResults(results, filters, profile);

  return {
    results: results.slice(0, filters.maxResults ?? 15),
    assessedCount,
    diagnostics,
    proposedAreasSource,
  };
}

export async function findDevelopmentSites(input: FindFilters): Promise<FindResponse> {
  const started = performance.now();
  const { filters, profile } = mergeFilters(input);
  const appliedFilters = describeAppliedFilters(filters);
  const hasBBox =
    filters.west != null && filters.south != null && filters.east != null && filters.north != null;
  const centreQuery = filters.centreQuery ?? filters.suburb ?? null;

  if (!hasBBox && !centreQuery) {
    return {
      filters,
      results: [],
      messages: ["Provide a suburb / centre query or draw a map area to search."],
      diagnostics: [],
      source: filters.mode === "live" ? "live" : "index",
      assessedCount: 0,
      matchedCount: 0,
      elapsedMs: Math.round(performance.now() - started),
      appliedFilters,
    };
  }

  const mode = filters.mode === "live" ? "live" : "index";

  if (mode === "index") {
    const indexed = await findFromIndex(filters, profile);
    const elapsedMs = Math.round(performance.now() - started);
    const placeLabel = filters.suburb ?? filters.lga ?? filters.centreQuery ?? "this area";
    const messages: string[] = [];
    if (indexed.results.length) {
      messages.push(`${indexed.results.length} candidate site${indexed.results.length === 1 ? "" : "s"} found in ${placeLabel}`);
    } else if (indexed.assessedCount > 0) {
      messages.push(
        `No sites matched your current filters. ${indexed.assessedCount} candidate${indexed.assessedCount === 1 ? "" : "s"} assessed; 0 matched.`,
      );
    } else {
      messages.push(
        `No indexed candidates yet for ${placeLabel}. Try Run live deep scan, or wait for more Sydney index batches.`,
      );
    }
    return {
      filters,
      results: indexed.results,
      messages,
      diagnostics: indexed.diagnostics,
      source: "index",
      assessedCount: indexed.assessedCount,
      matchedCount: indexed.results.length,
      elapsedMs,
      appliedFilters,
    };
  }

  const live = await findFromLiveScan(filters, profile);
  const elapsedMs = Math.round(performance.now() - started);
  const placeLabel = filters.suburb ?? filters.lga ?? filters.centreQuery ?? "this area";
  const messages: string[] = [];
  if (live.results.length) {
    messages.push(
      `Live scan completed · ${live.results.length} candidate${live.results.length === 1 ? "" : "s"} · ${Math.round(elapsedMs / 1000)} sec`,
    );
  } else if (live.assessedCount > 0) {
    messages.push(
      `No sites matched your current filters. ${live.assessedCount} candidate${live.assessedCount === 1 ? "" : "s"} assessed; 0 matched.`,
    );
  } else {
    messages.push(`Live scan completed in ${placeLabel} · no candidate sites ranked.`);
  }

  return {
    filters,
    results: live.results,
    messages,
    diagnostics: live.diagnostics,
    source: "live",
    assessedCount: live.assessedCount,
    matchedCount: live.results.length,
    elapsedMs,
    appliedFilters,
    proposedAreasSource: live.proposedAreasSource,
  };
}

