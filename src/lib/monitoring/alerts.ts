import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { alertCriteriaSchema, opportunityMatchesCriteria, type AlertCriteria } from "./types";
import { publishFeedItem } from "./feed";

export { opportunityMatchesCriteria };

export async function listAlertRules(userId: string) {
  return prisma.alertRule.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: { events: { orderBy: { createdAt: "desc" }, take: 5 } },
  });
}

export async function createAlertRule(input: {
  userId: string;
  name: string;
  criteria: AlertCriteria;
  watchItemId?: string | null;
}) {
  const criteria = alertCriteriaSchema.parse(input.criteria);
  return prisma.alertRule.create({
    data: {
      userId: input.userId,
      name: input.name.trim(),
      criteria: criteria as Prisma.InputJsonValue,
      watchItemId: input.watchItemId ?? null,
      channels: ["IN_APP"],
    },
  });
}

export async function updateAlertRule(id: string, userId: string, patch: Partial<{ name: string; criteria: AlertCriteria; active: boolean }>) {
  const existing = await prisma.alertRule.findFirst({ where: { id, userId } });
  if (!existing) return null;
  return prisma.alertRule.update({
    where: { id },
    data: {
      name: patch.name?.trim(),
      active: patch.active,
      criteria: patch.criteria ? (alertCriteriaSchema.parse(patch.criteria) as Prisma.InputJsonValue) : undefined,
    },
  });
}

export async function listAlertEvents(userId: string, limit = 30) {
  return prisma.alertEvent.findMany({
    where: { rule: { userId } },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { rule: { select: { id: true, name: true } } },
  });
}

/** Evaluate all active rules against an opportunity snapshot; create in-app alert events. */
export async function evaluateAlertsForOpportunity(
  userId: string,
  opp: {
    id: string;
    name: string;
    suburb?: string | null;
    score?: number | null;
    acquisitionHeadroom?: number | null;
    acquisitionHeadroomPercent?: number | null;
    lotCount?: number;
    pathway?: string | null;
    wasNonViable?: boolean;
    isNew?: boolean;
  },
) {
  const rules = await prisma.alertRule.findMany({ where: { userId, active: true } });
  const fired = [];
  for (const rule of rules) {
    const criteria = alertCriteriaSchema.safeParse(rule.criteria);
    if (!criteria.success) continue;
    if (criteria.data.watchItemId && rule.watchItemId && criteria.data.watchItemId !== rule.watchItemId) continue;
    if (!opportunityMatchesCriteria(opp, criteria.data)) continue;
    const event = await prisma.alertEvent.create({
      data: {
        ruleId: rule.id,
        title: rule.name,
        summary: `${opp.name}${opp.suburb ? ` · ${opp.suburb}` : ""} matched alert “${rule.name}”`,
        opportunityId: opp.id,
        href: `/opportunities/${opp.id}`,
        payload: { criteria: criteria.data, score: opp.score, headroom: opp.acquisitionHeadroom } as Prisma.InputJsonValue,
        deliveredInApp: true,
      },
    });
    await publishFeedItem({
      kind: "ALERT",
      title: `Alert: ${rule.name}`,
      summary: event.summary ?? undefined,
      opportunityId: opp.id,
      href: `/opportunities/${opp.id}`,
      score: opp.score,
      headroom: opp.acquisitionHeadroom,
      importance: 8,
    });
    fired.push(event);
  }
  return fired;
}
