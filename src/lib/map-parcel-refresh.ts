import type { ParcelData } from "@/lib/types";

/** Minimum parcels with geometry to treat a scan handoff as map-usable. */
export const MIN_SCAN_PARCELS_FOR_MAP = 3;

export interface ScanParcelSufficiencyInput {
  valuedParcels: ParcelData[] | null | undefined;
  /** Lot ids referenced by ranked scan candidates (externalParcelId). */
  candidateLotIds: string[];
}

/**
 * True when the scan already returned enough parcel geometry for the map /
 * Analyse handoff — so a second /api/parcels hit is unnecessary.
 */
export function scanReturnedSufficientParcels(input: ScanParcelSufficiencyInput): boolean {
  const parcels = (input.valuedParcels ?? []).filter((p) => !!p?.geometry && !!p.externalParcelId);
  if (!parcels.length) return false;

  const have = new Set(parcels.map((p) => p.externalParcelId));
  const needed = [...new Set(input.candidateLotIds.filter(Boolean))];

  if (needed.length > 0) {
    let hit = 0;
    for (const id of needed) if (have.has(id)) hit++;
    // Cover at least half of ranked-lot ids, and never less than 2 when multiple lots exist.
    const minHits = Math.min(needed.length, Math.max(2, Math.ceil(needed.length * 0.5)));
    return hit >= minHits;
  }

  return parcels.length >= MIN_SCAN_PARCELS_FOR_MAP;
}

/** Soft-fail a transient gateway error only when the map already has usable parcels. */
export function shouldSilentSoftFailTransient(opts: {
  transient: boolean;
  explicitRetry: boolean;
  usableParcelCount: number;
}): boolean {
  if (!opts.transient || opts.explicitRetry) return false;
  return opts.usableParcelCount > 0;
}

export const POST_SCAN_PARCEL_COOLDOWN_MS = 10_000;
export const POST_SCAN_PARCEL_REFRESH_DELAY_MS = 10_000;
