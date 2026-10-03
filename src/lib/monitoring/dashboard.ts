import { prisma } from "@/lib/db";
import { listWatchItems } from "./watchlist";
import { listFeed } from "./feed";
import { listAlertEvents } from "./alerts";
import { getLatestMorningReport } from "./morning-report";

export async function getWorkspaceDashboard(userId: string) {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 1);

  const [watching, feed, alerts, morning, pipeline, todayCounts] = await Promise.all([
    listWatchItems(userId),
    listFeed({ sort: "importance", limit: 12 }),
    listAlertEvents(userId, 10),
    getLatestMorningReport(userId),
    prisma.opportunity.groupBy({ by: ["status"], _count: { _all: true } }),
    Promise.all([
      prisma.feedItem.count({ where: { kind: "NEW", createdAt: { gte: since } } }),
      prisma.feedItem.count({ where: { kind: { in: ["IMPROVED", "DECLINED"] }, createdAt: { gte: since } } }),
      prisma.feedItem.count({ where: { kind: "NEW_SALE", createdAt: { gte: since } } }),
      prisma.feedItem.count({ where: { kind: "PLANNING_CHANGE", createdAt: { gte: since } } }),
      prisma.alertEvent.count({ where: { rule: { userId }, createdAt: { gte: since } } }),
    ]),
  ]);

  const [newOpps, changedOpps, newSales, planningChanges, alertsTriggered] = todayCounts;

  const pipelineMap: Record<string, number> = {};
  for (const row of pipeline) pipelineMap[row.status] = row._count._all;

  return {
    today: {
      newOpportunities: newOpps,
      changedOpportunities: changedOpps,
      newSales,
      planningChanges,
      alertsTriggered,
    },
    watching: {
      areas: watching.filter((w) => w.kind === "SUBURB" || w.kind === "MAP_AREA" || w.kind === "PRECINCT"),
      parcels: watching.filter((w) => w.kind === "PARCEL"),
      assemblies: watching.filter((w) => w.kind === "OPPORTUNITY"),
      all: watching,
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
    feed,
    alerts,
    morningReport: morning,
  };
}
