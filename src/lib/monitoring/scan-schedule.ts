import { prisma } from "@/lib/db";
import type { Prisma, ScanCadence } from "@/generated/prisma/client";
import { scanArea } from "@/lib/scan-service";
import { publishFeedItem } from "./feed";
import { evaluateAlertsForOpportunity } from "./alerts";
import { matchesWatchFilters, watchFiltersSchema } from "./types";

function advanceNextScan(cadence: ScanCadence, from = new Date()): Date | null {
  if (cadence === "MANUAL") return null;
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + (cadence === "WEEKLY" ? 7 : 1));
  d.setUTCHours(20, 0, 0, 0);
  return d;
}

/** Queue due watch items for re-scan (architecture + manual/daily/weekly). */
export async function queueDueScans(limit = 5): Promise<string[]> {
  const due = await prisma.watchItem.findMany({
    where: {
      active: true,
      scanCadence: { in: ["DAILY", "WEEKLY"] },
      OR: [{ nextScanAt: null }, { nextScanAt: { lte: new Date() } }],
      scanStatus: { in: ["IDLE", "SUCCEEDED", "FAILED"] },
      kind: { in: ["SUBURB", "MAP_AREA", "PRECINCT"] },
    },
    take: limit,
    orderBy: { nextScanAt: "asc" },
  });
  const ids: string[] = [];
  for (const w of due) {
    await prisma.watchItem.update({ where: { id: w.id }, data: { scanStatus: "QUEUED" } });
    const job = await prisma.areaScanJob.create({
      data: { watchItemId: w.id, status: "QUEUED", cadence: w.scanCadence },
    });
    ids.push(job.id);
  }
  return ids;
}

export async function runScanJob(jobId: string, userId: string) {
  const job = await prisma.areaScanJob.findUnique({ where: { id: jobId }, include: { watchItem: true } });
  if (!job) return null;
  const w = job.watchItem;
  await prisma.areaScanJob.update({ where: { id: jobId }, data: { status: "RUNNING", startedAt: new Date() } });
  await prisma.watchItem.update({ where: { id: w.id }, data: { scanStatus: "RUNNING" } });

  try {
    const bbox = w.bbox as { west: number; south: number; east: number; north: number } | null;
    const result = await scanArea({
      bbox: bbox && Number.isFinite(bbox.west) ? bbox : undefined,
      suburbHint: w.suburb ?? w.label,
      maxResults: 8,
    });
    const filters = watchFiltersSchema.safeParse(w.filters);
    const candidates = (result.candidates ?? []).filter((c) => {
      if (!filters.success) return true;
      const score = typeof c.score === "number" ? c.score : c.score?.score;
      return matchesWatchFilters(
        {
          totalSiteArea: c.siteAreaSqm,
          acquisitionHeadroom: c.headroom,
          acquisitionHeadroomPercent: c.headroomPercent,
          score,
          combinedMarketValue: c.existingValue,
          maxLandBudget: c.maxPayable,
          lotCount: c.lotCount,
          pathway: c.lmrCentre ? "LMR" : null,
        },
        filters.data,
      );
    });

    let added = 0;
    for (const c of candidates.slice(0, 5)) {
      const score = typeof c.score === "number" ? c.score : c.score?.score ?? null;
      const title = `${w.label}: ${c.lotCount} lot assembly · score ${score ?? "—"}`;
      await publishFeedItem({
        kind: "NEW",
        title,
        summary: `Scheduled ${w.scanCadence.toLowerCase()} scan · ${Math.round(c.siteAreaSqm ?? 0)} sqm · headroom $${Math.round(c.headroom ?? 0).toLocaleString("en-AU")}`,
        watchItemId: w.id,
        href: w.suburb ? `/map?scan=${encodeURIComponent(w.suburb)}` : "/map",
        score,
        headroom: c.headroom,
        maxPayable: c.maxPayable,
        importance: 5 + (score ?? 0) / 20,
        payload: { candidateKey: c.key, scanJobId: jobId },
      });
      await evaluateAlertsForOpportunity(userId, {
        id: `scan:${c.key}`,
        name: title,
        suburb: w.suburb,
        score,
        acquisitionHeadroom: c.headroom,
        acquisitionHeadroomPercent: c.headroomPercent,
        lotCount: c.lotCount,
        pathway: c.lmrCentre ? "LMR" : null,
        isNew: true,
      });
      added += 1;
    }

    const summary = {
      parcelsConsidered: result.parcelsConsidered,
      parcelsEligible: result.parcelsEligible,
      assembliesGenerated: result.assembliesGenerated,
      candidatesReturned: candidates.length,
      messages: result.messages?.slice(0, 6),
    };

    await prisma.areaScanJob.update({
      where: { id: jobId },
      data: {
        status: "SUCCEEDED",
        finishedAt: new Date(),
        resultsAdded: added,
        resultsChanged: 0,
        resultsRemoved: 0,
        summary: summary as Prisma.InputJsonValue,
      },
    });
    await prisma.watchItem.update({
      where: { id: w.id },
      data: {
        scanStatus: "SUCCEEDED",
        lastScanAt: new Date(),
        nextScanAt: advanceNextScan(w.scanCadence),
        lastScanSummary: summary as Prisma.InputJsonValue,
      },
    });
    return { added, summary };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scan failed";
    await prisma.areaScanJob.update({
      where: { id: jobId },
      data: { status: "FAILED", finishedAt: new Date(), error: message },
    });
    await prisma.watchItem.update({
      where: { id: w.id },
      data: {
        scanStatus: "FAILED",
        nextScanAt: advanceNextScan(w.scanCadence),
        lastScanSummary: { error: message } as Prisma.InputJsonValue,
      },
    });
    throw err;
  }
}

export async function processQueuedScans(userId: string, limit = 3) {
  const jobs = await prisma.areaScanJob.findMany({
    where: { status: "QUEUED" },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  const results = [];
  for (const j of jobs) {
    try {
      results.push({ jobId: j.id, ...(await runScanJob(j.id, userId)) });
    } catch (err) {
      results.push({ jobId: j.id, error: err instanceof Error ? err.message : "failed" });
    }
  }
  return results;
}
