import area from "@turf/area";
import booleanIntersects from "@turf/boolean-intersects";
import intersect from "@turf/intersect";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { FsrControl, FsrMappedStatus } from "@/lib/types";

export interface FsrPolygonInput {
  fsr: number;
  epiName: string | null;
  lga: string | null;
  layClass: string | null;
  feature: Feature<Polygon | MultiPolygon>;
}

export interface ParcelFsrResult {
  /** Dominant / sole mapped FSR, or area-weighted equivalent when split. Null when no mapped control. */
  fsr: number | null;
  status: FsrMappedStatus;
  controls: FsrControl[];
  /** Σ (intersection area × FSR) — use for theoretical GFA of this parcel. */
  theoreticalGfa: number;
  mappedAreaSqm: number;
}

const MIN_SHARE = 0.005; // ignore slivers under 0.5%

function asFeature(geom: Polygon | MultiPolygon): Feature<Polygon | MultiPolygon> {
  return { type: "Feature", properties: {}, geometry: geom };
}

function measureIntersectionSqm(parcel: Feature<Polygon | MultiPolygon>, control: Feature<Polygon | MultiPolygon>): number {
  if (!booleanIntersects(parcel, control)) return 0;
  try {
    const fc = { type: "FeatureCollection", features: [parcel, control] } as FeatureCollection<Polygon | MultiPolygon>;
    const hit = intersect(fc);
    if (!hit) return 0;
    return area(hit);
  } catch {
    // Degenerate geometries occasionally throw; treat as no usable intersection.
    return 0;
  }
}

/**
 * Intersect a cadastral parcel polygon with official NSW FSR control polygons.
 * Does not invent FSR — returns NO_MAPPED when nothing intersects.
 * Split parcels keep every meaningful control (by intersection share); fsr is the
 * area-weighted equivalent for GFA maths only, never a silent average for display.
 */
export function resolveParcelFsr(parcelGeom: Polygon | MultiPolygon, polygons: FsrPolygonInput[]): ParcelFsrResult {
  const parcel = asFeature(parcelGeom);
  const parcelArea = Math.max(area(parcel), 1e-9);
  const raw: FsrControl[] = [];

  for (const p of polygons) {
    const intersectionAreaSqm = measureIntersectionSqm(parcel, p.feature);
    if (intersectionAreaSqm <= 0) continue;
    const share = intersectionAreaSqm / parcelArea;
    if (share < MIN_SHARE) continue;
    raw.push({
      fsr: p.fsr,
      epiName: p.epiName,
      lga: p.lga,
      layClass: p.layClass,
      intersectionAreaSqm,
      intersectionShare: share,
    });
  }

  // Merge identical FSR + instrument rows (overlapping/duplicate layer features).
  const merged = new Map<string, FsrControl>();
  for (const c of raw) {
    const key = `${c.fsr}|${c.epiName ?? ""}`;
    const prev = merged.get(key);
    if (!prev) {
      merged.set(key, { ...c });
      continue;
    }
    prev.intersectionAreaSqm += c.intersectionAreaSqm;
    prev.intersectionShare += c.intersectionShare;
  }

  const controls = [...merged.values()].sort((a, b) => b.intersectionShare - a.intersectionShare);
  if (!controls.length) {
    return { fsr: null, status: "NO_MAPPED", controls: [], theoreticalGfa: 0, mappedAreaSqm: 0 };
  }

  const mappedAreaSqm = controls.reduce((s, c) => s + c.intersectionAreaSqm, 0);
  const theoreticalGfa = controls.reduce((s, c) => s + c.intersectionAreaSqm * c.fsr, 0);
  const distinct = new Set(controls.map((c) => c.fsr));
  const status: FsrMappedStatus = distinct.size > 1 || controls.length > 1 ? "SPLIT" : "MAPPED";
  // Equivalent FSR over the full parcel (unmapped residual contributes 0).
  const fsr = Math.round((theoreticalGfa / parcelArea) * 1000) / 1000;

  return { fsr, status, controls, theoreticalGfa, mappedAreaSqm };
}
