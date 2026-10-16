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
import {
  buildPlanningUpdateEvidence,
  buildStoryNavHrefs,
  isValidLgaFilter,
  resolveStoryLocation,
} from "@/lib/intelligence/planning-update-detail";

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

  // Enrich stories with PCA / key-site evidence so detail panels are not generic card copy.
  const pcaIds = new Set<string>();
  const keySiteIds = new Set<string>();
  for (const s of persistedStories) {
    const payload = (s.payload ?? {}) as Record<string, unknown>;
    if (typeof payload.planningChangeAreaId === "string") pcaIds.add(payload.planningChangeAreaId);
    if (Array.isArray(payload.keySiteIds)) {
      for (const id of payload.keySiteIds) if (typeof id === "string") keySiteIds.add(id);
    }
    const mapKey = s.mapHref?.match(/[?&]keySite=([^&]+)/);
    if (mapKey) keySiteIds.add(decodeURIComponent(mapKey[1]!));
    const mapPca = s.mapHref?.match(/[?&]pca=([^&]+)/);
    if (mapPca) pcaIds.add(decodeURIComponent(mapPca[1]!));
    // Collect area labels from titles so we can resolve PCA via KeySite rows (no hardcoded place names).
    const areaMatch = `${s.title} ${s.locationLabel ?? ""}`.match(/\bArea\s+([A-Z0-9]+)\b/i);
    if (areaMatch) keySiteIds.add(`Area ${areaMatch[1]}`);
  }

  const keySiteRows = keySiteIds.size
    ? await prisma.keySite.findMany({
        where: {
          OR: [
            { externalKeySiteId: { in: [...keySiteIds] } },
            { id: { in: [...keySiteIds] } },
          ],
        },
      })
    : [];
  for (const ks of keySiteRows) pcaIds.add(ks.planningChangeAreaId);
  const pcaRows = pcaIds.size
    ? await prisma.planningChangeArea.findMany({ where: { id: { in: [...pcaIds] } } })
    : [];
  const pcaById = new Map(pcaRows.map((r) => [r.id, r]));
  const keySiteByExt = new Map(keySiteRows.map((r) => [r.externalKeySiteId, r]));

  // Resolve affected candidates by key-site bbox intersection (exact related sites).
  async function candidatesForKeySites(ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    const sites = ids.map((id) => keySiteByExt.get(id)).filter(Boolean);
    if (!sites.length) return [];
    const orClauses: Array<{ centroidLat: { gte: number; lte: number }; centroidLng: { gte: number; lte: number } }> =
      [];
    for (const site of sites) {
      const bbox = site!.bbox as { west?: number; south?: number; east?: number; north?: number } | null;
      if (!bbox || bbox.west == null || bbox.south == null || bbox.east == null || bbox.north == null) continue;
      // Slight pad so abutting assemblies still match.
      const pad = 0.0003;
      orClauses.push({
        centroidLat: { gte: bbox.south - pad, lte: bbox.north + pad },
        centroidLng: { gte: bbox.west - pad, lte: bbox.east + pad },
      });
    }
    if (!orClauses.length) return [];
    const rows = await prisma.siteCandidateIndex.findMany({
      where: { lifecycleStatus: "ACTIVE", provenance: "INDEX_DISCOVERY", OR: orClauses },
      select: { id: true },
      take: 50,
    });
    return rows.map((r) => r.id);
  }

  const topIntelligence = [];
  for (const s of persistedStories.filter((row) => !ENGINEERING_RE.test(`${row.title} ${row.summary ?? ""}`)).slice(0, 5)) {
    const payload = (s.payload ?? {}) as Record<string, unknown>;
    const what =
      typeof payload.whatChanged === "string" ? String(payload.whatChanged) : (s.summary ?? s.title);
    const whyRaw =
      typeof payload.whyItMatters === "string" && payload.whyItMatters.trim()
        ? String(payload.whyItMatters)
        : null;

    const storedKeySites = Array.isArray(payload.keySiteIds)
      ? payload.keySiteIds.map(String)
      : [];
    const mapKey = s.mapHref?.match(/[?&]keySite=([^&]+)/);
    if (mapKey && !storedKeySites.includes(decodeURIComponent(mapKey[1]!))) {
      storedKeySites.push(decodeURIComponent(mapKey[1]!));
    }
    // Area L / Area M from title when payload lacks keySiteIds
    const areaFromTitle = (s.title + " " + (s.locationLabel ?? "")).match(/\bArea\s+([A-Z0-9]+)\b/i);
    if (areaFromTitle && !storedKeySites.includes(`Area ${areaFromTitle[1]!.toUpperCase()}`)) {
      const label = `Area ${areaFromTitle[1]!.toUpperCase()}`;
      if (keySiteByExt.has(label) || keySiteByExt.has(`Area ${areaFromTitle[1]}`)) {
        storedKeySites.push(keySiteByExt.has(label) ? label : `Area ${areaFromTitle[1]}`);
      }
    }

    const pcaId =
      (typeof payload.planningChangeAreaId === "string" ? payload.planningChangeAreaId : null) ||
      storedKeySites.map((id) => keySiteByExt.get(id)?.planningChangeAreaId).find(Boolean) ||
      (s.mapHref?.match(/[?&]pca=([^&]+)/) ? decodeURIComponent(s.mapHref.match(/[?&]pca=([^&]+)/)![1]!) : null) ||
      null;

    const pca = pcaId ? pcaById.get(pcaId) ?? null : null;
    const keySites = storedKeySites.map((id) => keySiteByExt.get(id)).filter(Boolean) as typeof keySiteRows;
    const affectedCandidateIds =
      (Array.isArray(payload.affectedCandidateIds) ? payload.affectedCandidateIds.map(String) : null) ??
      (await candidatesForKeySites(storedKeySites));

    const location = resolveStoryLocation({
      locationLabel: s.locationLabel,
      title: s.title,
      summary: s.summary,
      pcaLgas: pca?.lgas,
    });

    const presented = presentTodayStory(
      {
        type: s.kind,
        location,
        title: cleanText(s.title),
        whatChanged: cleanText(what),
        whyItMatters: whyRaw ? cleanText(whyRaw) : null,
        affectedSites: s.affectedSiteCount,
      },
      profile.strategy,
    );

    const evidence = buildPlanningUpdateEvidence({
      storyTitle: s.title,
      storySummary: s.summary,
      locationLabel: location,
      detectedAt: s.updatedAt.toISOString(),
      payload,
      pca: pca
        ? {
            id: pca.id,
            title: pca.title,
            status: pca.status,
            lgas: pca.lgas,
            sourceUrl: pca.sourceUrl,
            exhibitionEnd: pca.exhibitionEnd,
            proposedControls: pca.proposedControls,
          }
        : null,
      keySites: keySites.map((k) => ({
        externalKeySiteId: k.externalKeySiteId,
        name: k.name,
        proposedControls: k.proposedControls,
        currentControls: k.currentControls,
        sourceUrl: k.sourceUrl,
      })),
      sourceName: typeof payload.sourceLabel === "string" ? payload.sourceLabel : null,
      sourceUrl: s.sourceHref,
      affectedCandidateIds,
    });

    const nav = buildStoryNavHrefs({
      strategy: profile.strategy,
      planningChangeAreaId: evidence.planningChangeAreaId ?? pcaId,
      keySiteId: storedKeySites.length === 1 ? storedKeySites[0] : null,
      keySiteIds: storedKeySites,
      locationLabel: evidence.locationLabel ?? location,
      affectedCandidateIds,
    });

    // Repair legacy findHrefs that only had strategy=… or lga=Key+site+Area+L
    const legacyFind = s.findHref ?? "";
    const legacyLga = legacyFind.match(/[?&]lga=([^&]+)/);
    const badLegacyLga = !!legacyLga && !isValidLgaFilter(decodeURIComponent(legacyLga[1]!));
    const findNeedsRepair =
      !legacyFind ||
      /^\/find\?strategy=[A-Z_]+$/i.test(legacyFind) ||
      /lga=Key\+site/i.test(legacyFind) ||
      badLegacyLga ||
      (!legacyFind.includes("pca=") &&
        !legacyFind.includes("keySite=") &&
        !legacyFind.includes("candidateIds=") &&
        !!(pcaId || storedKeySites.length || affectedCandidateIds.length));

    topIntelligence.push({
      id: s.id,
      type: s.kind,
      location: evidence.locationLabel ?? location,
      title: presented.title,
      whatChanged: presented.explanation,
      whyItMatters: presented.explanation,
      typeLabel: presented.typeLabel,
      affectedSites: s.affectedSiteCount,
      date: s.updatedAt.toISOString(),
      sourceId: typeof payload.sourceLabel === "string" ? payload.sourceLabel : null,
      sourceLabel: evidence.sourceName ?? (typeof payload.sourceLabel === "string" ? payload.sourceLabel : null),
      sourceHref: evidence.webpageUrl ?? s.sourceHref,
      href: nav.mapHref ?? s.mapHref,
      mapHref: nav.mapHref ?? s.mapHref,
      findHref: findNeedsRepair ? nav.findHref : s.findHref,
      eventCount: typeof payload.eventCount === "number" ? payload.eventCount : null,
      detail: {
        ...evidence,
        cardTitle: presented.title,
        cardExplanation: presented.explanation,
        typeLabel: presented.typeLabel,
        affectedSites: s.affectedSiteCount,
        mapHref: nav.mapHref ?? s.mapHref,
        findHref: findNeedsRepair ? nav.findHref : s.findHref,
      },
    });
  }

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
