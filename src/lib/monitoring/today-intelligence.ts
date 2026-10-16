/**
 * TODAY — Greater Sydney decision screen (read-only).
 * Reads persisted IntelligenceStory + SiteCandidateIndex (INDEX_DISCOVERY).
 * Never indexes, never seeds from Opportunities, never shows engineering language.
 */

import { prisma } from "@/lib/db";
import { listWatchItems } from "./watchlist";
import { getLatestMorningReport } from "./morning-report";
import type { StrategyProfile } from "@/lib/source-watcher/strategy-profile";
import { DEFAULT_STRATEGY_PROFILE } from "@/lib/source-watcher/strategy-profile";
import { isMaterialForToday } from "@/lib/intelligence/material-change";
import { listTodaySiteCandidates } from "@/lib/intelligence/site-candidate-index";
import { listPersistedStoriesForToday } from "@/lib/intelligence/persist-stories";
import { getMarketScope } from "@/lib/market-scope";
import { buildMapHref } from "@/lib/map/map-target";
import {
  presentTodayStory,
  todayOrientationLine,
  todayPageSubheading,
} from "@/lib/intelligence/today-agent-copy";

const ENGINEERING_RE =
  /SOURCE_DOCUMENT_CHANGED|NEEDS_RE_EXTRACTION|SOURCE_REFRESHED|content hash|parser|snapshot|fixture|structured map-pack|canonical sync|bodyHash|documentHash/i;

function cleanText(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(ENGINEERING_RE, "").replace(/\s{2,}/g, " ").trim();
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
    label: string;
    suburb: string | null;
    opportunityId: string | null;
    externalParcelId: string | null;
  }>,
): boolean {
  if (!watching.length) return false;
  const ids = e.watchItemIds as string[] | null;
  if (Array.isArray(ids) && ids.some((id) => watching.some((w) => w.id === id))) return true;
  const payload = (e.payload ?? e.newValue ?? {}) as Record<string, unknown>;
  const hay = `${e.title} ${e.summary ?? ""} ${JSON.stringify(payload)}`.toLowerCase();
  for (const w of watching) {
    if (w.suburb && hay.includes(w.suburb.toLowerCase())) return true;
    if (w.label && w.label.length > 3 && hay.includes(w.label.toLowerCase())) return true;
    if (w.externalParcelId && hay.includes(w.externalParcelId.toLowerCase())) return true;
    if (w.opportunityId && hay.includes(w.opportunityId.toLowerCase())) return true;
  }
  return false;
}

export async function getTodayIntelligence(userId: string, profile: StrategyProfile = DEFAULT_STRATEGY_PROFILE) {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 7);
  const market = getMarketScope("sydney-metro");

  const [watching, morning, pipeline, siteResult, persistedStories, activityEvents, sourceFreshness] =
    await Promise.all([
      listWatchItems(userId),
      getLatestMorningReport(userId),
      prisma.opportunity.groupBy({
        by: ["status"],
        _count: { _all: true },
        where: { lifecycleStatus: "ACTIVE" },
      }),
      listTodaySiteCandidates(profile, { limit: 10 }),
      listPersistedStoriesForToday(profile.strategy, 5),
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
        take: 12,
      }),
      prisma.sourceRegistry.findMany({
        where: { enabled: true },
        select: { id: true, name: true, category: true, lastCheckedAt: true, lastSuccessfulAt: true },
        orderBy: { name: "asc" },
        take: 40,
      }),
    ]);

  const topIntelligence = persistedStories
    .filter((s) => !ENGINEERING_RE.test(`${s.title} ${s.summary ?? ""}`))
    .slice(0, 5)
    .map((s) => {
      const payload = (s.payload ?? {}) as Record<string, unknown>;
      const what =
        typeof payload.whatChanged === "string" ? String(payload.whatChanged) : (s.summary ?? s.title);
      const whyRaw =
        typeof payload.whyItMatters === "string" && payload.whyItMatters.trim()
          ? String(payload.whyItMatters)
          : null;
      const presented = presentTodayStory(
        {
          type: s.kind,
          location: s.locationLabel,
          title: cleanText(s.title),
          whatChanged: cleanText(what),
          whyItMatters: whyRaw ? cleanText(whyRaw) : null,
          affectedSites: s.affectedSiteCount,
        },
        profile.strategy,
      );
      return {
        id: s.id,
        type: s.kind,
        location: s.locationLabel,
        title: presented.title,
        whatChanged: presented.explanation,
        whyItMatters: presented.explanation,
        typeLabel: presented.typeLabel,
        affectedSites: s.affectedSiteCount,
        date: s.updatedAt.toISOString(),
        sourceId: typeof payload.sourceLabel === "string" ? payload.sourceLabel : null,
        sourceLabel: typeof payload.sourceLabel === "string" ? payload.sourceLabel : null,
        sourceHref: s.sourceHref,
        href: s.mapHref,
        mapHref: s.mapHref,
        findHref: s.findHref,
        eventCount: typeof payload.eventCount === "number" ? payload.eventCount : null,
      };
    });

  const storyTitles = new Set(topIntelligence.map((s) => s.title.toLowerCase()));

  const developmentActivity = activityEvents
    .filter((e) => isMaterialForToday(e) && !ENGINEERING_RE.test(e.title + (e.summary ?? "")))
    .filter((e) => !storyTitles.has(cleanText(e.title).toLowerCase()))
    .slice(0, 6)
    .map((e) => {
      const payload = (e.payload ?? e.newValue ?? {}) as Record<string, unknown>;
      const lat = typeof payload.lat === "number" ? payload.lat : null;
      const lng = typeof payload.lng === "number" ? payload.lng : null;
      return {
        id: e.id,
        kind: e.kind,
        title: cleanText(e.title),
        summary: cleanText(e.summary),
        href:
          e.href && !ENGINEERING_RE.test(e.href)
            ? e.href
            : lat != null && lng != null
              ? buildMapHref({ lat, lng, zoom: 16, activityId: e.id })
              : null,
        createdAt: e.createdAt.toISOString(),
      };
    });

  let watchedChanges: Array<{
    id: string;
    type: string;
    title: string;
    summary: string | null;
    date: string;
    href: string | null;
  }> = [];
  if (watching.length) {
    const recent = await prisma.intelChangeEvent.findMany({
      where: { createdAt: { gte: since }, lifecycleStatus: "ACTIVE", material: true },
      orderBy: { createdAt: "desc" },
      take: 40,
    });
    watchedChanges = recent
      .filter((e) => isMaterialForToday(e) && eventIntersectsWatch(e, watching))
      .filter((e) => !ENGINEERING_RE.test(e.title + (e.summary ?? "")))
      .slice(0, 6)
      .map((e) => ({
        id: e.id,
        type: e.kind,
        title: cleanText(e.title),
        summary: cleanText(e.summary) || null,
        date: e.createdAt.toISOString(),
        href: e.href?.startsWith("/map") ? e.href : null,
      }));
  }

  const pipelineMap: Record<string, number> = {};
  for (const row of pipeline) pipelineMap[row.status] = row._count._all;

  const sitesToLookAt = siteResult.candidates.map((s) => ({
    id: s.id,
    name: s.name,
    address: s.address,
    parcelHint: s.parcelHint,
    suburb: s.suburb,
    lga: s.lga,
    zone: s.zone,
    siteAreaSqm: s.siteAreaSqm,
    lotCount: s.lotCount,
    owners: s.owners,
    currentFsr: s.currentFsr,
    proposedFsr: s.proposedFsr,
    stationDistanceM: s.stationDistanceM,
    score: s.score,
    scoreProvenance: s.scoreProvenance ?? "SCREENING",
    maxPayable: s.maxPayable,
    headroom: s.headroom,
    existingValue: s.existingValue,
    whyItMatters: s.whyItMatters,
    familyAlternativeCount: s.familyAlternativeCount,
    reasons: s.reasons,
    status: s.status,
    kind: s.kind,
    provenance: s.provenance,
    href: s.href,
    analyseHref: s.analyseHref,
  }));

  const analysedCount = sitesToLookAt.filter((s) => s.scoreProvenance === "DETAILED").length;
  const worthCheckingCount = sitesToLookAt.length;
  const planningChangeCount = topIntelligence.length;

  return {
    headline: "Your development brief",
    subheading: todayPageSubheading(),
    orientation: todayOrientationLine(),
    strategy: profile.strategy,
    marketScope: {
      id: market.id,
      label: market.label,
      headerLabel: market.headerLabel,
    },
    indexReady: siteResult.indexReady,
    indexCount: siteResult.indexCount,
    indexPreparingMessage: siteResult.indexReady
      ? null
      : "We're still building the Sydney site list. Check back soon.",
    summaryStrip: {
      indexedSites: siteResult.indexCount,
      analysedToday: analysedCount,
      worthChecking: worthCheckingCount,
      planningChanges: planningChangeCount,
      watched: watching.length,
    },
    topIntelligence,
    whatChanged: topIntelligence,
    sitesToLookAt,
    watchedChanges,
    showWatchedSection: watching.length > 0,
    developmentActivity,
    sourceFreshness: sourceFreshness.map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      lastCheckedAt: s.lastCheckedAt?.toISOString() ?? null,
      lastSuccessfulAt: s.lastSuccessfulAt?.toISOString() ?? null,
    })),
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
    morningReport: morning
      ? {
          ...morning,
          summaryLine: morning.summaryLine
            ? morning.summaryLine
                .replace(/No material changes since yesterday/gi, "No new planning updates since yesterday")
                .replace(/\bmaterial changes?\b/gi, "planning updates")
            : morning.summaryLine,
        }
      : null,
    stats: {
      storyCount: topIntelligence.length,
      candidateCount: sitesToLookAt.length,
      indexSize: siteResult.indexCount,
    },
  };
}
