import area from "@turf/area";
import centroid from "@turf/centroid";
import pointOnFeature from "@turf/point-on-feature";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import type { Feature, Polygon, MultiPolygon } from "geojson";
import type { BBox, ParcelData } from "@/lib/types";
import { buildUrl, fetchJson } from "./http";
import { esriToGeoJSON, type EsriQueryResponse } from "./esri";
import type { CadastreProvider } from "./providers";

/** NSW Spatial Services — NSW Land Parcel & Property Theme (ArcGIS FeatureServer). */
export const NSW_CADASTRE_BASE =
  process.env.NSW_CADASTRE_URL ??
  "https://portal.spatial.nsw.gov.au/server/rest/services/NSW_Land_Parcel_Property_Theme/FeatureServer";
const LOT_LAYER = 8;
const PROPERTY_LAYER = 12;
export const CADASTRE_SOURCE_LABEL = "NSW Spatial Services — Land Parcel & Property Theme (Lot / Property layers)";

/** Max bbox edge in degrees (~1.1 km) — keeps responses within the 2,000 record service limit. */
export const MAX_BBOX_SPAN_DEG = 0.01;

interface LotAttrs {
  cadid: number;
  lotnumber: string | null;
  sectionnumber: string | null;
  planlabel: string | null;
  planlotarea: number | null;
  lotidstring: string | null;
}

interface PropertyAttrs {
  address: string | null;
  principaladdresstype: number | null;
  propid: number;
}

const STREET_TYPES =
  "STREET|ROAD|AVENUE|LANE|PLACE|PARADE|CRESCENT|DRIVE|CLOSE|COURT|WAY|TERRACE|HIGHWAY|BOULEVARD|CIRCUIT|GROVE|ESPLANADE|SQUARE|WALK|RISE|ROW|PROMENADE|STREET NORTH|STREET SOUTH|ROAD NORTH|ROAD SOUTH";
const ADDRESS_RE = new RegExp(`^(.*?\\b(?:${STREET_TYPES}))\\s+(.+)$`);

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

/** "33 BYDOWN STREET NEUTRAL BAY" → { street: "33 Bydown Street", suburb: "Neutral Bay" } */
export function splitNswAddress(raw: string | null): { address: string | null; suburb: string | null } {
  if (!raw) return { address: null, suburb: null };
  const m = raw.trim().match(ADDRESS_RE);
  if (!m) return { address: titleCase(raw), suburb: null };
  const street = titleCase(m[1]);
  const suburb = titleCase(m[2]);
  return { address: `${street}, ${suburb}`, suburb };
}

function envelope(b: BBox): string {
  return `${b.west},${b.south},${b.east},${b.north}`;
}

function queryUrl(layer: number, bbox: BBox, outFields: string, extra: Record<string, string | number> = {}) {
  return buildUrl(`${NSW_CADASTRE_BASE}/${layer}/query`, {
    where: "1=1",
    geometry: envelope(bbox),
    geometryType: "esriGeometryEnvelope",
    inSR: 4326,
    spatialRel: "esriSpatialRelIntersects",
    outFields,
    returnGeometry: true,
    outSR: 4326,
    geometryPrecision: 7,
    resultRecordCount: 2000,
    f: "json",
    ...extra,
  });
}

export function clampBBox(b: BBox): BBox {
  const cx = (b.west + b.east) / 2;
  const cy = (b.south + b.north) / 2;
  const hw = Math.min((b.east - b.west) / 2, MAX_BBOX_SPAN_DEG / 2);
  const hh = Math.min((b.north - b.south) / 2, MAX_BBOX_SPAN_DEG / 2);
  return { west: cx - hw, east: cx + hw, south: cy - hh, north: cy + hh };
}

export const nswCadastreProvider: CadastreProvider = {
  name: CADASTRE_SOURCE_LABEL,
  async getParcelsInBBox(input) {
    const bbox = clampBBox(input);
    const [lots, props] = await Promise.all([
      fetchJson<EsriQueryResponse<LotAttrs>>(
        queryUrl(LOT_LAYER, bbox, "cadid,lotnumber,sectionnumber,planlabel,planlotarea,lotidstring"),
        { service: "NSW cadastre (Lot)", timeoutMs: 20000 },
      ),
      fetchJson<EsriQueryResponse<PropertyAttrs>>(
        queryUrl(PROPERTY_LAYER, bbox, "address,principaladdresstype,propid", { where: "principaladdresstype=1" }),
        { service: "NSW cadastre (Property)", timeoutMs: 20000 },
      ).catch(() => ({ features: [] }) as EsriQueryResponse<PropertyAttrs>),
    ]);

    const propertyPolys: { address: string | null; geom: Feature<Polygon | MultiPolygon> }[] = [];
    for (const f of props.features) {
      if (!f.geometry) continue;
      const g = esriToGeoJSON(f.geometry);
      if (g) propertyPolys.push({ address: f.attributes.address, geom: { type: "Feature", properties: {}, geometry: g } });
    }

    const retrievedAt = new Date().toISOString();
    const out: Omit<ParcelData, "planning" | "planningStatus">[] = [];
    const seen = new Set<number>();
    for (const f of lots.features) {
      const a = f.attributes;
      if (!f.geometry || seen.has(a.cadid)) continue;
      seen.add(a.cadid);
      const geometry = esriToGeoJSON(f.geometry);
      if (!geometry) continue;
      const feature: Feature<Polygon | MultiPolygon> = { type: "Feature", properties: {}, geometry };
      const computedArea = area(feature);
      if (computedArea < 15) continue; // slivers / stratum artefacts
      const inside = pointOnFeature(feature);
      const c = centroid(feature).geometry.coordinates as [number, number];
      const match = propertyPolys.find((p) => booleanPointInPolygon(inside, p.geom));
      const { address, suburb } = splitNswAddress(match?.address ?? null);
      const plan = a.planlabel ?? null;
      out.push({
        externalParcelId: `nsw-cadid:${a.cadid}`,
        source: "LIVE_NSW",
        lot: a.lotnumber,
        section: a.sectionnumber,
        dp: plan,
        lotIdString: a.lotidstring,
        address,
        suburb,
        geometry,
        centroid: c,
        areaSqm: Math.round(a.planlotarea && a.planlotarea > 0 ? a.planlotarea : computedArea),
        isStrata: !!plan && plan.startsWith("SP"),
        retrievedAt,
      });
    }
    return out;
  },
};
