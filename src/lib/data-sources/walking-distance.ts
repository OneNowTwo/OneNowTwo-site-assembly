import type { Point, LineString } from "geojson";
import { buildUrl, fetchJson, UpstreamError } from "./http";

/**
 * Pedestrian walking-distance provider.
 * Default: public OSRM foot profile (OpenStreetMap-based).
 * Override with WALKING_ROUTER_URL (Valhalla/ORS-compatible wrappers can be added later).
 */
export const WALKING_PROVIDER_NAME = process.env.WALKING_ROUTER_PROVIDER ?? "OSRM foot (OpenStreetMap)";
export const WALKING_ROUTER_BASE =
  process.env.WALKING_ROUTER_URL ?? "https://router.project-osrm.org/route/v1/foot";

export interface WalkingRouteResult {
  status: "OK" | "FAILED";
  straightLineDistanceM: number;
  walkingDistanceM: number | null;
  walkingDurationSec: number | null;
  geometry: LineString | null;
  provider: string;
  checkedAt: string;
  message?: string;
}

function haversineM(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6_371_000;
  const toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLng = toR(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function straightLineDistanceM(a: Point, b: Point): number {
  return haversineM(a.coordinates[0], a.coordinates[1], b.coordinates[0], b.coordinates[1]);
}

/** Nearest vertex on a polygon ring to a point (good enough for centre-boundary access). */
export function nearestPointOnRing(from: Point, ring: number[][]): Point {
  let best = ring[0]!;
  let bestD = Infinity;
  for (const pt of ring) {
    const d = haversineM(from.coordinates[0], from.coordinates[1], pt[0]!, pt[1]!);
    if (d < bestD) {
      bestD = d;
      best = pt;
    }
  }
  return { type: "Point", coordinates: [best[0]!, best[1]!] };
}

interface OsrmRouteResponse {
  code: string;
  routes?: { distance: number; duration: number; geometry?: { coordinates: number[][] } }[];
  message?: string;
}

export interface WalkingDistanceProvider {
  name: string;
  route(from: Point, to: Point): Promise<WalkingRouteResult>;
}

export class OsrmWalkingDistanceProvider implements WalkingDistanceProvider {
  readonly name = WALKING_PROVIDER_NAME;

  async route(from: Point, to: Point): Promise<WalkingRouteResult> {
    const checkedAt = new Date().toISOString();
    const straight = straightLineDistanceM(from, to);
    const coords = `${from.coordinates[0]},${from.coordinates[1]};${to.coordinates[0]},${to.coordinates[1]}`;
    const url = buildUrl(`${WALKING_ROUTER_BASE}/${coords}`, {
      overview: "full",
      geometries: "geojson",
      steps: "false",
    });
    try {
      const res = await fetchJson<OsrmRouteResponse>(url, { service: "OSRM walking", timeoutMs: 12000, ttlMs: 30 * 60 * 1000 });
      const r = res.routes?.[0];
      if (res.code !== "Ok" || !r) {
        return {
          status: "FAILED",
          straightLineDistanceM: Math.round(straight),
          walkingDistanceM: null,
          walkingDurationSec: null,
          geometry: null,
          provider: this.name,
          checkedAt,
          message: res.message ?? `Router returned ${res.code}`,
        };
      }
      return {
        status: "OK",
        straightLineDistanceM: Math.round(straight),
        walkingDistanceM: Math.round(r.distance),
        walkingDurationSec: Math.round(r.duration),
        geometry: r.geometry ? { type: "LineString", coordinates: r.geometry.coordinates as [number, number][] } : null,
        provider: this.name,
        checkedAt,
      };
    } catch (err) {
      return {
        status: "FAILED",
        straightLineDistanceM: Math.round(straight),
        walkingDistanceM: null,
        walkingDurationSec: null,
        geometry: null,
        provider: this.name,
        checkedAt,
        message: err instanceof UpstreamError ? err.message : err instanceof Error ? err.message : "Walking router failed",
      };
    }
  }
}

export const walkingDistanceProvider: WalkingDistanceProvider = new OsrmWalkingDistanceProvider();
