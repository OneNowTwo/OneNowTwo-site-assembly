/**
 * Registry of adapter-owned live point enrichers for proposed planning.
 * Find / Map / Site Intelligence never import council-specific adapters —
 * they call resolveProposedPlanningForPoint, which consults this registry.
 */

export interface LiveProposedPointEnrichment {
  proposedZone?: string | null;
  proposedFsr?: number | null;
  proposedHeight?: number | null;
  keySiteId?: string | null;
  planningChangeStatus?: string | null;
  sourceUrl?: string | null;
}

export interface LiveProposedPointEnricher {
  sourceId: string;
  /** Optional static provenance URL when enrichment applies. */
  sourceUrl?: string | null;
  applies(lng: number, lat: number): boolean | Promise<boolean>;
  enrich(lng: number, lat: number): Promise<LiveProposedPointEnrichment | null>;
}

const enrichers: LiveProposedPointEnricher[] = [];

export function registerLiveProposedPointEnricher(enricher: LiveProposedPointEnricher): void {
  if (enrichers.some((e) => e.sourceId === enricher.sourceId)) return;
  enrichers.push(enricher);
}

export function listLiveProposedPointEnrichers(): readonly LiveProposedPointEnricher[] {
  return enrichers;
}

/** Test helper — clears registry between unit tests. */
export function clearLiveProposedPointEnrichersForTests(): void {
  enrichers.length = 0;
}
