/**
 * Sydney baseline orchestrator:
 * PHASE A — source baseline (optional)
 * PHASE B/C — create/continue SydneyIndexRun batches
 * PHASE D — aggregate stats + persist IntelligenceStory
 * PHASE E — mark ready when batches complete
 *
 * Archive apply is NEVER automatic — dry-run only unless allowArchiveApply.
 */

import { ensureSourceRegistry, runPersistedSourceWatcher } from "@/lib/source-watcher/persist";
import { applyArchiveDedupe, buildHistoricalRecordsToArchive } from "./archive-dedupe";
import { runSydneyIndexCron, getSydneyIndexMetrics, type IndexCronResult } from "./sydney-index-pipeline";
import { persistIntelligenceStories } from "./persist-stories";
import { enrichIndexFromActiveOpportunities } from "./site-candidate-index";

export type SydneyBaselineResult = IndexCronResult & {
  archiveDryRunOnly: boolean;
  sourcesBaselined: number;
  storiesUpserted: number;
  historicalRecordCount: number;
};

export async function runSydneyBaseline(opts?: {
  skipWatcher?: boolean;
  /** Default true — never apply archive without explicit human approval. */
  dryRunArchive?: boolean;
  allowArchiveApply?: boolean;
  batchesPerInvoke?: number;
}): Promise<SydneyBaselineResult> {
  const dryRunArchive = opts?.dryRunArchive !== false && !opts?.allowArchiveApply;
  const notes: string[] = [];

  // Archive: dry-run by default; never silently archive on cron.
  const archive = await applyArchiveDedupe({
    dryRun: dryRunArchive,
    allowApply: opts?.allowArchiveApply === true,
  });
  const historical = archive.historicalRecords ?? (await buildHistoricalRecordsToArchive());
  notes.push(
    dryRunArchive
      ? `Archive DRY-RUN: ${historical.records.length} records listed for human review`
      : `Archive APPLIED: ${historical.records.length} records`,
  );

  let sourcesBaselined = 0;
  if (!opts?.skipWatcher) {
    await ensureSourceRegistry();
    const watcher = await runPersistedSourceWatcher();
    sourcesBaselined = watcher.sourcesRun;
    notes.push(`Source watcher: ${watcher.sourcesRun} sources, ${watcher.eventsCreated} events`);
  }

  // Progressive Sydney parcel/assembly index — NOT Opportunities/KeySites.
  const index = await runSydneyIndexCron({ batchesPerInvoke: opts?.batchesPerInvoke ?? 5 });
  notes.push(...index.notes);

  const stories = await persistIntelligenceStories();
  notes.push(`IntelligenceStory upserts=${stories.upserted}`);

  // Enrich only — never create discovery from user analyses.
  const enriched = await enrichIndexFromActiveOpportunities();
  notes.push(`Opportunity enrichments on index rows=${enriched.enriched}`);

  return {
    ...index,
    notes: [...notes, ...index.notes],
    archiveDryRunOnly: dryRunArchive,
    sourcesBaselined,
    storiesUpserted: stories.upserted,
    historicalRecordCount: historical.records.length,
  };
}

export { getSydneyIndexMetrics, buildHistoricalRecordsToArchive };
