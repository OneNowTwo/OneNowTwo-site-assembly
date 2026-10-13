import { buildMapHref } from "@/lib/map/map-target";

/** Minimal Find row fields needed to build a Map deep-link. */
export type FindMapHrefInput = {
  key: string;
  candidateId?: string | null;
  opportunityId: string | null;
  keySiteId: string | null;
  lotIds: string[];
  bboxHint: { west: number; south: number; east: number; north: number } | null;
  suburb: string | null;
  locationLabel: string;
};

/**
 * Map deep-link for a Find row.
 * Index results → lightweight INDEX_CANDIDATE (candidateId / canonicalKey).
 * Live deep-scan results → existing parcel / opportunity / scan path.
 *
 * Kept free of Prisma / scan imports so FindClient can use it safely.
 */
export function findResultMapHref(
  r: FindMapHrefInput,
  source: "index" | "live" = "live",
): string {
  if (source === "index") {
    // key is canonicalKey for index rows; candidateId preferred when present.
    return buildMapHref({
      candidateId: r.candidateId ?? null,
      canonicalKey: r.key || null,
      zoom: 18,
    });
  }
  return buildMapHref({
    opportunityId: r.opportunityId,
    keySiteId: r.keySiteId,
    parcelId: r.lotIds?.[0] ?? null,
    bbox: r.bboxHint ?? null,
    scan: r.suburb || r.locationLabel,
    zoom: 17,
  });
}
