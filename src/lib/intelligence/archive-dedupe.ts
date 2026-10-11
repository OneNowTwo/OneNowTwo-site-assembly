/**
 * One-time historical cleanup — archive/supersede test/dev Opportunities and retire fixture intel.
 * Do NOT hard-code suburb names into ongoing production behaviour.
 * Produce HISTORICAL_RECORDS_TO_ARCHIVE dry-run for human review before apply.
 */

import { prisma } from "@/lib/db";
import { canonicalParcelKey } from "./canonical-key";

export type HistoricalRecordRow = {
  kind: "OPPORTUNITY" | "INTEL_EVENT";
  id: string;
  action: "ARCHIVE" | "SUPERSEDE" | "RETIRE_FIXTURE" | "SUPPRESS_BASELINE" | "MARK_NON_MATERIAL";
  reason: string;
  name?: string | null;
  suburb?: string | null;
  canonicalKey?: string | null;
  keepId?: string | null;
  sourceId?: string | null;
  eventKind?: string | null;
  createdAt?: string | null;
};

export type HistoricalRecordsToArchive = {
  generatedAt: string;
  summary: {
    opportunitiesToArchive: number;
    opportunitiesToSupersede: number;
    fixtureIntelToRetire: number;
    baselineEventsToSuppress: number;
    documentChurnToSuppress: number;
  };
  records: HistoricalRecordRow[];
};

/** Development/test windows used only for this one-time migration classification. */
const DEV_WINDOW_END = new Date("2026-10-10T00:00:00.000Z");

function isDemoOrTestOpportunity(o: {
  name: string;
  demoFinancialData: boolean;
  notes: string | null;
}): boolean {
  if (o.demoFinancialData) return true;
  if (/demo|fixture|test|seed|acceptance/i.test(o.name)) return true;
  if (o.notes && /demo|fixture|test seed/i.test(o.notes)) return true;
  return false;
}

/** Dry-run: explicit list for human review. Never apply without approval. */
export async function buildHistoricalRecordsToArchive(): Promise<HistoricalRecordsToArchive> {
  const records: HistoricalRecordRow[] = [];

  const opps = await prisma.opportunity.findMany({
    where: { lifecycleStatus: "ACTIVE" },
    include: {
      parcels: {
        where: { included: true },
        select: { parcel: { select: { externalParcelId: true, address: true } } },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  const byKey = new Map<string, typeof opps>();
  for (const o of opps) {
    const ids = o.parcels.map((p) => p.parcel.externalParcelId);
    const key = o.canonicalKey ?? canonicalParcelKey(ids);
    if (key) {
      const list = byKey.get(key) ?? [];
      list.push(o);
      byKey.set(key, list);
    }

    const reasons: string[] = [];
    if (isDemoOrTestOpportunity(o)) reasons.push("DEMO/TEST/FIXTURE metadata");
    if (o.createdAt < DEV_WINDOW_END && isDemoOrTestOpportunity(o)) {
      reasons.push("created in known development/test window with demo/test markers");
    }
    // Repeated historical analyses of identical parcel sets handled via duplicate groups below.
    if (reasons.length) {
      records.push({
        kind: "OPPORTUNITY",
        id: o.id,
        action: "ARCHIVE",
        reason: reasons.join("; "),
        name: o.name,
        suburb: o.suburb,
        canonicalKey: key,
        createdAt: o.createdAt.toISOString(),
      });
    }
  }

  for (const [canonicalKey, group] of byKey) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    const keep = sorted[0]!;
    for (const dup of sorted.slice(1)) {
      // Avoid double-listing if already archived for demo reasons
      if (records.some((r) => r.id === dup.id && r.kind === "OPPORTUNITY")) {
        const existing = records.find((r) => r.id === dup.id)!;
        existing.action = "SUPERSEDE";
        existing.reason = `${existing.reason}; duplicate canonical assembly — keep ${keep.id}`;
        existing.keepId = keep.id;
        continue;
      }
      records.push({
        kind: "OPPORTUNITY",
        id: dup.id,
        action: "SUPERSEDE",
        reason: "duplicate canonical parcel identity — superseded by latest analysis",
        name: dup.name,
        suburb: dup.suburb,
        canonicalKey,
        keepId: keep.id,
        createdAt: dup.createdAt.toISOString(),
      });
    }
  }

  const fixtureIntel = await prisma.intelChangeEvent.findMany({
    where: {
      OR: [
        { sourceId: { startsWith: "fixture-" } },
        { changeKey: { startsWith: "fixture-" } },
        { lifecycleStatus: "FIXTURE" },
      ],
    },
    select: { id: true, sourceId: true, kind: true, title: true, createdAt: true },
    take: 5000,
  });
  for (const e of fixtureIntel) {
    records.push({
      kind: "INTEL_EVENT",
      id: e.id,
      action: "RETIRE_FIXTURE",
      reason: "fixture-derived intel must not drive Today",
      name: e.title,
      sourceId: e.sourceId,
      eventKind: e.kind,
      createdAt: e.createdAt.toISOString(),
    });
  }

  const baseline = await prisma.intelChangeEvent.findMany({
    where: {
      OR: [
        { runPurpose: "BASELINE" },
        { changeKey: { contains: ":bootstrap:" } },
        { kind: "SOURCE_REFRESHED" },
      ],
      lifecycleStatus: { not: "FIXTURE" },
    },
    select: { id: true, sourceId: true, kind: true, title: true, createdAt: true },
    take: 5000,
  });
  for (const e of baseline) {
    records.push({
      kind: "INTEL_EVENT",
      id: e.id,
      action: "SUPPRESS_BASELINE",
      reason: "first-ingest / baseline — not material change today",
      name: e.title,
      sourceId: e.sourceId,
      eventKind: e.kind,
      createdAt: e.createdAt.toISOString(),
    });
  }

  const docChanges = await prisma.intelChangeEvent.findMany({
    where: { kind: "SOURCE_DOCUMENT_CHANGED", material: true },
    select: { id: true, sourceId: true, kind: true, title: true, createdAt: true },
    take: 5000,
  });
  for (const e of docChanges) {
    records.push({
      kind: "INTEL_EVENT",
      id: e.id,
      action: "MARK_NON_MATERIAL",
      reason: "engineering/source document churn without developer-material control change",
      name: e.title,
      sourceId: e.sourceId,
      eventKind: e.kind,
      createdAt: e.createdAt.toISOString(),
    });
  }

  const summary = {
    opportunitiesToArchive: records.filter((r) => r.kind === "OPPORTUNITY" && r.action === "ARCHIVE").length,
    opportunitiesToSupersede: records.filter((r) => r.kind === "OPPORTUNITY" && r.action === "SUPERSEDE").length,
    fixtureIntelToRetire: records.filter((r) => r.action === "RETIRE_FIXTURE").length,
    baselineEventsToSuppress: records.filter((r) => r.action === "SUPPRESS_BASELINE").length,
    documentChurnToSuppress: records.filter((r) => r.action === "MARK_NON_MATERIAL").length,
  };

  return { generatedAt: new Date().toISOString(), summary, records };
}

/** @deprecated use buildHistoricalRecordsToArchive — kept for scripts that expect CleanupPlan shape */
export async function identifyHistoricalNoise() {
  const list = await buildHistoricalRecordsToArchive();
  return {
    duplicateOpportunityGroups: [] as Array<{
      canonicalKey: string;
      keepId: string;
      archiveIds: string[];
      names: string[];
    }>,
    kennethLikeIds: list.records.filter((r) => r.kind === "OPPORTUNITY" && r.action === "ARCHIVE").map((r) => r.id),
    fixtureIntelIds: list.records.filter((r) => r.action === "RETIRE_FIXTURE").map((r) => r.id),
    nonMaterialDocumentChangeIds: list.records.filter((r) => r.action === "MARK_NON_MATERIAL").map((r) => r.id),
    baselineBootstrapIds: list.records.filter((r) => r.action === "SUPPRESS_BASELINE").map((r) => r.id),
    historicalRecords: list,
  };
}

/**
 * Apply only after human approval of HISTORICAL_RECORDS_TO_ARCHIVE.
 * Archives demo/test Opportunities AND supersedes duplicates — historic rows never re-seed the index.
 */
export async function applyArchiveDedupe(opts?: { dryRun?: boolean; allowApply?: boolean }) {
  const historicalRecords = await buildHistoricalRecordsToArchive();
  if (opts?.dryRun || !opts?.allowApply) {
    return { plan: await identifyHistoricalNoise(), historicalRecords, applied: false };
  }

  for (const row of historicalRecords.records) {
    if (row.kind === "OPPORTUNITY") {
      if (row.action === "ARCHIVE") {
        await prisma.opportunity.update({
          where: { id: row.id },
          data: {
            lifecycleStatus: "ARCHIVED",
            canonicalKey: row.canonicalKey ?? undefined,
            archivedAt: new Date(),
            archivedReason: row.reason,
          },
        });
      } else if (row.action === "SUPERSEDE") {
        await prisma.opportunity.update({
          where: { id: row.id },
          data: {
            lifecycleStatus: "SUPERSEDED",
            canonicalKey: row.canonicalKey ?? undefined,
            archivedAt: new Date(),
            archivedReason: row.reason,
          },
        });
        if (row.keepId && row.canonicalKey) {
          await prisma.opportunity.update({
            where: { id: row.keepId },
            data: { canonicalKey: row.canonicalKey },
          });
        }
      }
    } else if (row.action === "RETIRE_FIXTURE") {
      await prisma.intelChangeEvent.update({
        where: { id: row.id },
        data: { lifecycleStatus: "FIXTURE", material: false },
      });
    } else if (row.action === "SUPPRESS_BASELINE") {
      await prisma.intelChangeEvent.update({
        where: { id: row.id },
        data: { material: false, runPurpose: "BASELINE" },
      });
    } else if (row.action === "MARK_NON_MATERIAL") {
      await prisma.intelChangeEvent.update({
        where: { id: row.id },
        data: { material: false },
      });
    }
  }

  // Purge historically seeded index rows so they cannot repopulate Today discovery.
  await prisma.siteCandidateIndex.updateMany({
    where: {
      OR: [
        { opportunityId: { not: null }, provenance: { not: "INDEX_DISCOVERY" } },
        { provenance: { in: ["USER_ANALYSED", "KEY_SITE", "PLANNING_CHANGE"] } },
        { kind: { in: ["KEY_SITE", "PLANNING_AREA"] } },
      ],
    },
    data: { lifecycleStatus: "ARCHIVED" },
  });

  return { plan: await identifyHistoricalNoise(), historicalRecords, applied: true };
}
