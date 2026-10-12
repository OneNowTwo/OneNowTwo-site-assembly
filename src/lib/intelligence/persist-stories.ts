/**
 * Persist IntelligenceStory from material IntelChangeEvents (background / cron).
 * Today reads persisted stories — does not rebuild the universe every request.
 */

import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { profileForStrategy, type DevelopmentStrategy } from "@/lib/source-watcher/strategy-profile";
import { aggregateIntelligenceStories } from "./stories";
import { presentSourceForUser } from "@/lib/monitoring/source-presentation";

export async function persistIntelligenceStories(opts?: {
  strategies?: DevelopmentStrategy[];
  sinceDays?: number;
}): Promise<{ upserted: number }> {
  const sinceDays = opts?.sinceDays ?? 7;
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - sinceDays);

  const events = await prisma.intelChangeEvent.findMany({
    where: { createdAt: { gte: since }, lifecycleStatus: "ACTIVE" },
    orderBy: [{ importance: "desc" }, { createdAt: "desc" }],
    take: 200,
  });

  const strategies = opts?.strategies ?? (["APARTMENTS", "TOWNHOUSES", "CO_LIVING", "GENERAL_RESIDENTIAL"] as DevelopmentStrategy[]);
  let upserted = 0;

  for (const strategy of strategies) {
    const profile = profileForStrategy(strategy);
    const stories = aggregateIntelligenceStories(events, profile, { maxStories: 12 });
    for (const s of stories) {
      const presented = presentSourceForUser(
        events.find((e) => s.eventIds.includes(e.id))?.sourceId ?? null,
      );
      const dedupeKey = `${s.id}:${strategy}`;
      const row = await prisma.intelligenceStory.upsert({
        where: { dedupeKey },
        create: {
          kind: s.kind,
          title: s.title,
          summary: s.summary,
          locationLabel: s.locationLabel,
          strategyTags: [strategy],
          dedupeKey,
          affectedSiteCount: s.affectedSiteCount,
          mapHref: s.mapHref,
          findHref: s.findHref,
          sourceHref: presented?.href ?? s.sourceHref,
          importance: s.importance,
          material: true,
          lifecycleStatus: "ACTIVE",
          windowStart: since,
          windowEnd: new Date(),
          payload: {
            eventIds: s.eventIds,
            eventCount: s.eventCount,
            whyItMatters: s.whyItMatters,
            whatChanged: s.whatChanged,
            sourceLabel: presented?.label ?? null,
          } as unknown as Prisma.InputJsonValue,
        },
        update: {
          title: s.title,
          summary: s.summary,
          locationLabel: s.locationLabel,
          affectedSiteCount: s.affectedSiteCount,
          mapHref: s.mapHref,
          findHref: s.findHref,
          sourceHref: presented?.href ?? s.sourceHref,
          importance: s.importance,
          material: true,
          lifecycleStatus: "ACTIVE",
          windowEnd: new Date(),
          payload: {
            eventIds: s.eventIds,
            eventCount: s.eventCount,
            whyItMatters: s.whyItMatters,
            whatChanged: s.whatChanged,
            sourceLabel: presented?.label ?? null,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      // Link events to story (best-effort)
      if (s.eventIds.length) {
        await prisma.intelChangeEvent.updateMany({
          where: { id: { in: s.eventIds } },
          data: { storyId: row.id },
        });
      }
      upserted++;
    }
  }

  return { upserted };
}

/** Read top persisted stories for Today (strategy-filtered). */
export async function listPersistedStoriesForToday(strategy: DevelopmentStrategy, limit = 5) {
  const rows = await prisma.intelligenceStory.findMany({
    where: {
      lifecycleStatus: "ACTIVE",
      material: true,
      strategyTags: { has: strategy },
    },
    orderBy: [{ importance: "desc" }, { updatedAt: "desc" }],
    take: limit,
  });

  // Fallback: any strategy tag if none for this strategy yet
  if (!rows.length) {
    return prisma.intelligenceStory.findMany({
      where: { lifecycleStatus: "ACTIVE", material: true },
      orderBy: [{ importance: "desc" }, { updatedAt: "desc" }],
      take: limit,
    });
  }
  return rows;
}
