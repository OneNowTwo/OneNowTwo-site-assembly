/**
 * TODAY — Sydney development intelligence.
 * Stories (not raw events) · SiteCandidateIndex · personal watched · DA/HDA/SSD activity.
 */

import { prisma } from "@/lib/db";
import { listWatchItems } from "./watchlist";
import { listFeed } from "./feed";
import { getLatestMorningReport } from "./morning-report";
import type { StrategyProfile } from "@/lib/source-watcher/strategy-profile";
import { DEFAULT_STRATEGY_PROFILE } from "@/lib/source-watcher/strategy-profile";
import {
  isFixtureOnlySource,
  presentSourceForUser,
} from "./source-presentation";
import { isMaterialForToday } from "@/lib/intelligence/material-change";
import { aggregateIntelligenceStories } from "@/lib/intelligence/stories";
import {
  listTodaySiteCandidates,
  refreshSiteCandidateIndexFromKnownEntities,
} from "@/lib/intelligence/site-candidate-index";
import { getMarketScope } from "@/lib/market-scope";
import { buildMapHref } from "@/lib/map/map-target";

function feedPayloadSourceId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.sourceId === "string") return p.sourceId;
  if (typeof p.changeKey === "string" && p.changeKey.startsWith("fixture-")) return p.changeKey.split(":")[0]!;
  return null;
}

function eventIntersectsWatch(
  e: {
    watchItemIds: unknown;
    payload: unknown;
    newValue: unknown;
    title: string;
    summary: string | null;
  },
  watching: Array<{
    id: string;
    kind: string;
    label: string;
    suburb: string | null;
    opportunityId: string | null;
    externalParcelId: string | null;
  }>,
): boolean {
  const ids = e.watchItemIds as string[] | null;
  if (Array.isArray(ids) && ids.some((id) => watching.some((w) => w.id === id))) return true;

  const payload = (e.payload ?? e.newValue ?? {}) as Record<string, unknown>;
  const hay = `${e.title} ${e.summary ?? ""} ${JSON.stringify(payload)}`.toLowerCase();

  for (const w of watching) {
    if (w.suburb && hay.includes(w.suburb.toLowerCase())) return true;
    if (w.label && hay.includes(w.label.toLowerCase())) return true;
    if (w.externalParcelId && hay.includes(w.externalParcelId.toLowerCase())) return true;
    if (w.opportunityId && hay.includes(w.opportunityId.toLowerCase())) return true;
  }
  return false;
}

export async function getTodayIntelligence(userId: string, profile: StrategyProfile = DEFAULT_STRATEGY_PROFILE) {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 7);
  const market = getMarketScope("sydney-metro");

  // Ensure index has something useful for a fresh Harry account (cheap upsert from known entities).
  const candidateCount = await prisma.siteCandidateIndex.count({ where: { lifecycleStatus: "ACTIVE" } });
  if (candidateCount < 5) {
    try {
      await refreshSiteCandidateIndexFromKnownEntities({ includeOpportunities: true });
    } catch {
      // Index refresh is best-effort; Today still serves stories.
    }
  }

  const [watching, feed, morning, pipeline, intelEvents, sourceFreshness, activityEvents, sitesToLookAt] =
    await Promise.all([
      listWatchItems(userId),
      listFeed({ sort: "importance", limit: 20 }),
      getLatestMorningReport(userId),
      prisma.opportunity.groupBy({
        by: ["status"],
        _count: { _all: true },
        where: { lifecycleStatus: "ACTIVE" },
      }),
      prisma.intelChangeEvent.findMany({
        where: {
          createdAt: { gte: since },
          lifecycleStatus: "ACTIVE",
        },
        orderBy: [{ importance: "desc" }, { createdAt: "desc" }],
        take: 80,
      }),
      prisma.sourceRegistry.findMany({
        where: { enabled: true },
        select: {
          id: true,
          name: true,
          category: true,
          lastCheckedAt: true,
          lastSuccessfulAt: true,
        },
        orderBy: { name: "asc" },
        take: 40,
      }),
      prisma.intelChangeEvent.findMany({
        where: {
          createdAt: { gte: since },
          lifecycleStatus: "ACTIVE",
          material: true,
          kind: {
            in: [
              "HDA_RECORD_PUBLISHED",
              "HDA_RECOMMENDATION_CHANGED",
              "SSD_DECLARED",
              "SSD_STATUS_CHANGED",
              "DA_LODGED",
              "DA_APPROVED",
              "PCC_ISSUED",
            ],
          },
        },
        orderBy: { createdAt: "desc" },
        take: 15,
      }),
      listTodaySiteCandidates(profile, { limit: 10 }),
    ]);

  const productionEvents = intelEvents.filter(
    (e) => !isFixtureOnlySource(e.sourceId) && isMaterialForToday(e),
  );

  const topStories = aggregateIntelligenceStories(productionEvents, profile, { maxStories: 5 }).map((s) => {
    const presented = presentSourceForUser(
      productionEvents.find((e) => s.eventIds.includes(e.id))?.sourceId ?? null,
    );
    return {
      ...s,
      sourceLabel: presented?.label ?? s.sourceLabel,
      sourceHref: presented?.href ?? s.sourceHref,
      type: s.kind,
      location: s.locationLabel,
    };
  });

  // Watched = genuine intersection only (no "watches anything + high importance anywhere").
  const watchedChanges = productionEvents
    .filter((e) => eventIntersectsWatch(e, watching))
    .slice(0, 10)
    .map((e) => ({
      id: e.id,
      type: e.kind,
      title: e.title.replace(/SOURCE_DOCUMENT_CHANGED\s*—\s*/i, ""),
      summary: e.summary,
      date: e.createdAt.toISOString(),
      href: e.href?.startsWith("/map")
        ? e.href
        : buildMapHref({}),
    }));

  const storyEventIds = new Set(topStories.flatMap((s) => s.eventIds));
  const developmentActivity = activityEvents
    .filter((e) => !storyEventIds.has(e.id) && isMaterialForToday(e))
    .slice(0, 10)
    .map((e) => {
      const payload = (e.payload ?? e.newValue ?? {}) as Record<string, unknown>;
      const lat = typeof payload.lat === "number" ? payload.lat : null;
      const lng = typeof payload.lng === "number" ? payload.lng : null;
      return {
        id: e.id,
        kind: e.kind,
        title: e.title,
        summary: e.summary,
        href:
          e.href ??
          (lat != null && lng != null
            ? buildMapHref({ lat, lng, zoom: 16, activityId: e.id })
            : null),
        createdAt: e.createdAt.toISOString(),
      };
    });

  const pipelineMap: Record<string, number> = {};
  for (const row of pipeline) pipelineMap[row.status] = row._count._all;

  return {
    headline: "Development Intelligence",
    subheading: `What changed across ${market.label} — sites that deserve attention for your strategy.`,
    strategy: profile.strategy,
    marketScope: {
      id: market.id,
      label: market.label,
      headerLabel: market.headerLabel,
    },
    /** Section A — aggregated stories (not raw IntelChangeEvent rows). */
    topIntelligence: topStories,
    /** Back-compat alias used by older client fields. */
    whatChanged: topStories.map((s) => ({
      id: s.id,
      type: s.kind,
      location: s.locationLabel,
      title: s.title,
      whatChanged: s.whatChanged,
      whyItMatters: s.whyItMatters,
      affectedSites: s.affectedSiteCount,
      date: s.date,
      sourceId: s.sourceLabel,
      sourceLabel: s.sourceLabel,
      sourceHref: s.sourceHref,
      href: s.mapHref,
      findHref: s.findHref,
      mapHref: s.mapHref,
      eventCount: s.eventCount,
    })),
    /** Section B — unique Sydney candidates from SiteCandidateIndex. */
    sitesToLookAt: sitesToLookAt.map((s) => ({
      id: s.id,
      name: s.name,
      address: s.address,
      suburb: s.suburb,
      siteAreaSqm: s.siteAreaSqm,
      currentFsr: s.currentFsr,
      proposedFsr: s.proposedFsr,
      score: s.score,
      maxPayable: s.maxPayable,
      headroom: s.headroom,
      reasons: s.reasons,
      status: s.status,
      kind: s.kind,
      href: s.href,
      sourceLabel: s.sourceLabel ?? null,
      sourceHref: s.sourceHref ?? null,
    })),
    watchedChanges,
    developmentActivity,
    sourceFreshness: sourceFreshness
      .filter((s) => !isFixtureOnlySource(s.id))
      .map((s) => {
        const presented = presentSourceForUser(s.id);
        return {
          id: s.id,
          name: presented?.label ?? s.name,
          category: s.category,
          lastCheckedAt: s.lastCheckedAt?.toISOString() ?? null,
          lastSuccessfulAt: s.lastSuccessfulAt?.toISOString() ?? null,
        };
      }),
    watching: {
      areas: watching.filter((w) => w.kind === "SUBURB" || w.kind === "MAP_AREA" || w.kind === "PRECINCT"),
      parcels: watching.filter((w) => w.kind === "PARCEL"),
      assemblies: watching.filter((w) => w.kind === "OPPORTUNITY"),
    },
    pipeline: {
      ANALYSING: pipelineMap.ANALYSING ?? 0,
      FEASIBLE: pipelineMap.FEASIBLE ?? 0,
      ACQUIRING: pipelineMap.ACQUIRING ?? 0,
      CONTROLLED: pipelineMap.CONTROLLED ?? 0,
      REJECTED: pipelineMap.REJECTED ?? 0,
      HOLD: pipelineMap.HOLD ?? 0,
      WATCHING: pipelineMap.WATCHING ?? 0,
    },
    morningReport: morning,
    feed: feed.filter((f) => !isFixtureOnlySource(feedPayloadSourceId(f.payload))),
    stats: {
      storyCount: topStories.length,
      candidateCount: sitesToLookAt.length,
      indexSize: candidateCount,
    },
  };
}
