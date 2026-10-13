/**
 * Progressive Greater Sydney SiteCandidateIndex pipeline.
 * Discovery universe = cadastral parcels + assembly engine per LGA/tile batch.
 * Historical Opportunities must NEVER seed discovery.
 */

import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { siteGeometryFromParcels } from "@/lib/index-candidate-geometry";
import { upsertParcel } from "@/lib/opportunity-service";
import { scanArea } from "@/lib/scan-service";
import { resolveProposedPlanningForPoint } from "@/lib/source-watcher/resolve-proposed-at-point";
import { fetchTrainStations, nearestTrainStation } from "@/lib/data-sources/nsw-train-stations";
import { canonicalParcelKey } from "./canonical-key";
import { buildSydneyIndexBatchPlan, GREATER_SYDNEY_LGA_COUNT } from "./greater-sydney-lgas";
import type { BBox, ParcelData } from "@/lib/types";

const DEFAULT_BATCHES_PER_INVOKE = 5;

export type IndexCronResult = {
  ok: boolean;
  action: "STARTED" | "CONTINUED" | "COMPLETE" | "IDLE";
  runId: string | null;
  status: string;
  completedBatches: number;
  totalBatches: number;
  failedBatches: number;
  parcelsProcessed: number;
  candidatesIndexed: number;
  lgasComplete: number;
  lgasTotal: number;
  errors: string[];
  notes: string[];
};

function asBBox(raw: unknown): BBox {
  const b = raw as BBox;
  return { west: b.west, south: b.south, east: b.east, north: b.north };
}

/** Normalize LGA labels for comparison (not for inventing geography). */
export function normalizeLgaName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .trim()
    .toUpperCase()
    .replace(/^CITY OF\s+/, "")
    .replace(/\s+CITY$/, "")
    .replace(/\s+COUNCIL$/, "")
    .replace(/\s+SHIRE$/, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

/**
 * Batch LGA envelopes overlap — only keep candidates whose *actual* planning LGA
 * matches the batch LGA. Null actual LGA is kept with lga=null (never invent batch.lga).
 * Returns false when actual LGA is set and conflicts with the batch assignment.
 */
export function candidateBelongsToBatchLga(
  actualLga: string | null | undefined,
  batchLga: string,
): boolean {
  if (!actualLga) return true;
  const a = normalizeLgaName(actualLga);
  const b = normalizeLgaName(batchLga);
  if (!a || !b) return true;
  return a === b || a.includes(b) || b.includes(a);
}

/**
 * Resume the active sydney-metro run if one is QUEUED/RUNNING.
 * Production cron must continue that run — never invent a second parallel baseline
 * while one is in progress. Candidate upserts key on canonicalKey (idempotent).
 */
async function ensureActiveRun(marketScope = "sydney-metro") {
  const existing = await prisma.sydneyIndexRun.findFirst({
    where: { marketScope, status: { in: ["QUEUED", "RUNNING"] } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return { run: existing, created: false };

  const plan = buildSydneyIndexBatchPlan();
  const run = await prisma.sydneyIndexRun.create({
    data: {
      marketScope,
      status: "QUEUED",
      totalBatches: plan.length,
      startedAt: new Date(),
      notes: { lgaCount: GREATER_SYDNEY_LGA_COUNT, batchPlanSize: plan.length } as Prisma.InputJsonValue,
      batches: {
        create: plan.map((p) => ({
          lga: p.lga,
          region: p.region,
          tileKey: p.tileKey,
          bbox: p.bbox as unknown as Prisma.InputJsonValue,
          status: "QUEUED" as const,
        })),
      },
    },
  });
  return { run, created: true };
}

async function processOneBatch(batchId: string, runId: string): Promise<{
  parcelsLoaded: number;
  candidatesGenerated: number;
  error?: string;
}> {
  const batch = await prisma.sydneyIndexBatch.findUniqueOrThrow({ where: { id: batchId } });
  await prisma.sydneyIndexBatch.update({
    where: { id: batchId },
    data: { status: "RUNNING", attempts: { increment: 1 }, startedAt: new Date(), error: null },
  });

  try {
    const bbox = asBBox(batch.bbox);
    // Quick index: parcels + assemblies + planning attach — skip live AVM (not full feasibility).
    // lockBbox: tile envelope is authoritative; never recentre via LGA/suburbHint.
    const scan = await scanArea({
      bbox,
      maxResults: 24,
      skipValuation: true,
      lockBbox: true,
    });

    let stations: Awaited<ReturnType<typeof fetchTrainStations>> = [];
    try {
      const pad = 0.05;
      stations = await fetchTrainStations({
        west: bbox.west - pad,
        south: bbox.south - pad,
        east: bbox.east + pad,
        north: bbox.north + pad,
      });
    } catch {
      stations = [];
    }

    const parcelsById = new Map<string, ParcelData>(
      (scan.valuedParcels ?? []).map((p) => [p.externalParcelId, p]),
    );

    let generated = 0;
    for (const c of scan.candidates) {
      const key = canonicalParcelKey(c.lotIds);
      if (!key) continue;

      // Actual parcel/candidate LGA only — never invent batch.lga as site geography.
      const actualLga = c.lga?.trim() ? c.lga.trim() : null;
      if (!candidateBelongsToBatchLga(actualLga, batch.lga)) {
        continue;
      }

      const memberParcels = c.lotIds
        .map((lotId) => parcelsById.get(lotId))
        .filter((p): p is ParcelData => !!p?.geometry);
      const siteGeometry = siteGeometryFromParcels(memberParcels);

      // Persist exact lot polygons so Today → Map can draw without a live bbox scan.
      if (memberParcels.length) {
        try {
          await prisma.$transaction(async (tx) => {
            for (const p of memberParcels) await upsertParcel(tx, p);
          });
        } catch {
          // Index upsert still proceeds with geometry JSON even if Parcel write fails.
        }
      }

      let proposedFsr: number | null = null;
      let proposedHeight: number | null = null;
      let keySiteStatus: string | null = null;
      let planningFlags: Record<string, unknown> | null = null;
      if (c.centroid) {
        try {
          const proposed = await resolveProposedPlanningForPoint({
            lng: c.centroid[0],
            lat: c.centroid[1],
          });
          proposedFsr = proposed.proposedFsr ?? null;
          proposedHeight = proposed.proposedHeight ?? null;
          if (proposed.keySiteId) {
            keySiteStatus = `Key site ${proposed.keySiteId}`;
            if (proposed.requiredParcelCount != null) {
              keySiteStatus += ` · ${proposed.requiredParcelCount} properties required`;
            }
          }
          planningFlags = {
            insidePlanningChangeArea: proposed.insidePlanningChangeArea ?? false,
            planningChangeStatus: proposed.planningChangeStatus ?? null,
            keySiteId: proposed.keySiteId ?? null,
          };
        } catch {
          // Proposed attach is best-effort per candidate.
        }
      }

      let stationDistanceM: number | null = null;
      if (c.centroid && stations.length) {
        const near = nearestTrainStation({ lng: c.centroid[0], lat: c.centroid[1] }, stations);
        stationDistanceM = near?.distanceM ?? null;
      }

      const reasons: string[] = [];
      if (proposedFsr != null && c.lepFsr != null && proposedFsr > c.lepFsr) {
        reasons.push(`Proposed FSR uplift: ${c.lepFsr} → ${proposedFsr}`);
      } else if (proposedFsr != null) {
        reasons.push(`Proposed FSR ${proposedFsr}`);
      }
      if (keySiteStatus) reasons.push(`KEY SITE OPPORTUNITY · ${keySiteStatus}`);
      if (stationDistanceM != null && stationDistanceM <= 800) {
        reasons.push(`About ${Math.round(stationDistanceM)}m to a station`);
      }
      if (c.zone) reasons.push(`Zone ${c.zone}`);
      if (!reasons.length) reasons.push("Sydney index discovery — meets screening filters");

      // Quick score only — do not invent financials without valuation support.
      // Clamp to 0–100 so index never persists display scores above 100.
      let quickScore = c.score?.score ?? c.planningPotentialScore ?? 40;
      if (proposedFsr != null && c.lepFsr != null && proposedFsr > c.lepFsr) quickScore += 12;
      if (stationDistanceM != null && stationDistanceM <= 800) quickScore += 8;
      if (keySiteStatus) quickScore += 10;
      quickScore = Math.max(0, Math.min(100, Math.round(quickScore)));

      const clampScore = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
      const strategyScores = {
        APARTMENTS: clampScore(quickScore + (/R3|R4|MU1|B4|E1/i.test(c.zone ?? "") ? 6 : 0)),
        TOWNHOUSES: clampScore(quickScore + (/R2|R3/i.test(c.zone ?? "") ? 6 : -4)),
        CO_LIVING: clampScore(quickScore + (stationDistanceM != null && stationDistanceM <= 800 ? 8 : 0)),
        GENERAL_RESIDENTIAL: quickScore,
      };

      await prisma.siteCandidateIndex.upsert({
        where: { canonicalKey: key },
        create: {
          canonicalKey: key,
          kind: c.lotCount > 1 ? "ASSEMBLY" : "PARCEL",
          parcelIds: c.lotIds as unknown as Prisma.InputJsonValue,
          address: c.locationLabel,
          suburb: c.suburb,
          lga: actualLga,
          zone: c.zone,
          siteAreaSqm: c.siteAreaSqm,
          lotCount: c.lotCount,
          // Lot count ≠ owners. Persist null unless title/ownership data proves a count.
          owners: null,
          currentFsr: c.lepFsr,
          proposedFsr,
          proposedHeightM: proposedHeight,
          keySiteStatus,
          stationDistanceM,
          planningChangeFlags: (planningFlags ?? undefined) as Prisma.InputJsonValue | undefined,
          // Only store financials when scan produced supported figures (skipValuation → usually null).
          quickScore,
          quickHeadroom: c.financialRankingAvailable ? c.headroom : null,
          maxPayable: c.financialRankingAvailable ? c.maxPayable : null,
          centroidLat: c.centroid?.[1] ?? null,
          centroidLng: c.centroid?.[0] ?? null,
          bbox: bbox as unknown as Prisma.InputJsonValue,
          ...(siteGeometry
            ? { geometry: siteGeometry as unknown as Prisma.InputJsonValue }
            : {}),
          reasonHints: reasons.slice(0, 3) as unknown as Prisma.InputJsonValue,
          strategyScores: strategyScores as unknown as Prisma.InputJsonValue,
          provenance: "INDEX_DISCOVERY",
          indexRunId: runId,
          indexBatchId: batchId,
          lastEvaluatedAt: new Date(),
          lifecycleStatus: "ACTIVE",
          sourceRefs: {
            discovery: "SYDNEY_INDEX_BATCH",
            tileKey: batch.tileKey,
            batchLga: batch.lga,
          } as unknown as Prisma.InputJsonValue,
        },
        update: {
          kind: c.lotCount > 1 ? "ASSEMBLY" : "PARCEL",
          parcelIds: c.lotIds as unknown as Prisma.InputJsonValue,
          address: c.locationLabel,
          suburb: c.suburb,
          lga: actualLga,
          zone: c.zone,
          siteAreaSqm: c.siteAreaSqm,
          lotCount: c.lotCount,
          owners: null,
          currentFsr: c.lepFsr,
          proposedFsr,
          proposedHeightM: proposedHeight,
          keySiteStatus,
          stationDistanceM,
          planningChangeFlags: (planningFlags ?? undefined) as Prisma.InputJsonValue | undefined,
          quickScore,
          quickHeadroom: c.financialRankingAvailable ? c.headroom : null,
          maxPayable: c.financialRankingAvailable ? c.maxPayable : null,
          centroidLat: c.centroid?.[1] ?? null,
          centroidLng: c.centroid?.[0] ?? null,
          bbox: bbox as unknown as Prisma.InputJsonValue,
          ...(siteGeometry
            ? { geometry: siteGeometry as unknown as Prisma.InputJsonValue }
            : {}),
          reasonHints: reasons.slice(0, 3) as unknown as Prisma.InputJsonValue,
          strategyScores: strategyScores as unknown as Prisma.InputJsonValue,
          provenance: "INDEX_DISCOVERY",
          indexRunId: runId,
          indexBatchId: batchId,
          lastEvaluatedAt: new Date(),
          lifecycleStatus: "ACTIVE",
          sourceRefs: {
            discovery: "SYDNEY_INDEX_BATCH",
            tileKey: batch.tileKey,
            batchLga: batch.lga,
          } as unknown as Prisma.InputJsonValue,
        },
      });
      generated++;
    }

    await prisma.sydneyIndexBatch.update({
      where: { id: batchId },
      data: {
        status: "COMPLETE",
        finishedAt: new Date(),
        parcelsLoaded: scan.funnel?.parcelsLoaded ?? scan.parcelsConsidered ?? 0,
        candidatesGenerated: generated,
      },
    });

    return {
      parcelsLoaded: scan.funnel?.parcelsLoaded ?? scan.parcelsConsidered ?? 0,
      candidatesGenerated: generated,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.sydneyIndexBatch.update({
      where: { id: batchId },
      data: { status: "FAILED", finishedAt: new Date(), error: msg.slice(0, 2000) },
    });
    return { parcelsLoaded: 0, candidatesGenerated: 0, error: msg };
  }
}

async function refreshRunCounters(runId: string) {
  const [completed, failed, parcels, candidates, lgasDone] = await Promise.all([
    prisma.sydneyIndexBatch.count({ where: { runId, status: "COMPLETE" } }),
    prisma.sydneyIndexBatch.count({ where: { runId, status: "FAILED" } }),
    prisma.sydneyIndexBatch.aggregate({
      where: { runId, status: "COMPLETE" },
      _sum: { parcelsLoaded: true },
    }),
    prisma.siteCandidateIndex.count({
      where: { lifecycleStatus: "ACTIVE", provenance: "INDEX_DISCOVERY", indexRunId: runId },
    }),
    prisma.sydneyIndexBatch
      .groupBy({
        by: ["lga"],
        where: { runId, status: "COMPLETE" },
      })
      .then((rows) => rows.length),
  ]);

  const run = await prisma.sydneyIndexRun.findUniqueOrThrow({ where: { id: runId } });
  const allDone = completed + failed >= run.totalBatches;
  const status = allDone ? (failed > 0 && completed === 0 ? "FAILED" : "COMPLETE") : "RUNNING";

  await prisma.sydneyIndexRun.update({
    where: { id: runId },
    data: {
      status,
      completedBatches: completed,
      failedBatches: failed,
      parcelsProcessed: parcels._sum.parcelsLoaded ?? 0,
      candidateCount: candidates,
      finishedAt: allDone ? new Date() : null,
      notes: {
        lgasComplete: lgasDone,
        lgasTotal: GREATER_SYDNEY_LGA_COUNT,
      } as Prisma.InputJsonValue,
    },
  });

  return {
    completed,
    failed,
    parcelsProcessed: parcels._sum.parcelsLoaded ?? 0,
    candidates,
    lgasDone,
    status,
    totalBatches: run.totalBatches,
  };
}

/**
 * Cron entry: START / CONTINUE / COMPLETE.
 * Processes a bounded number of batches per invocation.
 */
export async function runSydneyIndexCron(opts?: {
  batchesPerInvoke?: number;
  marketScope?: string;
}): Promise<IndexCronResult> {
  const batchesPerInvoke = opts?.batchesPerInvoke ?? DEFAULT_BATCHES_PER_INVOKE;
  const marketScope = opts?.marketScope ?? "sydney-metro";
  const notes: string[] = [];
  const errors: string[] = [];

  const complete = await prisma.sydneyIndexRun.findFirst({
    where: { marketScope, status: "COMPLETE" },
    orderBy: { finishedAt: "desc" },
  });
  const active = await prisma.sydneyIndexRun.findFirst({
    where: { marketScope, status: { in: ["QUEUED", "RUNNING"] } },
    orderBy: { createdAt: "desc" },
  });

  if (!active && complete) {
    // Allow resume of a new run only when explicitly requested via env/flag later;
    // default: report COMPLETE idle.
    return {
      ok: true,
      action: "IDLE",
      runId: complete.id,
      status: "COMPLETE",
      completedBatches: complete.completedBatches,
      totalBatches: complete.totalBatches,
      failedBatches: complete.failedBatches,
      parcelsProcessed: complete.parcelsProcessed,
      candidatesIndexed: complete.candidateCount,
      lgasComplete: GREATER_SYDNEY_LGA_COUNT,
      lgasTotal: GREATER_SYDNEY_LGA_COUNT,
      errors: [],
      notes: ["Baseline run already COMPLETE — create a new run to reindex"],
    };
  }

  const { run, created } = await ensureActiveRun(marketScope);
  if (created) notes.push(`Started SydneyIndexRun ${run.id} with ${run.totalBatches} batches`);

  await prisma.sydneyIndexRun.update({
    where: { id: run.id },
    data: { status: "RUNNING", startedAt: run.startedAt ?? new Date() },
  });

  // Prefer explicitly prioritized tiles (tileKey prefix "!priority:") then LGA order.
  const prioritized = await prisma.sydneyIndexBatch.findMany({
    where: { runId: run.id, status: { in: ["QUEUED", "FAILED"] }, tileKey: { startsWith: "!priority:" } },
    orderBy: [{ tileKey: "asc" }],
    take: batchesPerInvoke,
  });
  const remaining = batchesPerInvoke - prioritized.length;
  const queuedRest =
    remaining > 0
      ? await prisma.sydneyIndexBatch.findMany({
          where: {
            runId: run.id,
            status: { in: ["QUEUED", "FAILED"] },
            NOT: { tileKey: { startsWith: "!priority:" } },
          },
          orderBy: [{ lga: "asc" }, { tileKey: "asc" }],
          take: remaining,
        })
      : [];
  const queued = [...prioritized, ...queuedRest];

  for (const b of queued) {
    const result = await processOneBatch(b.id, run.id);
    if (result.error) errors.push(`${b.tileKey}: ${result.error}`);
    notes.push(`${b.tileKey}: parcels=${result.parcelsLoaded} candidates=${result.candidatesGenerated}`);
  }

  const counters = await refreshRunCounters(run.id);
  const action = created ? "STARTED" : counters.status === "COMPLETE" ? "COMPLETE" : "CONTINUED";

  return {
    ok: errors.length === 0 || counters.completed > 0,
    action,
    runId: run.id,
    status: counters.status,
    completedBatches: counters.completed,
    totalBatches: counters.totalBatches,
    failedBatches: counters.failed,
    parcelsProcessed: counters.parcelsProcessed,
    candidatesIndexed: counters.candidates,
    lgasComplete: counters.lgasDone,
    lgasTotal: GREATER_SYDNEY_LGA_COUNT,
    errors,
    notes,
  };
}

/**
 * Invalidate pre-lockBbox runs for acceptance and start a clean SydneyIndexRun.
 * Archives prior INDEX_DISCOVERY candidates; does not hard-delete.
 */
export async function invalidatePriorRunsAndStartFresh(opts?: {
  marketScope?: string;
  reason?: string;
}): Promise<{ invalidatedRunIds: string[]; newRunId: string; archivedCandidates: number }> {
  const marketScope = opts?.marketScope ?? "sydney-metro";
  const reason = opts?.reason ?? "INVALIDATED_PRE_LOCKBBOX — not for acceptance";

  const prior = await prisma.sydneyIndexRun.findMany({
    where: { marketScope, status: { in: ["QUEUED", "RUNNING", "COMPLETE"] } },
  });
  const invalidatedRunIds: string[] = [];
  for (const r of prior) {
    await prisma.sydneyIndexRun.update({
      where: { id: r.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        error: reason.slice(0, 2000),
        notes: {
          ...(typeof r.notes === "object" && r.notes && !Array.isArray(r.notes) ? (r.notes as object) : {}),
          invalidated: true,
          invalidatedReason: reason,
        } as Prisma.InputJsonValue,
      },
    });
    invalidatedRunIds.push(r.id);
  }

  const archived = await prisma.siteCandidateIndex.updateMany({
    where: {
      provenance: "INDEX_DISCOVERY",
      lifecycleStatus: "ACTIVE",
      OR: invalidatedRunIds.length
        ? [{ indexRunId: { in: invalidatedRunIds } }, { indexRunId: null }]
        : undefined,
    },
    data: { lifecycleStatus: "ARCHIVED" },
  });

  const { run } = await ensureActiveRun(marketScope);
  return {
    invalidatedRunIds,
    newRunId: run.id,
    archivedCandidates: archived.count,
  };
}

/** Metrics for the report — real DB numbers only. */
export async function getSydneyIndexMetrics() {
  const run = await prisma.sydneyIndexRun.findFirst({
    where: { marketScope: "sydney-metro" },
    orderBy: { createdAt: "desc" },
  });
  const activeDiscovery = await prisma.siteCandidateIndex.count({
    where: { lifecycleStatus: "ACTIVE", provenance: "INDEX_DISCOVERY" },
  });
  const byKind = await prisma.siteCandidateIndex.groupBy({
    by: ["kind"],
    where: { lifecycleStatus: "ACTIVE", provenance: "INDEX_DISCOVERY" },
    _count: { _all: true },
  });
  const withPlanning = await prisma.siteCandidateIndex.count({
    where: { lifecycleStatus: "ACTIVE", provenance: "INDEX_DISCOVERY", currentFsr: { not: null } },
  });
  const withStation = await prisma.siteCandidateIndex.count({
    where: { lifecycleStatus: "ACTIVE", provenance: "INDEX_DISCOVERY", stationDistanceM: { not: null } },
  });
  const withProposed = await prisma.siteCandidateIndex.count({
    where: { lifecycleStatus: "ACTIVE", provenance: "INDEX_DISCOVERY", proposedFsr: { not: null } },
  });
  const withFinancial = await prisma.siteCandidateIndex.count({
    where: { lifecycleStatus: "ACTIVE", provenance: "INDEX_DISCOVERY", quickHeadroom: { not: null } },
  });
  const sampleByRegion = await prisma.siteCandidateIndex.findMany({
    where: { lifecycleStatus: "ACTIVE", provenance: "INDEX_DISCOVERY" },
    orderBy: { quickScore: "desc" },
    take: 40,
    select: {
      id: true,
      address: true,
      suburb: true,
      lga: true,
      kind: true,
      quickScore: true,
      provenance: true,
      indexBatchId: true,
      currentFsr: true,
      proposedFsr: true,
      stationDistanceM: true,
    },
  });

  return {
    run: run
      ? {
          id: run.id,
          status: run.status,
          completedBatches: run.completedBatches,
          totalBatches: run.totalBatches,
          failedBatches: run.failedBatches,
          parcelsProcessed: run.parcelsProcessed,
          candidateCount: run.candidateCount,
          notes: run.notes,
        }
      : null,
    uniqueCandidates: activeDiscovery,
    byKind: Object.fromEntries(byKind.map((k) => [k.kind, k._count._all])),
    coverage: {
      currentPlanningPct: activeDiscovery ? Math.round((withPlanning / activeDiscovery) * 100) : 0,
      stationDistancePct: activeDiscovery ? Math.round((withStation / activeDiscovery) * 100) : 0,
      proposedPlanningPct: activeDiscovery ? Math.round((withProposed / activeDiscovery) * 100) : 0,
      quickFinancialPct: activeDiscovery ? Math.round((withFinancial / activeDiscovery) * 100) : 0,
    },
    sampleByRegion,
    lgasTotal: GREATER_SYDNEY_LGA_COUNT,
  };
}
