import { contentHash } from "./hash";
import { diffNormalisedPayloads } from "./diff";
import { SOURCE_DEFINITIONS } from "./registry";
import type { DiffEvent, FetchResult, NormalisedSourcePayload, SourceAdapter, SourceDefinition } from "./types";
import { edgecliffFixtureAdapter, innerWestFixtureAdapter } from "./adapters/fixtures";
import {
  daCdcPccAdapter,
  existingServiceAdapter,
  hdaAdapter,
  majorProjectsAdapter,
  planningProposalRegisterAdapter,
} from "./adapters/stubs";

export interface InMemorySnapshot {
  contentHash: string;
  normalised: NormalisedSourcePayload;
  retrievedAt: string;
}

export interface SourceRunResult {
  sourceId: string;
  status: "SUCCEEDED" | "UNCHANGED" | "FAILED" | "SKIPPED";
  contentHash?: string;
  events: DiffEvent[];
  error?: string;
  normalised?: NormalisedSourcePayload;
}

const adapters: Record<string, SourceAdapter> = {
  "fixture-edgecliff-woollahra": edgecliffFixtureAdapter,
  "fixture-inner-west-fairer-future": innerWestFixtureAdapter,
  "nsw-planning-proposal-register": planningProposalRegisterAdapter,
  "nsw-hda-records": hdaAdapter,
  "nsw-major-projects": majorProjectsAdapter,
  "nsw-da-cdc-pcc": daCdcPccAdapter,
  "nsw-epi-primary-planning": existingServiceAdapter(
    "nsw-epi-primary-planning",
    "current_controls",
    "On-demand via nswPlanningProvider — weekly bulk refresh not yet scheduled.",
  ),
  "nsw-cadastre": existingServiceAdapter("nsw-cadastre", "cadastre", "On-demand via nswCadastreProvider."),
  "nsw-registered-sales": existingServiceAdapter("nsw-registered-sales", "sales", "On-demand via nsw-property-sales."),
  "nsw-planning-proposal-agency": existingServiceAdapter(
    "nsw-planning-proposal-agency",
    "planning_proposals_arcgis",
    "On-demand via nsw-planning-proposals ArcGIS layers.",
  ),
  "nsw-sepp-housing-lmr": existingServiceAdapter("nsw-sepp-housing-lmr", "lmr_centres", "On-demand via housing-sepp-lmr."),
  "tfnsw-gtfs-stops": existingServiceAdapter("tfnsw-gtfs-stops", "transport", "TfNSW GTFS adapter not yet implemented."),
};

/** Pure watcher step for one source — no DB. */
export async function runSourceOnce(
  sourceId: string,
  previous: InMemorySnapshot | null,
  opts?: { adapter?: SourceAdapter },
): Promise<SourceRunResult> {
  const adapter = opts?.adapter ?? adapters[sourceId];
  if (!adapter) {
    return { sourceId, status: "SKIPPED", events: [], error: "No adapter registered" };
  }
  try {
    const fetched: FetchResult = await adapter.fetch();
    const hash = contentHash(fetched.normalised);
    if (previous && previous.contentHash === hash) {
      return { sourceId, status: "UNCHANGED", contentHash: hash, events: [], normalised: fetched.normalised };
    }
    const events = diffNormalisedPayloads(sourceId, previous?.normalised ?? null, fetched.normalised);
    return {
      sourceId,
      status: "SUCCEEDED",
      contentHash: hash,
      events,
      normalised: fetched.normalised,
    };
  } catch (err) {
    return {
      sourceId,
      status: "FAILED",
      events: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runSourceWatcherPass(opts?: {
  sourceIds?: string[];
  previousBySource?: Map<string, InMemorySnapshot>;
}): Promise<{ results: SourceRunResult[]; events: DiffEvent[] }> {
  const ids = opts?.sourceIds ?? SOURCE_DEFINITIONS.filter((s) => s.enabled !== false).map((s) => s.id);
  const previousBySource = opts?.previousBySource ?? new Map<string, InMemorySnapshot>();
  const results: SourceRunResult[] = [];
  const events: DiffEvent[] = [];
  for (const id of ids) {
    const result = await runSourceOnce(id, previousBySource.get(id) ?? null);
    results.push(result);
    events.push(...result.events);
    if (result.status === "SUCCEEDED" && result.contentHash && result.normalised) {
      previousBySource.set(id, {
        contentHash: result.contentHash,
        normalised: result.normalised,
        retrievedAt: new Date().toISOString(),
      });
    }
  }
  return { results, events };
}

export function listWatchableSources(): SourceDefinition[] {
  return SOURCE_DEFINITIONS;
}

export function getAdapter(sourceId: string): SourceAdapter | undefined {
  return adapters[sourceId];
}
