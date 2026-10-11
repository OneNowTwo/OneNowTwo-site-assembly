/**
 * Generic proposed-planning resolution for any NSW point.
 * Persisted PlanningChangeArea / KeySite first; adapter live enrichers second.
 * Consumers (Find / Map / Site Intelligence) must not contain council branching.
 */

import type { PlanningChangeAreaFact, ProposedPlanningFindFields } from "./types";
import { proposedFindFieldsAtPoint } from "./parcel-link";
import { loadProposedPlanningAreas } from "./load-persisted-areas";
import { listLiveProposedPointEnrichers } from "./live-point-enrichers";
// Side-effect: register adapter-owned live enrichers from the adapter registry.
import "./adapters/register-live-enrichers";

export interface ProposedPlanningAtPoint extends ProposedPlanningFindFields {
  sourceId: string | null;
  sourceUrl: string | null;
  areasSource: "persisted" | "fixture_fallback" | "provided";
}

const EMPTY: ProposedPlanningFindFields = {
  insidePlanningChangeArea: false,
  planningChangeStatus: null,
  proposedZone: null,
  proposedFsr: null,
  proposedHeight: null,
  keySiteId: null,
  requiredParcelCount: null,
};

/**
 * Resolve proposed / pending planning controls at a WGS84 point.
 * Geography-neutral entry point — add councils via registerLiveProposedPointEnricher only.
 */
export async function resolveProposedPlanningForPoint(input: {
  lng: number;
  lat: number;
  areas?: PlanningChangeAreaFact[];
}): Promise<ProposedPlanningAtPoint> {
  let areas = input.areas;
  let areasSource: ProposedPlanningAtPoint["areasSource"] = "provided";
  if (!areas) {
    const loaded = await loadProposedPlanningAreas();
    areas = loaded.areas;
    areasSource = loaded.source;
  }

  const base = proposedFindFieldsAtPoint({ lng: input.lng, lat: input.lat, areas }) ?? EMPTY;
  let sourceId: string | null = base.insidePlanningChangeArea
    ? areas.find((a) =>
        a.keySites?.some((k) => k.externalKeySiteId === base.keySiteId) ||
        a.status === base.planningChangeStatus,
      )?.id ??
      areas[0]?.id ??
      null
    : null;
  let sourceUrl: string | null =
    areas.find((a) => a.id === sourceId)?.sourceUrl ?? areas[0]?.sourceUrl ?? null;

  let merged: ProposedPlanningFindFields = { ...base };

  // Adapter live enrichers fill machine-readable controls when persisted area-level
  // rows lack FSR/height (e.g. council FeatureServer point query).
  for (const enricher of listLiveProposedPointEnrichers()) {
    try {
      if (!(await enricher.applies(input.lng, input.lat))) continue;
      const live = await enricher.enrich(input.lng, input.lat);
      if (!live) continue;
      const fsr = live.proposedFsr;
      const height = live.proposedHeight;
      if (fsr == null && height == null && !live.keySiteId && !live.proposedZone) continue;
      merged = {
        ...merged,
        insidePlanningChangeArea: true,
        planningChangeStatus: live.planningChangeStatus ?? merged.planningChangeStatus ?? "PROPOSED",
        proposedZone: live.proposedZone ?? merged.proposedZone,
        proposedFsr: fsr ?? merged.proposedFsr,
        proposedHeight: height ?? merged.proposedHeight,
        keySiteId: live.keySiteId ?? merged.keySiteId,
      };
      sourceId = enricher.sourceId;
      sourceUrl = live.sourceUrl ?? enricher.sourceUrl ?? sourceUrl;
      // First successful enricher wins for provenance; still allow later enrichers
      // only if they fill still-missing numeric controls.
      if (merged.proposedFsr != null && merged.proposedHeight != null) break;
    } catch {
      // Enricher failure must not break Find / Site Intelligence.
    }
  }

  return {
    ...merged,
    sourceId,
    sourceUrl,
    areasSource,
  };
}
