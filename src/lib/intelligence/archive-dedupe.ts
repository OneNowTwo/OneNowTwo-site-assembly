/**
 * Production cleanup — archive/dedupe historic test Opportunities and retire fixture intel.
 * DO NOT delete blindly. Prefer ARCHIVED / SUPERSEDED / FIXTURE lifecycle.
 */

import { prisma } from "@/lib/db";
import { canonicalParcelKey } from "./canonical-key";

export type CleanupPlan = {
  duplicateOpportunityGroups: Array<{
    canonicalKey: string;
    keepId: string;
    archiveIds: string[];
    names: string[];
  }>;
  kennethLikeIds: string[];
  fixtureIntelIds: string[];
  nonMaterialDocumentChangeIds: string[];
  baselineBootstrapIds: string[];
};

const KENNETH_RE = /kenneth|manly vale|66.?68\s*kenneth/i;
const TEST_SUBURBS = /manly vale|edgecliff|woollahra|neutral bay/i;

/** Dry-run identification of records that should not drive Today. */
export async function identifyHistoricalNoise(): Promise<CleanupPlan> {
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
  const kennethLikeIds: string[] = [];
  for (const o of opps) {
    const ids = o.parcels.map((p) => p.parcel.externalParcelId);
    const key = o.canonicalKey ?? canonicalParcelKey(ids);
    if (key) {
      const list = byKey.get(key) ?? [];
      list.push(o);
      byKey.set(key, list);
    }
    const addr = o.parcels.map((p) => p.parcel.address ?? "").join(" ");
    if (KENNETH_RE.test(o.name) || KENNETH_RE.test(addr) || (TEST_SUBURBS.test(o.suburb ?? "") && /test|demo|fixture/i.test(o.name))) {
      kennethLikeIds.push(o.id);
    }
  }

  const duplicateOpportunityGroups: CleanupPlan["duplicateOpportunityGroups"] = [];
  for (const [canonicalKey, group] of byKey) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    const keep = sorted[0]!;
    duplicateOpportunityGroups.push({
      canonicalKey,
      keepId: keep.id,
      archiveIds: sorted.slice(1).map((g) => g.id),
      names: sorted.map((g) => g.name),
    });
  }

  const fixtureIntel = await prisma.intelChangeEvent.findMany({
    where: {
      OR: [
        { sourceId: { startsWith: "fixture-" } },
        { changeKey: { startsWith: "fixture-" } },
        { lifecycleStatus: "FIXTURE" },
      ],
    },
    select: { id: true },
    take: 5000,
  });

  const docChanges = await prisma.intelChangeEvent.findMany({
    where: { kind: "SOURCE_DOCUMENT_CHANGED", material: true },
    select: { id: true },
    take: 5000,
  });

  const baseline = await prisma.intelChangeEvent.findMany({
    where: {
      OR: [
        { runPurpose: "BASELINE" },
        { changeKey: { contains: ":bootstrap:" } },
        { kind: "SOURCE_REFRESHED" },
      ],
    },
    select: { id: true },
    take: 5000,
  });

  return {
    duplicateOpportunityGroups,
    kennethLikeIds,
    fixtureIntelIds: fixtureIntel.map((e) => e.id),
    nonMaterialDocumentChangeIds: docChanges.map((e) => e.id),
    baselineBootstrapIds: baseline.map((e) => e.id),
  };
}

/** Apply archive/dedupe. Pass dryRun=true to only return the plan. */
export async function applyArchiveDedupe(opts?: { dryRun?: boolean; archiveKennethDuplicatesOnly?: boolean }) {
  const plan = await identifyHistoricalNoise();
  if (opts?.dryRun) return { plan, applied: false };

  for (const group of plan.duplicateOpportunityGroups) {
    await prisma.opportunity.update({
      where: { id: group.keepId },
      data: { canonicalKey: group.canonicalKey, lifecycleStatus: "ACTIVE" },
    });
    if (group.archiveIds.length) {
      await prisma.opportunity.updateMany({
        where: { id: { in: group.archiveIds } },
        data: {
          lifecycleStatus: "SUPERSEDED",
          canonicalKey: group.canonicalKey,
          archivedAt: new Date(),
          archivedReason: "Duplicate canonical assembly — superseded by latest analysis",
        },
      });
    }
  }

  // Mark fixture intel
  if (plan.fixtureIntelIds.length) {
    await prisma.intelChangeEvent.updateMany({
      where: { id: { in: plan.fixtureIntelIds } },
      data: { lifecycleStatus: "FIXTURE", material: false },
    });
  }

  if (plan.nonMaterialDocumentChangeIds.length) {
    await prisma.intelChangeEvent.updateMany({
      where: { id: { in: plan.nonMaterialDocumentChangeIds } },
      data: { material: false },
    });
  }

  if (plan.baselineBootstrapIds.length) {
    await prisma.intelChangeEvent.updateMany({
      where: { id: { in: plan.baselineBootstrapIds } },
      data: { material: false, runPurpose: "BASELINE" },
    });
  }

  return { plan, applied: true };
}
