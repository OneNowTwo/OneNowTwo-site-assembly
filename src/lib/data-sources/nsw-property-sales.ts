import { buildUrl, fetchJson } from "./http";
import type { EsriQueryResponse } from "./esri";

/**
 * NSW SIX Maps — public Valuation MapServer property sales layers.
 * Source: https://maps.six.nsw.gov.au/arcgis/rest/services/public/Valuation/MapServer
 *
 * Licensing: NSW Property Sales Information (PSI) is free for non-commercial /
 * research use. Commercial products require an appropriate licence from Valuation NSW.
 * This client is labelled for MVP/research until a commercial PSI licence is confirmed.
 */
export const NSW_PROPERTY_SALES_BASE =
  process.env.NSW_PROPERTY_SALES_URL ?? "https://maps.six.nsw.gov.au/arcgis/rest/services/public/Valuation/MapServer";

/** Urban Property Sales layer. */
export const NSW_URBAN_SALES_LAYER = 1;

export const NSW_SALES_SOURCE_LABEL = "NSW REGISTERED SALE";
export const NSW_SALES_PROVIDER = "NSW_PSI";

export interface NswRegisteredSale {
  propid: number | null;
  dealing: string | null;
  houseNo: string | null;
  street: string | null;
  suburb: string | null;
  postcode: number | null;
  address: string;
  salePrice: number;
  saleDate: string | null;
  saleDateMs: number | null;
  landAreaSqm: number | null;
  strata: boolean;
  lastSale: boolean;
  lng: number;
  lat: number;
  source: typeof NSW_SALES_SOURCE_LABEL;
}

interface SaleAttrs {
  propid?: number | null;
  dealing?: string | null;
  house_no?: string | null;
  street?: string | null;
  suburb?: string | null;
  postcode?: number | null;
  bp_address?: string | null;
  price?: number | null;
  sale_date?: string | null;
  area?: number | null;
  strata?: number | null;
  last_sale?: string | null;
}

interface EsriPoint {
  x?: number;
  y?: number;
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

export function parseNswSaleDate(raw: string | null | undefined): { iso: string | null; ms: number | null } {
  if (!raw?.trim()) return { iso: null, ms: null };
  const s = raw.trim();
  for (const fmt of [
    /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/,
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
  ]) {
    const m = s.match(fmt);
    if (!m) continue;
    if (fmt.source.includes("[A-Za-z]")) {
      const d = new Date(`${m[1]} ${m[2]} ${m[3]} UTC`);
      if (!Number.isNaN(d.getTime())) return { iso: d.toISOString().slice(0, 10), ms: d.getTime() };
    } else {
      const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
      if (!Number.isNaN(d.getTime())) return { iso: d.toISOString().slice(0, 10), ms: d.getTime() };
    }
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return { iso: d.toISOString().slice(0, 10), ms: d.getTime() };
  return { iso: null, ms: null };
}

function metresToDeg(lat: number, metres: number): { dLat: number; dLng: number } {
  const dLat = metres / 111_320;
  const dLng = metres / (111_320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return { dLat, dLng };
}

function mapFeature(f: { attributes: SaleAttrs; geometry?: EsriPoint }): NswRegisteredSale | null {
  const a = f.attributes;
  const price = a.price ?? 0;
  const lng = f.geometry?.x;
  const lat = f.geometry?.y;
  if (!(price > 0) || lng == null || lat == null) return null;
  const street = a.street ? titleCase(a.street) : null;
  const houseNo = a.house_no?.trim() || null;
  const suburb = a.suburb ? titleCase(a.suburb) : null;
  const address =
    a.bp_address?.trim() ||
    [houseNo, street, suburb].filter(Boolean).join(" ") ||
    `propid:${a.propid ?? "?"}`;
  const { iso, ms } = parseNswSaleDate(a.sale_date);
  const strataRaw = a.strata ?? 0;
  // Non-strata houses are 0; strata units often carry a large strata plan number.
  const strata = strataRaw !== 0;
  return {
    propid: a.propid ?? null,
    dealing: a.dealing ?? null,
    houseNo,
    street,
    suburb,
    postcode: a.postcode ?? null,
    address: titleCase(address),
    salePrice: price,
    saleDate: iso,
    saleDateMs: ms,
    landAreaSqm: a.area != null && a.area > 0 ? a.area : null,
    strata,
    lastSale: String(a.last_sale ?? "").toUpperCase() === "Y",
    lng,
    lat,
    source: NSW_SALES_SOURCE_LABEL,
  };
}

/** Haversine distance in metres. */
export function haversineM(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6_371_000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dphi = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Filter a prefetched sales pool to those within radius of a subject (same cut as point query). */
export function filterSalesNearPoint(
  sales: NswRegisteredSale[],
  lng: number,
  lat: number,
  radiusM = 1000,
): NswRegisteredSale[] {
  const max = radiusM * 1.05;
  return sales.filter((s) => haversineM(lng, lat, s.lng, s.lat) <= max);
}

/**
 * Query urban registered sales intersecting an envelope (no per-point distance filter).
 * Used to prefetch once per suburb/scan area then filter locally per subject.
 */
export async function queryNswUrbanSalesInEnvelope(input: {
  west: number;
  south: number;
  east: number;
  north: number;
  suburb?: string | null;
}): Promise<NswRegisteredSale[]> {
  const suburb = input.suburb?.trim().toUpperCase();
  const where = suburb ? `suburb = '${suburb.replace(/'/g, "''")}'` : "1=1";
  const envelope = `${input.west},${input.south},${input.east},${input.north}`;

  const url = buildUrl(`${NSW_PROPERTY_SALES_BASE}/${NSW_URBAN_SALES_LAYER}/query`, {
    where,
    geometry: envelope,
    geometryType: "esriGeometryEnvelope",
    inSR: 4326,
    spatialRel: "esriSpatialRelIntersects",
    outFields: "propid,dealing,house_no,street,suburb,postcode,bp_address,price,sale_date,area,strata,last_sale",
    returnGeometry: true,
    outSR: 4326,
    f: "json",
  });

  const res = await fetchJson<EsriQueryResponse<SaleAttrs> & { features: { attributes: SaleAttrs; geometry?: EsriPoint }[] }>(url, {
    service: "NSW Property Sales",
    timeoutMs: 20000,
    ttlMs: 6 * 60 * 60 * 1000,
  });

  const out: NswRegisteredSale[] = [];
  for (const f of res.features ?? []) {
    const mapped = mapFeature(f);
    if (mapped) out.push(mapped);
  }
  return out;
}

/**
 * Query recent urban registered sales near a point.
 * Spatial filter via envelope; attribute filters applied client-side for service quirks.
 */
export async function queryNswUrbanSalesNear(input: {
  lng: number;
  lat: number;
  radiusM?: number;
  suburb?: string | null;
  maxRecords?: number;
}): Promise<NswRegisteredSale[]> {
  const radiusM = input.radiusM ?? 1000;
  const { dLat, dLng } = metresToDeg(input.lat, radiusM);
  const sales = await queryNswUrbanSalesInEnvelope({
    west: input.lng - dLng,
    south: input.lat - dLat,
    east: input.lng + dLng,
    north: input.lat + dLat,
    suburb: input.suburb,
  });
  return filterSalesNearPoint(sales, input.lng, input.lat, radiusM);
}

/**
 * Prefetch NSW urban sales once for a set of subject parcels (grouped by suburb).
 * Returns a pool; callers must filterNear each subject for identical scoring inputs.
 */
export async function prefetchNswSalesForParcels(
  parcels: { lng: number; lat: number; suburb?: string | null }[],
  radiusM = 1000,
): Promise<{ pool: NswRegisteredSale[]; fetchCount: number }> {
  if (!parcels.length) return { pool: [], fetchCount: 0 };
  const bySuburb = new Map<string, { lngs: number[]; lats: number[] }>();
  for (const p of parcels) {
    const key = (p.suburb ?? "").trim().toUpperCase() || "_ANY_";
    const g = bySuburb.get(key) ?? { lngs: [], lats: [] };
    g.lngs.push(p.lng);
    g.lats.push(p.lat);
    bySuburb.set(key, g);
  }

  const { dLat: padLat, dLng: padLng } = metresToDeg(
    parcels.reduce((s, p) => s + p.lat, 0) / parcels.length,
    radiusM,
  );

  const groups = [...bySuburb.entries()];
  const CONCURRENCY = 4;
  const pools: NswRegisteredSale[] = [];
  let fetchCount = 0;
  for (let i = 0; i < groups.length; i += CONCURRENCY) {
    const slice = groups.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      slice.map(async ([key, g]) => {
        fetchCount += 1;
        return queryNswUrbanSalesInEnvelope({
          west: Math.min(...g.lngs) - padLng,
          south: Math.min(...g.lats) - padLat,
          east: Math.max(...g.lngs) + padLng,
          north: Math.max(...g.lats) + padLat,
          suburb: key === "_ANY_" ? null : key,
        });
      }),
    );
    for (const rows of results) pools.push(...rows);
  }

  // Dedupe by dealing|propid|price|date
  const seen = new Set<string>();
  const pool: NswRegisteredSale[] = [];
  for (const s of pools) {
    const k = `${s.dealing ?? ""}|${s.propid ?? ""}|${s.salePrice}|${s.saleDate ?? ""}|${s.lng},${s.lat}`;
    if (seen.has(k)) continue;
    seen.add(k);
    pool.push(s);
  }
  return { pool, fetchCount };
}

/** Find historic sales for the subject address (any date). */
export async function queryNswSubjectSales(input: {
  houseNo?: string | null;
  street?: string | null;
  suburb?: string | null;
  lng: number;
  lat: number;
}): Promise<NswRegisteredSale[]> {
  const suburb = input.suburb?.trim().toUpperCase();
  const street = input.street?.trim().toUpperCase().replace(/'/g, "''");
  const house = input.houseNo?.trim().toUpperCase().replace(/'/g, "''");
  if (!suburb || !street) return [];

  const clauses = [`suburb = '${suburb}'`, `street LIKE '%${street}%'`];
  if (house) clauses.push(`house_no LIKE '${house}%'`);
  const where = clauses.join(" AND ");

  const url = buildUrl(`${NSW_PROPERTY_SALES_BASE}/${NSW_URBAN_SALES_LAYER}/query`, {
    where,
    outFields: "propid,dealing,house_no,street,suburb,postcode,bp_address,price,sale_date,area,strata,last_sale",
    returnGeometry: true,
    outSR: 4326,
    f: "json",
  });

  try {
    const res = await fetchJson<EsriQueryResponse<SaleAttrs> & { features: { attributes: SaleAttrs; geometry?: EsriPoint }[] }>(url, {
      service: "NSW Property Sales (subject)",
      timeoutMs: 15000,
      ttlMs: 24 * 60 * 60 * 1000,
    });
    const mapped = (res.features ?? []).map(mapFeature).filter((s): s is NswRegisteredSale => !!s);
    // Prefer geometrically close matches (same street name can collide).
    return mapped
      .map((s) => ({ s, d: haversineM(input.lng, input.lat, s.lng, s.lat) }))
      .filter((x) => x.d < 80)
      .sort((a, b) => (b.s.saleDateMs ?? 0) - (a.s.saleDateMs ?? 0))
      .map((x) => x.s);
  } catch {
    return [];
  }
}

/** Parse "5 Reserve Street" → house + street tokens. */
export function parseAddressParts(address?: string | null): { houseNo: string | null; street: string | null } {
  if (!address?.trim()) return { houseNo: null, street: null };
  const cleaned = address.replace(/,.*$/, "").trim();
  const m = cleaned.match(/^([\d]+[A-Za-z]?[\dA-Za-z\-\/]*)\s+(.+)$/);
  if (!m) return { houseNo: null, street: cleaned };
  return { houseNo: m[1]!, street: m[2]! };
}
