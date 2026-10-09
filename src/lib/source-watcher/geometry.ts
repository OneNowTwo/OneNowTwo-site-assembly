import type { BBox } from "./types";

export function pointInBBox(lng: number, lat: number, bbox: BBox): boolean {
  return lng >= bbox.west && lng <= bbox.east && lat >= bbox.south && lat <= bbox.north;
}

/** Ray-cast point-in-polygon for a GeoJSON polygon ring (outer ring only). */
export function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0]!;
    const yi = ring[i]![1]!;
    const xj = ring[j]![0]!;
    const yj = ring[j]![1]!;
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-15) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function pointInGeometry(
  lng: number,
  lat: number,
  geometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon | null,
  bbox?: BBox | null,
): boolean {
  if (geometry?.type === "Polygon") {
    const ring = geometry.coordinates[0];
    return ring ? pointInRing(lng, lat, ring) : false;
  }
  if (geometry?.type === "MultiPolygon") {
    return geometry.coordinates.some((poly) => {
      const ring = poly[0];
      return ring ? pointInRing(lng, lat, ring) : false;
    });
  }
  if (bbox) return pointInBBox(lng, lat, bbox);
  return false;
}
