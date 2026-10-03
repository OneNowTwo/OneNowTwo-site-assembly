import type { Point } from "geojson";
import type { BBox } from "@/lib/types";
import { buildUrl, fetchJson } from "./http";
import type { EsriQueryResponse } from "./esri";

/**
 * NSW Housing SEPP 2021 — Town Centres Map (official nominated LMR centres).
 * Walking catchments are not published as a queryable production layer here; we use
 * straight-line distance as an APPROXIMATE screen only and never claim confirmed walking eligibility.
 */
export const HOUSING_SEPP_BASE =
  process.env.NSW_HOUSING_SEPP_URL ??
  "https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/SEPP_Housing_2021/MapServer";

export const TOWN_CENTRES_LAYER = 6;
export const LMR_SOURCE_LABEL = "State Environmental Planning Policy (Housing) 2021 — Low and Mid-Rise Housing Policy";
export const TOWN_CENTRES_SOURCE_LABEL = "NSW Planning Portal — SEPP (Housing) 2021 Town Centres Map";

export type LmrBand = "INNER_0_400" | "OUTER_400_800" | "OUTSIDE";

export interface NominatedCentre {
  id: string;
  label: string;
  layClass: string | null;
  /** Representative point from official centre polygon (centroid of first ring). */
  lng: number;
  lat: number;
  /** Outer ring of the official centre polygon (WGS84), when available. */
  boundaryRing?: number[][];
  source: string;
  retrievedAt: string;
}

interface TownCentreAttrs {
  OBJECTID?: number;
  LABEL?: string;
  LAY_CLASS?: string;
  LGA_NAME?: string;
  MAP_NAME?: string;
}

/** Non-discretionary standards from NSW Planning “Summary of key provisions” (stage 2). */
export const LMR_RFB_STANDARDS = {
  /** R1 / R2 residential flat buildings (where permitted under LMR). */
  r1r2: { fsr: 0.8, heightM: 17.5, storeys: 4 },
  /** R3 / R4 inner 0–400 m. */
  r3r4Inner: { fsr: 2.2, heightM: 22, storeys: 6 },
  /** R3 / R4 outer 400–800 m. */
  r3r4Outer: { fsr: 1.5, heightM: 17.5, storeys: 4 },
} as const;

const DEG_PER_M_LAT = 1 / 111_320;

function haversineM(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6_371_000;
  const toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLng = toR(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function ringCentroid(ring: number[][]): { lng: number; lat: number } {
  let x = 0;
  let y = 0;
  const n = Math.max(ring.length - (ring.length > 1 ? 1 : 0), 1);
  for (let i = 0; i < n; i++) {
    x += ring[i]![0]!;
    y += ring[i]![1]!;
  }
  return { lng: x / n, lat: y / n };
}

export function lmrBandFromDistanceM(distanceM: number): LmrBand {
  if (distanceM <= 400) return "INNER_0_400";
  if (distanceM <= 800) return "OUTER_400_800";
  return "OUTSIDE";
}

export function bboxAround(lng: number, lat: number, radiusM: number): BBox {
  const dLat = radiusM * DEG_PER_M_LAT;
  const dLng = radiusM * DEG_PER_M_LAT * Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  return { west: lng - dLng, east: lng + dLng, south: lat - dLat, north: lat + dLat };
}

/** Fetch official nominated town centres intersecting a bbox. */
export async function fetchNominatedCentres(bbox: BBox): Promise<NominatedCentre[]> {
  const retrievedAt = new Date().toISOString();
  const url = buildUrl(`${HOUSING_SEPP_BASE}/${TOWN_CENTRES_LAYER}/query`, {
    where: "1=1",
    geometry: `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
    geometryType: "esriGeometryEnvelope",
    inSR: 4326,
    spatialRel: "esriSpatialRelIntersects",
    outFields: "OBJECTID,LABEL,LAY_CLASS,LGA_NAME,MAP_NAME",
    returnGeometry: true,
    outSR: 4326,
    geometryPrecision: 6,
    resultRecordCount: 200,
    f: "json",
  });
  const res = await fetchJson<EsriQueryResponse<TownCentreAttrs>>(url, {
    service: "SEPP Housing Town Centres",
    timeoutMs: 25000,
  });
  const out: NominatedCentre[] = [];
  for (const f of res.features ?? []) {
    const label = f.attributes.LABEL?.trim();
    if (!label || !f.geometry?.rings?.[0]?.length) continue;
    const ring = f.geometry.rings[0]!;
    const c = ringCentroid(ring);
    out.push({
      id: `town-centre:${f.attributes.OBJECTID ?? label}`,
      label,
      layClass: f.attributes.LAY_CLASS ?? null,
      lng: c.lng,
      lat: c.lat,
      boundaryRing: ring,
      source: TOWN_CENTRES_SOURCE_LABEL,
      retrievedAt,
    });
  }
  return out;
}

export interface LmrProximity {
  centre: NominatedCentre;
  distanceM: number;
  band: LmrBand;
  /** Straight-line screen only — walking confirmation is applied via WalkingDistanceProvider. */
  distanceBasis: "STRAIGHT_LINE_APPROXIMATION";
}

/** Nearest nominated centre and approximate straight-line band. */
export function nearestLmrCentre(point: Point, centres: NominatedCentre[]): LmrProximity | null {
  if (!centres.length) return null;
  let best: LmrProximity | null = null;
  for (const centre of centres) {
    const distanceM = haversineM(point.coordinates[0], point.coordinates[1], centre.lng, centre.lat);
    const cand: LmrProximity = {
      centre,
      distanceM,
      band: lmrBandFromDistanceM(distanceM),
      distanceBasis: "STRAIGHT_LINE_APPROXIMATION",
    };
    if (!best || cand.distanceM < best.distanceM) best = cand;
  }
  return best;
}

export interface LmrStandardResult {
  applicable: boolean;
  fsr: number | null;
  heightM: number | null;
  developmentType: string;
  zoneEligible: boolean;
  reason: string;
}

/**
 * Potential LMR RFB / shop-top non-discretionary standards for a zone + band.
 * Does NOT confirm walking eligibility or site-specific exclusions.
 */
export function lmrRfbStandardForZone(zone: string | null, band: LmrBand): LmrStandardResult {
  if (band === "OUTSIDE") {
    return { applicable: false, fsr: null, heightM: null, developmentType: "n/a", zoneEligible: false, reason: "Outside approximate 800 m screen of a nominated centre" };
  }
  if (!zone) {
    return { applicable: false, fsr: null, heightM: null, developmentType: "residential flat building", zoneEligible: false, reason: "Zone unknown — cannot assess LMR permissibility" };
  }
  if (/^R[12]$/.test(zone)) {
    const s = LMR_RFB_STANDARDS.r1r2;
    return {
      applicable: true,
      fsr: s.fsr,
      heightM: s.heightM,
      developmentType: "residential flat building / shop-top (R1–R2 LMR standards)",
      zoneEligible: true,
      reason: `R1/R2 LMR RFB standards may apply in ${band === "INNER_0_400" ? "inner" : "outer"} area (subject to walking catchment + exclusions)`,
    };
  }
  if (/^R[34]$/.test(zone)) {
    const s = band === "INNER_0_400" ? LMR_RFB_STANDARDS.r3r4Inner : LMR_RFB_STANDARDS.r3r4Outer;
    return {
      applicable: true,
      fsr: s.fsr,
      heightM: s.heightM,
      developmentType: "residential flat building / shop-top (R3–R4 LMR standards)",
      zoneEligible: true,
      reason: `R3/R4 LMR ${band === "INNER_0_400" ? "inner 0–400 m" : "outer 400–800 m"} RFB standards may apply (subject to walking catchment + exclusions)`,
    };
  }
  return {
    applicable: false,
    fsr: null,
    heightM: null,
    developmentType: "n/a",
    zoneEligible: false,
    reason: `Zone ${zone} is not an R1–R4 residential zone for LMR RFB standards`,
  };
}
