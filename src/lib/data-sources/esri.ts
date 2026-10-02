import type { Polygon, MultiPolygon, Position } from "geojson";

export interface EsriPolygon {
  rings: number[][][];
}

export interface EsriFeature<A> {
  attributes: A;
  geometry?: EsriPolygon;
}

export interface EsriQueryResponse<A> {
  features: EsriFeature<A>[];
  exceededTransferLimit?: boolean;
}

/** Signed area (shoelace); in Esri JSON outer rings are clockwise (negative here), holes counter-clockwise. */
function ringSignedArea(ring: number[][]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return sum / 2;
}

function pointInRing(pt: number[], ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Convert Esri polygon rings into a GeoJSON Polygon or MultiPolygon (RFC 7946 winding). */
export function esriToGeoJSON(geom: EsriPolygon): Polygon | MultiPolygon | null {
  const rings = (geom.rings ?? []).filter((r) => r.length >= 4);
  if (!rings.length) return null;
  const outers: Position[][][] = [];
  const holes: Position[][] = [];
  for (const ring of rings) {
    if (ringSignedArea(ring) < 0) outers.push([[...ring].reverse()]);
    else holes.push([...ring].reverse());
  }
  if (!outers.length) {
    // Some services emit counter-clockwise outers; treat every ring as an outer.
    return rings.length === 1
      ? { type: "Polygon", coordinates: [rings[0]] }
      : { type: "MultiPolygon", coordinates: rings.map((r) => [r]) };
  }
  for (const hole of holes) {
    const owner = outers.find((o) => pointInRing(hole[0], o[0])) ?? outers[0];
    owner.push(hole);
  }
  return outers.length === 1
    ? { type: "Polygon", coordinates: outers[0] }
    : { type: "MultiPolygon", coordinates: outers };
}
