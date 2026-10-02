import type { Polygon, MultiPolygon } from "geojson";

export type DataOrigin = "LIVE_NSW" | "CACHED_NSW" | "MANUAL";

/** Provenance attached to every planning field (brief §32). */
export interface FieldSource {
  /** OFFICIAL = NSW government dataset, ASSUMPTION = user entered, ESTIMATE = system derived. */
  kind: "OFFICIAL" | "ASSUMPTION" | "ESTIMATE";
  source: string;
  retrievedAt: string | null;
}

/** One official FSR control intersecting a cadastral parcel. */
export interface FsrControl {
  fsr: number;
  epiName: string | null;
  lga: string | null;
  layClass: string | null;
  intersectionAreaSqm: number;
  /** 0–1 share of the parcel area covered by this control. */
  intersectionShare: number;
}

export type FsrMappedStatus = "MAPPED" | "SPLIT" | "NO_MAPPED" | "UNAVAILABLE";

export interface PlanningControls {
  zone: string | null;
  zoneName: string | null;
  /**
   * Official mapped FSR when a single control covers the parcel, or the area-weighted
   * equivalent when split (for GFA maths). Null when no official FSR polygon intersects.
   */
  fsr: number | null;
  /** How official FSR was resolved for this parcel — never a silent generic assumption. */
  fsrStatus: FsrMappedStatus;
  /** All intersecting official FSR controls (empty when NO_MAPPED / UNAVAILABLE). */
  fsrControls: FsrControl[];
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
