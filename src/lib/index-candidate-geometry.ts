import type { MultiPolygon, Polygon } from "geojson";
import type { ParcelData } from "@/lib/types";

/** Cap exact-ID cadastre hydration so INDEX_CANDIDATE stays tiny (not a bbox scan). */
export const INDEX_CANDIDATE_PARCEL_ID_CAP = 16;

export function capParcelIds(ids: string[], cap = INDEX_CANDIDATE_PARCEL_ID_CAP): string[] {
  const cleaned = [...new Set(ids.map(String).filter((id) => /^nsw-cadid:\d+$/.test(id)))];
  return cleaned.slice(0, Math.max(0, cap));
}

/**
 * Build a drawable site geometry from member lot polygons.
 * Prefer MultiPolygon of all rings — no bbox/LMR/scan dependency.
 */
export function siteGeometryFromParcels(
  parcels: Array<{ geometry: Polygon | MultiPolygon | null | undefined }>,
): Polygon | MultiPolygon | null {
  const polys: number[][][][] = [];
  for (const p of parcels) {
    const g = p.geometry;
    if (!g) continue;
    if (g.type === "Polygon" && Array.isArray(g.coordinates)) {
      polys.push(g.coordinates as number[][][]);
    } else if (g.type === "MultiPolygon" && Array.isArray(g.coordinates)) {
      for (const poly of g.coordinates) polys.push(poly as number[][][]);
    }
  }
  if (!polys.length) return null;
  if (polys.length === 1) return { type: "Polygon", coordinates: polys[0]! };
  return { type: "MultiPolygon", coordinates: polys };
}

export function parcelsMissingDrawableGeometry(
  requestedIds: string[],
  stored: ParcelData[],
): string[] {
  const byId = new Map(stored.map((p) => [p.externalParcelId, p]));
  return requestedIds.filter((id) => {
    const p = byId.get(id);
    return !p?.geometry;
  });
}

export type IndexCandidateSiteCard = {
  address: string | null;
  suburb: string | null;
  lotCount: number | null;
  siteAreaSqm: number | null;
  currentFsr: number | null;
  proposedFsr: number | null;
};

export function formatIndexCandidateSummary(card: IndexCandidateSiteCard): string {
  const bits: string[] = [];
  if (card.suburb) bits.push(card.suburb);
  if (card.lotCount != null) bits.push(card.lotCount === 1 ? "1 lot" : `${card.lotCount} lots`);
  if (card.siteAreaSqm != null && card.siteAreaSqm > 0) {
    bits.push(`${Math.round(card.siteAreaSqm).toLocaleString("en-AU")} m²`);
  }
  if (card.currentFsr != null) bits.push(`FSR ${card.currentFsr}`);
  if (card.proposedFsr != null) bits.push(`proposed ${card.proposedFsr}`);
  return bits.join(" · ");
}
