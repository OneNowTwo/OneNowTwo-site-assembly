import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { money } from "@/lib/format";

function startOfUtcDay(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function generateMorningReport(userId: string, reportDate = startOfUtcDay()) {
  const existing = await prisma.morningReport.findUnique({
    where: { userId_reportDate: { userId, reportDate } },
  });
  if (existing) return existing;

  const since = new Date(reportDate);
  since.setUTCDate(since.getUTCDate() - 1);

  const [newFeed, sales, planning, improved, declined, alerts, watchActivity, bestNew] = await Promise.all([
    prisma.feedItem.findMany({ where: { kind: "NEW", createdAt: { gte: since } }, orderBy: { importance: "desc" }, take: 10 }),
    prisma.feedItem.findMany({ where: { kind: "NEW_SALE", createdAt: { gte: since } }, take: 20 }),
    prisma.feedItem.findMany({ where: { kind: "PLANNING_CHANGE", createdAt: { gte: since } }, take: 20 }),
    prisma.feedItem.findMany({ where: { kind: "IMPROVED", createdAt: { gte: since } }, take: 20 }),
    prisma.feedItem.findMany({ where: { kind: "DECLINED", createdAt: { gte: since } }, take: 20 }),
    prisma.alertEvent.findMany({ where: { rule: { userId }, createdAt: { gte: since } }, take: 20 }),
    prisma.feedItem.findMany({ where: { kind: "WATCHLIST_CHANGE", createdAt: { gte: since } }, take: 20 }),
    prisma.feedItem.findFirst({
      where: { kind: "NEW", createdAt: { gte: since } },
      orderBy: [{ score: "desc" }, { headroom: "desc" }],
      include: { opportunity: true },
    }),
  ]);

  const positiveMoves = improved.filter((f) => (f.headroomDelta ?? 0) > 0).length;
  const negativeMoves = declined.length;

  const best = bestNew?.opportunity;
  const body = {
    date: reportDate.toISOString().slice(0, 10),
    newOpportunities: {
      count: newFeed.length,
      items: newFeed.map((f) => ({ title: f.title, href: f.href, opportunityId: f.opportunityId, score: f.score, headroom: f.headroom })),
    },
    bestNewOpportunity: best
      ? {
          id: best.id,
          name: best.name,
          suburb: best.suburb,
          lots: best.unitCount,
          siteAreaSqm: best.totalSiteArea,
          score: best.score,
          existingValue: best.combinedMarketValue,
          maxPayable: best.maxLandBudget,
          headroom: best.acquisitionHeadroom,
          href: `/opportunities/${best.id}`,
        }
      : bestNew
        ? { name: bestNew.title, href: bestNew.href, score: bestNew.score, headroom: bestNew.headroom }
        : null,
    salesValueChanges: { count: sales.length, items: sales.map((s) => ({ title: s.title, summary: s.summary, href: s.href })) },
    planningChanges: { count: planning.length, items: planning.map((p) => ({ title: p.title, summary: p.summary, href: p.href })) },
    opportunityMovements: {
      positiveHeadroom: positiveMoves,
      belowTarget: negativeMoves,
      improved: improved.map((i) => ({ title: i.title, href: i.href, headroomDelta: i.headroomDelta })),
      declined: declined.map((i) => ({ title: i.title, href: i.href, headroomDelta: i.headroomDelta })),
    },
    watchlistActivity: { count: watchActivity.length + alerts.length, items: [...watchActivity, ...alerts.map((a) => ({ title: a.title, summary: a.summary, href: a.href }))] },
  };

  const summaryLine = [
    newFeed.length ? `${newFeed.length} new assembl${newFeed.length === 1 ? "y" : "ies"}` : null,
    sales.length ? `${sales.length} sale update${sales.length === 1 ? "" : "s"}` : null,
    planning.length ? `${planning.length} planning update${planning.length === 1 ? "" : "s"}` : null,
    !newFeed.length && !sales.length && !planning.length ? "No material changes since yesterday" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const title = `Daily opportunity report · ${reportDate.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}`;

  return prisma.morningReport.create({
    data: {
      userId,
      reportDate,
      title,
      summaryLine,
      body: body as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function getLatestMorningReport(userId: string) {
  return prisma.morningReport.findFirst({ where: { userId }, orderBy: { reportDate: "desc" } });
}

export async function listMorningReports(userId: string, limit = 14) {
  return prisma.morningReport.findMany({ where: { userId }, orderBy: { reportDate: "desc" }, take: limit });
}

export function formatReportBlurb(body: {
  bestNewOpportunity?: { name?: string; headroom?: number | null; score?: number | null } | null;
}): string {
  const b = body.bestNewOpportunity;
  if (!b?.name) return "Open the morning report for today’s movements.";
  return `Best new: ${b.name}${b.score != null ? ` · score ${b.score}` : ""}${b.headroom != null ? ` · headroom ${money(b.headroom, { compact: true })}` : ""}`;
}
