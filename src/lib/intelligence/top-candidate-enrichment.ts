/**
 * DISCOVERY → cheap rank → financially enrich only the strongest candidates.
 *
 * Do NOT value all Sydney parcels. Broad discovery index may remain at 0% financial
 * coverage; Today eventually gets financial context for its strongest sites only.
 *
 * This module is a bounded background scaffold — never block the geography scan.
 */

import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { DevelopmentStrategy } from "@/lib/source-watcher/strategy-profile";

export type EnrichmentTarget = {
  id: string;
  canonicalKey: string;
  lga: string | null;
  suburb: string | null;
  quickScore: number | null;
  strategyScore: number | null;
};

/**
 * Pick a bounded set of ACTIVE INDEX_DISCOVERY candidates for financial enrichment.
 * Prefer high strategy score, spread across LGAs.
 */
export async function selectTopCandidatesForEnrichment(opts?: {
  strategy?: DevelopmentStrategy;
  limit?: number;
  maxPerLga?: number;
}): Promise<EnrichmentTarget[]> {
  const strategy = opts?.strategy ?? "APARTMENTS";
  const limit = opts?.limit ?? 25;
  const maxPerLga = opts?.maxPerLga ?? 3;

  const rows = await prisma.siteCandidateIndex.findMany({
    where: {
      lifecycleStatus: "ACTIVE",
      provenance: "INDEX_DISCOVERY",
      // Prefer not-yet-enriched; still allow refresh later.
      OR: [{ quickHeadroom: null }, { lastSaleValue: null }],
    },
    orderBy: [{ quickScore: "desc" }, { updatedAt: "desc" }],
    take: 200,
    select: {
      id: true,
      canonicalKey: true,
      lga: true,
      suburb: true,
      quickScore: true,
      strategyScores: true,
    },
  });

  const perLga = new Map<string, number>();
  const out: EnrichmentTarget[] = [];
  for (const r of rows) {
    const scores = (r.strategyScores ?? {}) as Record<string, number>;
    const strategyScore = typeof scores[strategy] === "number" ? scores[strategy]! : r.quickScore;
    const lgaKey = (r.lga || "unknown").toUpperCase();
    if ((perLga.get(lgaKey) ?? 0) >= maxPerLga) continue;
    perLga.set(lgaKey, (perLga.get(lgaKey) ?? 0) + 1);
    out.push({
      id: r.id,
      canonicalKey: r.canonicalKey,
      lga: r.lga,
      suburb: r.suburb,
      quickScore: r.quickScore,
      strategyScore: strategyScore ?? null,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Placeholder enrichment step — wires the selection + persistence shape.
 * Real sale/value/feasibility attach should be filled in by a later pass
 * without blocking SydneyIndexBatch scanning.
 */
export async function enrichTopCandidatesQuickFinancial(opts?: {
  strategy?: DevelopmentStrategy;
  limit?: number;
  dryRun?: boolean;
}): Promise<{ selected: number; enriched: number; skipped: number; ids: string[] }> {
  const selected = await selectTopCandidatesForEnrichment({
    strategy: opts?.strategy,
    limit: opts?.limit,
  });
  if (opts?.dryRun) {
    return { selected: selected.length, enriched: 0, skipped: selected.length, ids: selected.map((s) => s.id) };
  }

  let enriched = 0;
  let skipped = 0;
  for (const t of selected) {
    // Scaffold only: mark enrichment pending in sourceRefs. Do not invent headroom.
    const row = await prisma.siteCandidateIndex.findUnique({ where: { id: t.id } });
    if (!row) {
      skipped++;
      continue;
    }
    const refs = (row.sourceRefs ?? {}) as Record<string, unknown>;
    await prisma.siteCandidateIndex.update({
      where: { id: t.id },
      data: {
        sourceRefs: {
          ...refs,
          financialEnrichment: {
            status: "QUEUED",
            strategy: opts?.strategy ?? "APARTMENTS",
            queuedAt: new Date().toISOString(),
            note: "Bounded top-candidate enrichment — sale/value/feasibility attach pending",
          },
        } as unknown as Prisma.InputJsonValue,
      },
    });
    enriched++;
  }
  return { selected: selected.length, enriched, skipped, ids: selected.map((s) => s.id) };
}
