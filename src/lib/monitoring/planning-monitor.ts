import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { planningRuleProvider } from "@/lib/planning/planning-rules-service";
import { CURATED_PLANNING_CHANGES } from "@/lib/planning/change-registry";
import type { PlanningChangeRecord } from "@/lib/planning/types";
import { publishFeedItem } from "./feed";
import { recordOpportunityChange } from "./change-history";

/**
 * Detect planning updates for watched areas.
 * Proposed controls stay separate from current-law feasibility.
 */
export async function monitorPlanningForUser(userId: string): Promise<{ updates: number; events: { title: string; suburb?: string | null }[] }> {
  const watches = await prisma.watchItem.findMany({ where: { userId, active: true } });
  const suburbs = new Set(watches.map((w) => w.suburb?.toLowerCase()).filter(Boolean) as string[]);
  const oppIds = watches.map((w) => w.opportunityId).filter(Boolean) as string[];

  let updates = 0;
  const events: { title: string; suburb?: string | null }[] = [];

  try {
    await planningRuleProvider.refreshFromOfficialSources();
  } catch {
    // continue with curated registry
  }

  const pending: PlanningChangeRecord[] = [...CURATED_PLANNING_CHANGES];
  // Sample a couple of watched opportunity centroids for spatial pending changes.
  for (const id of oppIds.slice(0, 3)) {
    const opp = await prisma.opportunity.findUnique({
      where: { id },
      include: { parcels: { include: { parcel: true }, take: 1 } },
    });
    const p = opp?.parcels[0]?.parcel;
    if (!p) continue;
    try {
      const more = await planningRuleProvider.getPendingPlanningChanges({
        lng: p.centroidLng,
        lat: p.centroidLat,
        lga: p.lga,
        suburb: p.suburb,
      });
      for (const c of more) {
        if (!pending.some((x) => x.id === c.id)) pending.push(c);
      }
    } catch {
      // ignore per-site failures
    }
  }

  for (const change of pending) {
    const changeKey = `${change.id}:${change.status}:${change.title}`;
    const already = await prisma.planningMonitorEvent.findFirst({ where: { changeKey } });
    if (already) continue;

    const titleLower = `${change.title} ${change.description ?? ""} ${(change.suburbs ?? []).join(" ")}`.toLowerCase();
    const matchedSuburb =
      [...suburbs].find((s) => titleLower.includes(s)) ??
      change.suburbs?.[0] ??
      null;

    const statewide = /sepp|housing|lmr|tod|state/i.test(change.title);
    if (!matchedSuburb && !statewide && !oppIds.length) continue;

    const affectedOpps = matchedSuburb
      ? await prisma.opportunity.findMany({
          where: { suburb: { equals: matchedSuburb, mode: "insensitive" } },
          select: { id: true, name: true },
          take: 12,
        })
      : oppIds.length
        ? await prisma.opportunity.findMany({ where: { id: { in: oppIds } }, select: { id: true, name: true }, take: 12 })
        : [];

    const row = await prisma.planningMonitorEvent.create({
      data: {
        changeKey,
        title: change.title,
        summary: change.description ?? null,
        status: change.status,
        suburb: matchedSuburb,
        current: { note: "CURRENT LAW unchanged — proposed controls do not rewrite feasibility" } as Prisma.InputJsonValue,
        proposed: (change.proposedControls ?? null) as unknown as Prisma.InputJsonValue,
        impact: "Likely development impact requires planner confirmation. Feasibility still uses current law + confirmed pathways only.",
        sourceUrl: change.sourceUrl ?? null,
        payload: change as unknown as Prisma.InputJsonValue,
        opportunityId: affectedOpps[0]?.id ?? null,
      },
    });

    await publishFeedItem({
      kind: "PLANNING_CHANGE",
      title: `Planning update: ${change.title}`,
      summary: `${change.status}${matchedSuburb ? ` · ${matchedSuburb}` : ""} — proposed controls remain separate from current law`,
      opportunityId: affectedOpps[0]?.id,
      href: affectedOpps[0] ? `/opportunities/${affectedOpps[0].id}?tab=planning` : "/feed",
      importance: 7,
      payload: { planningEventId: row.id, affected: affectedOpps.map((o) => o.id) },
    });

    for (const opp of affectedOpps.slice(0, 5)) {
      await recordOpportunityChange({
        opportunityId: opp.id,
        kind: "PLANNING",
        title: "Planning update affecting area",
        summary: `${change.title} (${change.status}) — proposed only; current feasibility unchanged`,
        before: { currentLaw: true },
        after: { proposed: change.proposedControls ?? null, status: change.status },
        reason: changeKey,
        source: "planning-monitor",
      });
    }

    updates += 1;
    events.push({ title: change.title, suburb: matchedSuburb });
  }

  return { updates, events };
}
