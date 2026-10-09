import { prisma } from "@/lib/db";
import type { IntelChangeKind, Prisma, SourceCategory, SourceTransport } from "@/generated/prisma/client";
import { publishFeedItem } from "@/lib/monitoring/feed";
import { SOURCE_DEFINITIONS } from "./registry";
import { runSourceOnce, type InMemorySnapshot, type SourceRunResult } from "./pipeline";
import type { DiffEvent, NormalisedSourcePayload, PlanningChangeAreaFact } from "./types";
import { linkEventsToWatches } from "./watch-link";

/** Ensure SourceRegistry rows exist for all definitions. */
export async function ensureSourceRegistry(): Promise<number> {
  let n = 0;
  for (const def of SOURCE_DEFINITIONS) {
    await prisma.sourceRegistry.upsert({
      where: { id: def.id },
      create: {
        id: def.id,
        name: def.name,
        authority: def.authority,
        category: def.category as SourceCategory,
        jurisdiction: def.jurisdiction ?? "NSW",
        sourceType: def.sourceType as SourceTransport,
        config: (def.config ?? {}) as Prisma.InputJsonValue,
        pollFrequency: def.pollFrequency,
        parserVersion: def.parserVersion ?? "1",
        licence: def.licence,
        enabled: def.enabled !== false,
      },
      update: {
        name: def.name,
        authority: def.authority,
        category: def.category as SourceCategory,
        sourceType: def.sourceType as SourceTransport,
        config: (def.config ?? {}) as Prisma.InputJsonValue,
        pollFrequency: def.pollFrequency,
        parserVersion: def.parserVersion ?? "1",
        licence: def.licence,
        enabled: def.enabled !== false,
      },
    });
    n++;
  }
  return n;
}

async function loadPreviousSnapshot(sourceId: string): Promise<InMemorySnapshot | null> {
  const row = await prisma.sourceSnapshot.findFirst({
    where: { sourceId },
    orderBy: { retrievedAt: "desc" },
  });
  if (!row) return null;
  return {
    contentHash: row.contentHash,
    normalised: row.normalised as unknown as NormalisedSourcePayload,
    retrievedAt: row.retrievedAt.toISOString(),
  };
}

async function persistRun(result: SourceRunResult): Promise<{ snapshotId: string | null; eventsCreated: number }> {
  const startedAt = new Date();
  if (result.status === "FAILED" || result.status === "SKIPPED") {
    await prisma.sourceRun.create({
      data: {
        sourceId: result.sourceId,
        status: result.status === "FAILED" ? "FAILED" : "FAILED",
        startedAt,
        finishedAt: new Date(),
        error: result.error ?? "skipped",
        eventsCreated: 0,
      },
    });
    await prisma.sourceRegistry.update({
      where: { id: result.sourceId },
      data: { lastCheckedAt: new Date() },
    });
    return { snapshotId: null, eventsCreated: 0 };
  }

  let snapshotId: string | null = null;
  if (result.status === "SUCCEEDED" && result.contentHash && result.normalised) {
    const snap = await prisma.sourceSnapshot.upsert({
      where: { sourceId_contentHash: { sourceId: result.sourceId, contentHash: result.contentHash } },
      create: {
        sourceId: result.sourceId,
        contentHash: result.contentHash,
        parserVersion: SOURCE_DEFINITIONS.find((s) => s.id === result.sourceId)?.parserVersion ?? "1",
        normalised: result.normalised as unknown as Prisma.InputJsonValue,
        raw: { watcher: true } as Prisma.InputJsonValue,
      },
      update: {},
    });
    snapshotId = snap.id;
    await upsertPlanningAreas(result.normalised);
  }

  const linkedEvents =
    result.events.length && result.normalised
      ? await linkEventsToWatches(result.events, result.normalised)
      : result.events;
  const eventsCreated = await persistEvents(result.sourceId, snapshotId, linkedEvents);

  await prisma.sourceRun.create({
    data: {
      sourceId: result.sourceId,
      status: result.status === "UNCHANGED" ? "UNCHANGED" : "SUCCEEDED",
      startedAt,
      finishedAt: new Date(),
      contentHash: result.contentHash,
      snapshotId,
      eventsCreated,
      notes: result.status === "UNCHANGED" ? "content hash unchanged" : undefined,
    },
  });

  await prisma.sourceRegistry.update({
    where: { id: result.sourceId },
    data: {
      lastCheckedAt: new Date(),
      lastSuccessfulAt: new Date(),
      lastContentHash: result.contentHash,
    },
  });

  return { snapshotId, eventsCreated };
}

async function upsertPlanningAreas(normalised: NormalisedSourcePayload) {
  const meta = (normalised.meta ?? {}) as Record<string, unknown>;
  for (const area of normalised.planningChangeAreas ?? []) {
    const proposedControls = {
      ...area.proposedControls,
      geometrySource: meta.geometrySource ?? area.proposedControls?.notes?.includes("MANUALLY_STRUCTURED")
        ? "MANUALLY_STRUCTURED_FIXTURE"
        : undefined,
      structuredDataStatus: meta.structuredDataStatus ?? undefined,
      documentHash: meta.documentHash ?? undefined,
      provenance: meta.provenance ?? undefined,
    };
    await prisma.planningChangeArea.upsert({
      where: { id: area.id },
      create: {
        id: area.id,
        title: area.title,
        status: area.status,
        authority: area.authority ?? undefined,
        lgas: area.lgas ?? [],
        suburbs: area.suburbs ?? [],
        sourceUrl: area.sourceUrl ?? undefined,
        exhibitionEnd: area.exhibitionEnd ? new Date(area.exhibitionEnd) : undefined,
        bbox: (area.bbox ?? undefined) as Prisma.InputJsonValue | undefined,
        geometry: (area.geometry ?? undefined) as Prisma.InputJsonValue | undefined,
        proposedControls: proposedControls as unknown as Prisma.InputJsonValue,
        lastCheckedAt: new Date(),
      },
      update: {
        title: area.title,
        status: area.status,
        authority: area.authority ?? undefined,
        lgas: area.lgas ?? [],
        suburbs: area.suburbs ?? [],
        sourceUrl: area.sourceUrl ?? undefined,
        exhibitionEnd: area.exhibitionEnd ? new Date(area.exhibitionEnd) : undefined,
        bbox: (area.bbox ?? undefined) as Prisma.InputJsonValue | undefined,
        geometry: (area.geometry ?? undefined) as Prisma.InputJsonValue | undefined,
        proposedControls: proposedControls as unknown as Prisma.InputJsonValue,
        lastCheckedAt: new Date(),
      },
    });
    for (const site of area.keySites ?? []) {
      const id = `${area.id}:${site.externalKeySiteId}`;
      const hintsPayload = {
        hints: site.requiredParcelHints ?? [],
        ids: site.requiredParcelIds ?? [],
      };
      const conditionsPayload =
        site.structuredConditions?.length
          ? site.structuredConditions
          : (site.conditions ?? []);
      const siteProposed = {
        ...(site.proposedControls ?? {}),
        geometrySource: site.geometrySource ?? meta.geometrySource ?? null,
      };
      await prisma.keySite.upsert({
        where: { id },
        create: {
          id,
          planningChangeAreaId: area.id,
          externalKeySiteId: site.externalKeySiteId,
          name: site.name,
          geometry: (site.geometry ?? undefined) as Prisma.InputJsonValue | undefined,
          bbox: (site.bbox ?? undefined) as Prisma.InputJsonValue | undefined,
          requiredParcelHints: hintsPayload as unknown as Prisma.InputJsonValue,
          optionalParcelHints: (site.optionalParcelHints ?? undefined) as Prisma.InputJsonValue | undefined,
          proposedControls: siteProposed as unknown as Prisma.InputJsonValue,
          incentiveControls: (site.incentiveControls ?? undefined) as Prisma.InputJsonValue | undefined,
          requirements: (site.requirements ?? undefined) as Prisma.InputJsonValue | undefined,
          conditions: conditionsPayload as unknown as Prisma.InputJsonValue,
        },
        update: {
          name: site.name,
          geometry: (site.geometry ?? undefined) as Prisma.InputJsonValue | undefined,
          bbox: (site.bbox ?? undefined) as Prisma.InputJsonValue | undefined,
          requiredParcelHints: hintsPayload as unknown as Prisma.InputJsonValue,
          optionalParcelHints: (site.optionalParcelHints ?? undefined) as Prisma.InputJsonValue | undefined,
          proposedControls: siteProposed as unknown as Prisma.InputJsonValue,
          incentiveControls: (site.incentiveControls ?? undefined) as Prisma.InputJsonValue | undefined,
          requirements: (site.requirements ?? undefined) as Prisma.InputJsonValue | undefined,
          conditions: conditionsPayload as unknown as Prisma.InputJsonValue,
        },
      });
    }
  }
}

async function persistEvents(sourceId: string, snapshotId: string | null, events: DiffEvent[]): Promise<number> {
  let created = 0;
  for (const event of events) {
    try {
      const watchIds =
        event.payload && typeof event.payload === "object" && "watchItemIds" in (event.payload as object)
          ? ((event.payload as { watchItemIds?: string[] }).watchItemIds ?? [])
          : [];
      await prisma.intelChangeEvent.create({
        data: {
          kind: event.kind as IntelChangeKind,
          title: event.title,
          summary: event.summary,
          sourceId,
          snapshotId: snapshotId ?? undefined,
          changeKey: event.changeKey,
          oldValue: (event.oldValue ?? undefined) as Prisma.InputJsonValue | undefined,
          newValue: (event.newValue ?? undefined) as Prisma.InputJsonValue | undefined,
          geometry: (event.geometry ?? undefined) as Prisma.InputJsonValue | undefined,
          affectedParcelHints: (event.affectedParcelHints ?? undefined) as Prisma.InputJsonValue | undefined,
          watchItemIds: watchIds.length ? (watchIds as unknown as Prisma.InputJsonValue) : undefined,
          href: event.href,
          importance: event.importance ?? 0,
          payload: (event.payload ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
      created++;
      await publishFeedItem({
        kind: "PLANNING_CHANGE",
        title: event.title,
        summary: event.summary,
        href: event.href ?? "/feed",
        importance: (event.importance ?? 3) + 2,
        payload: {
          intelChangeKind: event.kind,
          sourceId,
          changeKey: event.changeKey,
          affectedParcelHints: event.affectedParcelHints,
          watchItemIds: watchIds,
        },
      });
    } catch (err) {
      // Unique changeKey → duplicate suppressed on unchanged re-run races.
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("Unique constraint") && !msg.includes("unique")) throw err;
    }
  }
  return created;
}

/** Full watcher pass with DB persistence + TODAY feed items. */
export async function runPersistedSourceWatcher(opts?: { sourceIds?: string[] }) {
  await ensureSourceRegistry();
  const ids =
    opts?.sourceIds ??
    SOURCE_DEFINITIONS.filter(
      (s) =>
        s.enabled !== false &&
        (s.id.startsWith("live-") ||
          s.id === "nsw-spatial-lmr-viewer" ||
          s.sourceType === "FIXTURE" ||
          s.id.startsWith("nsw-hda") ||
          s.id.includes("major") ||
          s.id.includes("da-cdc") ||
          s.id.includes("planning-proposal-register") ||
          s.id.startsWith("fixture")),
    ).map((s) => s.id);

  const results: SourceRunResult[] = [];
  let eventsCreated = 0;
  for (const id of ids) {
    const previous = await loadPreviousSnapshot(id);
    const result = await runSourceOnce(id, previous);
    const persisted = await persistRun(result);
    eventsCreated += persisted.eventsCreated;
    results.push(result);
  }

  return {
    ok: true,
    sourcesRun: results.length,
    eventsCreated,
    results: results.map((r) => ({
      sourceId: r.sourceId,
      status: r.status,
      events: r.events.length,
      error: r.error,
    })),
  };
}

export type { PlanningChangeAreaFact };
