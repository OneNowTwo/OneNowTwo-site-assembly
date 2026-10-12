/**
 * Greater Sydney market geography — complete LGA list for the selected market scope.
 * Approximate envelopes for tiling; cadastral load + planning attach refine per parcel.
 * Not a handful of test suburbs.
 */

import type { BBox } from "@/lib/types";

export type GreaterSydneyLga = {
  name: string;
  region:
    | "Eastern City"
    | "North"
    | "South"
    | "Central River City"
    | "Western City"
    | "Outer";
  /** Approximate WGS84 envelope for batch tiling. */
  bbox: BBox;
};

/** All LGAs in Greater Sydney (selected market scope sydney-metro). */
export const GREATER_SYDNEY_LGAS: GreaterSydneyLga[] = [
  { name: "Bayside", region: "Eastern City", bbox: { west: 151.12, south: -33.98, east: 151.25, north: -33.90 } },
  { name: "Blacktown", region: "Central River City", bbox: { west: 150.78, south: -33.82, east: 150.98, north: -33.68 } },
  { name: "Blue Mountains", region: "Western City", bbox: { west: 150.25, south: -33.80, east: 150.55, north: -33.55 } },
  { name: "Burwood", region: "Eastern City", bbox: { west: 151.08, south: -33.90, east: 151.13, north: -33.86 } },
  { name: "Camden", region: "Western City", bbox: { west: 150.65, south: -34.12, east: 150.85, north: -33.95 } },
  { name: "Campbelltown", region: "Western City", bbox: { west: 150.75, south: -34.15, east: 150.95, north: -33.98 } },
  { name: "Canada Bay", region: "Eastern City", bbox: { west: 151.08, south: -33.88, east: 151.16, north: -33.82 } },
  { name: "Canterbury-Bankstown", region: "South", bbox: { west: 150.95, south: -33.98, east: 151.15, north: -33.88 } },
  { name: "Cumberland", region: "Central River City", bbox: { west: 150.92, south: -33.90, east: 151.05, north: -33.78 } },
  { name: "Fairfield", region: "Western City", bbox: { west: 150.85, south: -33.95, east: 151.00, north: -33.82 } },
  { name: "Georges River", region: "South", bbox: { west: 151.05, south: -34.02, east: 151.18, north: -33.94 } },
  { name: "Hawkesbury", region: "Outer", bbox: { west: 150.55, south: -33.70, east: 150.90, north: -33.40 } },
  { name: "Hornsby", region: "North", bbox: { west: 150.95, south: -33.75, east: 151.20, north: -33.50 } },
  { name: "Hunters Hill", region: "North", bbox: { west: 151.12, south: -33.85, east: 151.16, north: -33.81 } },
  { name: "Inner West", region: "Eastern City", bbox: { west: 151.12, south: -33.92, east: 151.22, north: -33.85 } },
  { name: "Ku-ring-gai", region: "North", bbox: { west: 151.10, south: -33.78, east: 151.22, north: -33.68 } },
  { name: "Lane Cove", region: "North", bbox: { west: 151.14, south: -33.84, east: 151.19, north: -33.80 } },
  { name: "Liverpool", region: "Western City", bbox: { west: 150.78, south: -34.00, east: 150.98, north: -33.85 } },
  { name: "Mosman", region: "North", bbox: { west: 151.22, south: -33.85, east: 151.27, north: -33.81 } },
  { name: "North Sydney", region: "North", bbox: { west: 151.18, south: -33.86, east: 151.24, north: -33.82 } },
  { name: "Northern Beaches", region: "North", bbox: { west: 151.20, south: -33.82, east: 151.34, north: -33.58 } },
  { name: "Parramatta", region: "Central River City", bbox: { west: 150.98, south: -33.86, east: 151.10, north: -33.76 } },
  { name: "Penrith", region: "Western City", bbox: { west: 150.65, south: -33.85, east: 150.85, north: -33.68 } },
  { name: "Randwick", region: "Eastern City", bbox: { west: 151.22, south: -33.98, east: 151.28, north: -33.90 } },
  { name: "Ryde", region: "North", bbox: { west: 151.08, south: -33.85, east: 151.16, north: -33.78 } },
  { name: "Strathfield", region: "Eastern City", bbox: { west: 151.07, south: -33.90, east: 151.12, north: -33.86 } },
  { name: "Sutherland Shire", region: "South", bbox: { west: 150.95, south: -34.15, east: 151.18, north: -33.98 } },
  { name: "City of Sydney", region: "Eastern City", bbox: { west: 151.18, south: -33.92, east: 151.25, north: -33.85 } },
  { name: "The Hills Shire", region: "Central River City", bbox: { west: 150.90, south: -33.78, east: 151.08, north: -33.60 } },
  { name: "Waverley", region: "Eastern City", bbox: { west: 151.24, south: -33.92, east: 151.29, north: -33.87 } },
  { name: "Willoughby", region: "North", bbox: { west: 151.18, south: -33.82, east: 151.24, north: -33.76 } },
  { name: "Wollondilly", region: "Outer", bbox: { west: 150.45, south: -34.30, east: 150.80, north: -34.00 } },
  { name: "Woollahra", region: "Eastern City", bbox: { west: 151.23, south: -33.90, east: 151.29, north: -33.85 } },
];

export const GREATER_SYDNEY_LGA_COUNT = GREATER_SYDNEY_LGAS.length;

/** Tile an LGA envelope into cadastre-safe batches (~0.04° ~ 4 km). */
export function tileLgaBBox(bbox: BBox, maxSpan = 0.04): Array<{ tileKey: string; bbox: BBox }> {
  const tiles: Array<{ tileKey: string; bbox: BBox }> = [];
  const step = maxSpan * 0.95;
  let yi = 0;
  for (let south = bbox.south; south < bbox.north; south += step, yi++) {
    let xi = 0;
    for (let west = bbox.west; west < bbox.east; west += step, xi++) {
      const tile: BBox = {
        west,
        south,
        east: Math.min(bbox.east, west + maxSpan),
        north: Math.min(bbox.north, south + maxSpan),
      };
      tiles.push({
        tileKey: `${west.toFixed(4)}_${south.toFixed(4)}`,
        bbox: tile,
      });
    }
  }
  return tiles.length ? tiles : [{ tileKey: "full", bbox }];
}

export function buildSydneyIndexBatchPlan(): Array<{
  lga: string;
  region: string;
  tileKey: string;
  bbox: BBox;
}> {
  const out: Array<{ lga: string; region: string; tileKey: string; bbox: BBox }> = [];
  for (const lga of GREATER_SYDNEY_LGAS) {
    for (const tile of tileLgaBBox(lga.bbox)) {
      out.push({
        lga: lga.name,
        region: lga.region,
        tileKey: `${lga.name.replace(/\s+/g, "-").toLowerCase()}:${tile.tileKey}`,
        bbox: tile.bbox,
      });
    }
  }
  return out;
}
