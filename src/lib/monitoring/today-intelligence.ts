/**
 * TODAY development-intelligence payload — geography-neutral.
 */

import { prisma } from "@/lib/db";
import { listWatchItems } from "./watchlist";
import { listFeed } from "./feed";
import { getLatestMorningReport } from "./morning-report";
import { summariseIntelEvent } from "@/lib/source-watcher/why-it-matters";
import type { StrategyProfile } from "@/lib/source-watcher/strategy-profile";
import { DEFAULT_STRATEGY_PROFILE } from "@/lib/source-watcher/strategy-profile";

export async function getTodayIntelligence(userId: string, profile: StrategyProfile = DEFAULT_STRATEGY_PROFILE) {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 7);

  const [watching, feed, morning, pipeline, intelEvents, opportunities, sourceFreshness, activityFeed] =
    await Promise.all([
      listWatchItems(userId),
      listFeed({ sort: "importance", limit: 20 }),
      getLatestMorningReport(userId),
      prisma.opportunity.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.intelChangeEvent.findMany({
        where: { createdAt: { gte: since } },
        orderBy: [{ importance: "desc" }, { createdAt: "desc" }],
        take: 30,
      }),
      prisma.opportunity.findMany({
        where: {
          OR: [{ status: { in: ["ANALYSING", "FEASIBLE", "WATCHING", "ACQUIRING"] } }, { updatedAt: { gte: since } }],
        },
        orderBy: [{ score: "desc" }, { updatedAt: "desc" }],
        take: 12,
        include: {
          parcels: {
            where: { included: true },
            take: 6,
            orderBy: { sortOrder: "asc" },
            include: { parcel: true },
          },
        },
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
      prisma.feedItem.findMany({
        where: {
          kind: { in: ["PLANNING_CHANGE", "NEW", "IMPROVED", "NEW_SALE"] },
          createdAt: { gte: since },
        },
        orderBy: { createdAt: "desc" },
        take: 15,
      }),
    ]);

  const watchIds = new Set(watching.map((w) => w.id));
  const watchedChanges = intelEvents.filter((e) => {
    const ids = e.watchItemIds as string[] | null;
    if (Array.isArray(ids) && ids.some((id) => watchIds.has(id))) return true;
    // Also surface high-importance planning changes when user watches any area
    return watching.length > 0 && e.importance >= 0.6 && /PLANNING|KEY_SITE|HDA|SSD|DA_/i.test(e.kind);
  });

  const whatChanged = intelEvents.slice(0, 12).map((e) => {
    const why = summariseIntelEvent({
      kind: e.kind,
      title: e.title,
      summary: e.summary,
      oldValue: e.oldValue,
      newValue: e.newValue,
    });
    const payload = (e.payload ?? e.newValue ?? {}) as Record<string, unknown>;
    return {
      id: e.id,
      type: e.kind,
      location:
        (payload.lga as string | undefined) ??
        (payload.suburb as string | undefined) ??
        (Array.isArray(payload.lgas) ? String(payload.lgas[0]) : null) ??
        null,
      title: e.title,
      whatChanged: e.summary ?? e.title,
      whyItMatters: why.body,
      affectedSites: Array.isArray(e.affectedParcelHints) ? (e.affectedParcelHints as string[]).length : null,
      date: e.createdAt.toISOString(),
      sourceId: e.sourceId,
      href: e.href,
      importance: e.importance,
    };
  });

  const sitesToLookAt = opportunities.slice(0, 10).map((o) => {
    const parcelRows = o.parcels.map((op) => op.parcel);
    const suburb = o.suburb ?? parcelRows[0]?.suburb ?? null;
    const address = parcelRows.map((p) => p.address).filter(Boolean).slice(0, 2).join(" · ") || o.name;
    const reasons: string[] = [];
    if (o.acquisitionHeadroom != null && o.acquisitionHeadroom > 0) reasons.push("Positive acquisition headroom");
    if (o.score != null && o.score >= 70) reasons.push("High assembly score");
    if (feed.some((f) => f.opportunityId === o.id && f.kind === "PLANNING_CHANGE")) reasons.push("Proposed planning uplift");
    if (feed.some((f) => f.opportunityId === o.id && f.kind === "NEW_SALE")) reasons.push("New registered sale");
    if (!reasons.length) reasons.push("Active in pipeline");
    return {
      id: o.id,
      name: o.name,
      address,
      suburb,
      siteAreaSqm: o.totalSiteArea,
      currentFsr: parcelRows[0]?.fsr ?? null,
      proposedFsr: null as number | null,
      score: o.score,
      maxPayable: o.maxLandBudget,
      headroom: o.acquisitionHeadroom,
      reasons,
      status: o.status,
    };
  });

  const developmentActivity = activityFeed
    .filter((f) => /DA|HDA|SSD|PLANNING|SALE/i.test(f.kind + (f.title ?? "") + (f.summary ?? "")))
    .slice(0, 10)
    .map((f) => ({
      id: f.id,
      kind: f.kind,
      title: f.title,
      summary: f.summary,
      href: f.href,
      createdAt: f.createdAt.toISOString(),
    }));

  const pipelineMap: Record<string, number> = {};
  for (const row of pipeline) pipelineMap[row.status] = row._count._all;

  return {
    headline: "Development Intelligence",
    subheading: "What changed, what matters and what to look at today.",
    strategy: profile.strategy,
    whatChanged,
    sitesToLookAt,
    watchedChanges: watchedChanges.slice(0, 10).map((e) => ({
      id: e.id,
      type: e.kind,
      title: e.title,
      summary: e.summary,
      date: e.createdAt.toISOString(),
      href: e.href,
    })),
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
    morningReport: morning,
    feed,
  };
}
