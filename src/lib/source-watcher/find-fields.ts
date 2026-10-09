/**
 * Minimal Find / scanner fields for proposed planning (Phase 2).
 * Full natural-language Find is Phase 3.
 */

import type { ProposedPlanningFindFields } from "./types";
import { proposedFindFieldsAtPoint } from "./parcel-link";

export type { ProposedPlanningFindFields };

export const PROPOSED_FIND_FIELD_KEYS = [
  "insidePlanningChangeArea",
  "planningChangeStatus",
  "proposedZone",
  "proposedFsr",
  "proposedHeight",
  "keySiteId",
  "requiredParcelCount",
] as const;

export function annotateParcelWithProposedFindFields(input: {
  lng: number;
  lat: number;
}): ProposedPlanningFindFields {
  return proposedFindFieldsAtPoint(input);
}

/** Filter predicate for scanner / watch filters. */
export function matchesProposedFindFilters(
  fields: ProposedPlanningFindFields,
  filters: {
    insidePlanningChangeArea?: boolean | null;
    planningChangeStatus?: string | null;
    proposedZone?: string | null;
    minProposedFsr?: number | null;
    minProposedHeight?: number | null;
    keySiteId?: string | null;
    minRequiredParcelCount?: number | null;
  },
): boolean {
  if (filters.insidePlanningChangeArea != null && fields.insidePlanningChangeArea !== filters.insidePlanningChangeArea) {
    return false;
  }
  if (filters.planningChangeStatus && fields.planningChangeStatus !== filters.planningChangeStatus) return false;
  if (filters.proposedZone && fields.proposedZone !== filters.proposedZone) return false;
  if (filters.minProposedFsr != null && (fields.proposedFsr == null || fields.proposedFsr < filters.minProposedFsr)) {
    return false;
  }
  if (
    filters.minProposedHeight != null &&
    (fields.proposedHeight == null || fields.proposedHeight < filters.minProposedHeight)
  ) {
    return false;
  }
  if (filters.keySiteId && fields.keySiteId !== filters.keySiteId) return false;
  if (
    filters.minRequiredParcelCount != null &&
    (fields.requiredParcelCount == null || fields.requiredParcelCount < filters.minRequiredParcelCount)
  ) {
    return false;
  }
  return true;
}
