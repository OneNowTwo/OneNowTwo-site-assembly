import buffer from "@turf/buffer";
import intersect from "@turf/intersect";
import area from "@turf/area";
import bbox from "@turf/bbox";
import { featureCollection } from "@turf/helpers";
import type { Feature, Polygon, MultiPolygon } from "geojson";

export interface GeoParcel {
  id: string;
  geometry: Polygon | MultiPolygon;
}

export type Adjacency = Map<string, Set<string>>;

export interface AdjacencyOptions {
  /** Gap tolerated between boundaries (metres) — absorbs digitising slivers in the cadastre. */
  toleranceM?: number;
  /** Minimum shared boundary (metres) — excludes lots that only touch at a corner. */
  minSharedBoundaryM?: number;
}

/**
 * Two lots are neighbours when their boundaries touch or lie within `toleranceM`, sharing at least
 * `minSharedBoundaryM` of boundary. Each lot is buffered by half the tolerance; the overlap of two
 * buffers is a strip ≈ toleranceM wide, so shared length ≈ overlap area ÷ toleranceM.
 */
export function buildAdjacency(parcels: GeoParcel[], opts: AdjacencyOptions = {}): Adjacency {
  const tol = opts.toleranceM ?? 1;
  const minShared = opts.minSharedBoundaryM ?? 2;
  const padDeg = (tol / 111_320) * 1.5;
  const items = parcels.map((p) => {
    const f: Feature<Polygon | MultiPolygon> = { type: "Feature", properties: {}, geometry: p.geometry };
    const buffered = buffer(f, tol / 2, { units: "meters" }) as Feature<Polygon | MultiPolygon> | undefined;
    const [w, s, e, n] = bbox(f);
    return { id: p.id, buffered: buffered ?? f, box: [w - padDeg, s - padDeg, e + padDeg, n + padDeg] };
  });
  const adj: Adjacency = new Map(parcels.map((p) => [p.id, new Set<string>()]));
  const order = items.map((_, i) => i).sort((x, y) => items[x].box[0] - items[y].box[0]);
  for (let oi = 0; oi < order.length; oi++) {
    const A = items[order[oi]];
    for (let oj = oi + 1; oj < order.length; oj++) {
      const B = items[order[oj]];
      if (B.box[0] > A.box[2]) break;
      if (B.box[1] > A.box[3] || B.box[3] < A.box[1]) continue;
      const overlap = intersect(featureCollection([A.buffered, B.buffered]));
      if (!overlap) continue;
      const sharedLength = area(overlap) / tol;
      if (sharedLength >= minShared) {
        adj.get(A.id)!.add(B.id);
        adj.get(B.id)!.add(A.id);
      }
    }
  }
  return adj;
}

/** True when all ids form one connected component of the adjacency graph. */
export function isConnected(ids: string[], adj: Adjacency): boolean {
  if (ids.length <= 1) return true;
  const set = new Set(ids);
  const seen = new Set([ids[0]]);
  const stack = [ids[0]];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const n of adj.get(cur) ?? []) {
      if (set.has(n) && !seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return seen.size === set.size;
}

/** Connected components of the sub-graph induced by ids. */
export function components(ids: string[], adj: Adjacency): string[][] {
  const set = new Set(ids);
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const comp: string[] = [];
    const stack = [id];
    seen.add(id);
    while (stack.length) {
      const cur = stack.pop()!;
      comp.push(cur);
      for (const n of adj.get(cur) ?? []) {
        if (set.has(n) && !seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    out.push(comp);
  }
  return out;
}

/** Degree of each id within the sub-graph induced by ids. */
export function inducedDegree(ids: string[], adj: Adjacency): Map<string, number> {
  const set = new Set(ids);
  return new Map(ids.map((id) => [id, [...(adj.get(id) ?? [])].filter((n) => set.has(n)).length]));
}
