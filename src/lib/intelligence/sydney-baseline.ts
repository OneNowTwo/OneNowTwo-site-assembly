/**
 * Sydney-wide baseline job — establish Source Watcher baselines + SiteCandidateIndex batches.
 * Heavy work is background/cron; Today never crawls Sydney on page load.
 */

import { prisma } from "@/lib/db";
import { ensureSourceRegistry, runPersistedSourceWatcher } from "@/lib/source-watcher/persist";
import { refreshSiteCandidateIndexFromKnownEntities } from "./site-candidate-index";
import { applyArchiveDedupe } from "./archive-dedupe";

// Note: run purpose for SourceRun is resolved inside persist.ts (avoids circular imports).

export type SydneyBaselineResult = {
  ok: boolean;
  archiveApplied: boolean;
  sourcesBaselined: number;
  candidateUpserts: number;
  candidateCount: number;
  notes: string[];
};

/**
 * Full baseline sequence (safe to re-run):
 * 1. Archive/dedupe historic test noise
 * 2. Ensure registry
 * 3. Run source watcher — first snapshots become BASELINE (no Today pollution)
 * 4. Refresh SiteCandidateIndex from known entities
 */
export async function runSydneyBaseline(opts?: {
  skipWatcher?: boolean;
  dryRunArchive?: boolean;
}): Promise<SydneyBaselineResult> {
  const notes: string[] = [];

  const archive = await applyArchiveDedupe({ dryRun: opts?.dryRunArchive ?? false });
  notes.push(
    `Archive/dedupe: ${archive.plan.duplicateOpportunityGroups.length} duplicate groups, ${archive.plan.fixtureIntelIds.length} fixture intel, ${archive.plan.baselineBootstrapIds.length} baseline events`,
  );

  await ensureSourceRegistry();

  let sourcesBaselined = 0;
  if (!opts?.skipWatcher) {
    // Mark sources with no prior snapshot — their next run is baseline purpose
    const registries = await prisma.sourceRegistry.findMany({
      where: { enabled: true },
      select: { id: true, lastContentHash: true },
    });
    const firstTimers = registries.filter((r) => !r.lastContentHash).map((r) => r.id);
    notes.push(`${firstTimers.length} sources without prior snapshot (baseline candidates)`);

    const watcher = await runPersistedSourceWatcher();
    sourcesBaselined = watcher.sourcesRun;
    notes.push(`Source watcher pass: ${watcher.sourcesRun} sources, ${watcher.eventsCreated} events`);
  }

  const refreshed = await refreshSiteCandidateIndexFromKnownEntities({ includeOpportunities: true });
  const candidateCount = await prisma.siteCandidateIndex.count({ where: { lifecycleStatus: "ACTIVE" } });
  notes.push(`SiteCandidateIndex upserts=${refreshed.upserted}, active=${candidateCount}`);

  return {
    ok: true,
    archiveApplied: archive.applied,
    sourcesBaselined,
    candidateUpserts: refreshed.upserted,
    candidateCount,
    notes,
  };
}
