import type { Polygon, MultiPolygon } from "geojson";

export type DataOrigin = "LIVE_NSW" | "CACHED_NSW" | "MANUAL";

/** Provenance attached to every planning field (brief §32). */
export interface FieldSource {
  /** OFFICIAL = NSW government dataset, ASSUMPTION = user entered, ESTIMATE = system derived. */
  kind: "OFFICIAL" | "ASSUMPTION" | "ESTIMATE";
  source: string;
  retrievedAt: string | null;
}

export interface PlanningControls {
  zone: string | null;
  zoneName: string | null;
  fsr: number | null;
  heightM: number | null;
  minLotSizeSqm: number | null;
  heritage: string | null;
  planningInstrument: string | null;
  lga: string | null;
  sources: Partial<Record<"zone" | "fsr" | "heightM" | "minLotSizeSqm" | "heritage", FieldSource>>;
}

export type PlanningStatus = "ok" | "partial" | "unavailable";

export interface ParcelData {
  /** Stable id, e.g. "nsw-cadid:100104808". */
  externalParcelId: string;
  source: DataOrigin;
  lot: string | null;
  section: string | null;
  dp: string | null;
  lotIdString: string | null;
  address: string | null;
  suburb: string | null;
  geometry: Polygon | MultiPolygon;
  centroid: [number, number]; // [lng, lat]
  areaSqm: number;
  isStrata: boolean;
  planning: PlanningControls | null;
  planningStatus: PlanningStatus;
  planningMessage?: string;
  retrievedAt: string;
}

export interface BBox {
  west: number;
  south: number;
  east: number;
  north: number;
}
