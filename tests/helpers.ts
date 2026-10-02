import type { Polygon } from "geojson";
import type { OpportunityLot } from "@/lib/analysis/opportunity";

const ORIGIN = { lat: -33.835, lng: 151.218 };
const M_PER_DEG_LAT = 111_320;
const mPerDegLng = M_PER_DEG_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180);

/** Axis-aligned rectangle in metres from a test origin — for unit tests only. */
export function rect(x: number, y: number, w: number, h: number): Polygon {
  const p = (dx: number, dy: number) => [ORIGIN.lng + dx / mPerDegLng, ORIGIN.lat + dy / M_PER_DEG_LAT];
  return { type: "Polygon", coordinates: [[p(x, y), p(x + w, y), p(x + w, y + h), p(x, y + h), p(x, y)]] };
}

export function lot(id: string, x: number, opts: Partial<OpportunityLot> = {}): OpportunityLot {
  const w = 20;
  const h = 35;
  return {
    id,
    label: id,
    areaSqm: w * h,
    zone: "R4",
    zoneName: "High Density Residential",
    fsr: 1.5,
    heightM: 18,
    minLotSizeSqm: null,
    heritage: "None mapped",
    isStrata: false,
    planningKnown: true,
    marketValue: 1_300_000,
    geometry: rect(x, 0, w, h),
    included: true,
    maxAllocationOverride: null,
    openingOfferOverride: null,
    ...opts,
  };
}

/** Five lots in a row: A|B|C|D|E sharing side boundaries. */
export function row(n = 5, opts: Partial<OpportunityLot> = {}) {
  return Array.from({ length: n }, (_, i) => lot(String.fromCharCode(65 + i), i * 20, opts));
}
