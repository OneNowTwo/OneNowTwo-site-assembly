/**
 * KeySite ↔ cadastral parcel linking.
 * Membership: KeySite polygon ∩ parcel polygon with material intersection area.
 * Address↔lot: spatial property polygon contains parcel representative point (not array order).
 */

import area from "@turf/area";
import booleanIntersects from "@turf/boolean-intersects";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import centroid from "@turf/centroid";
import intersect from "@turf/intersect";
import pointOnFeature from "@turf/point-on-feature";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { buildUrl, fetchJson } from "@/lib/data-sources/http";
import { NSW_CADASTRE_BASE, splitNswAddress } from "@/lib/data-sources/nsw-cadastre";
import { esriToGeoJSON, type EsriQueryResponse } from "@/lib/data-sources/esri";
import { pointInGeometry } from "./geometry";
import type { BBox, KeySiteFact, KeySiteHit, PlanningChangeAreaFact, ProposedPlanningFindFields } from "./types";
import { loadFixturePlanningAreas, resolveKeySitesForPoint, resolveProposedPlanningAtPoint } from "./key-sites";

interface LotAttrs {
  cadid: number;
  lotidstring: string | null;
  planlabel: string | null;
  lotnumber: string | null;
  sectionnumber: string | null;
}

interface PropertyAttrs {
  address: string | null;
  propid: number;
  principaladdresstype?: number | null;
}

export interface LinkedParcel {
  externalParcelId: string;
  cadid: number;
  address: string | null;
  suburb: string | null;
  lotLabel: string | null;
  lot: string | null;
  section: string | null;
  dp: string | null;
  lotIdString: string | null;
  geometry: Polygon | MultiPolygon;
  centroid: [number, number];
  areaSqm: number;
  intersectionSqm: number;
  matchMethod: "POLYGON_INTERSECTION";
  addressMatchMethod: "PROPERTY_CONTAINS_POINT" | "NONE";
}

/** Ignore sliver intersections under 0.5% of the smaller of parcel / key-site area. */
const MIN_INTERSECTION_SHARE = 0.005;

function bboxFromSite(site: KeySiteFact): BBox | null {
  if (site.bbox) return site.bbox;
  const g = site.geometry;
  if (!g) return null;
  const coords =
    g.type === "Polygon"
      ? g.coordinates[0] ?? []
      : g.type === "MultiPolygon"
        ? g.coordinates.flatMap((p) => p[0] ?? [])
        : [];
  if (!coords.length) return null;
  const xs = coords.map((c) => c[0]!);
  const ys = coords.map((c) => c[1]!);
  return { west: Math.min(...xs), south: Math.min(...ys), east: Math.max(...xs), north: Math.max(...ys) };
}

function asFeature(geom: Polygon | MultiPolygon): Feature<Polygon | MultiPolygon> {
  return { type: "Feature", properties: {}, geometry: geom };
}

function sitePolygon(site: KeySiteFact): Feature<Polygon | MultiPolygon> | null {
  if (site.geometry) return asFeature(site.geometry);
  const bbox = bboxFromSite(site);
  if (!bbox) return null;
  const { west, south, east, north } = bbox;
  return asFeature({
    type: "Polygon",
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  });
}

/** Material polygon ∩ polygon area (sqm). 0 when only boundary-touch / no overlap. */
export function intersectionAreaSqm(
  a: Polygon | MultiPolygon,
  b: Polygon | MultiPolygon,
): number {
  const fa = asFeature(a);
  const fb = asFeature(b);
  if (!booleanIntersects(fa, fb)) return 0;
  try {
    const fc = { type: "FeatureCollection", features: [fa, fb] } as FeatureCollection<Polygon | MultiPolygon>;
    const hit = intersect(fc);
    if (!hit) return 0;
    return area(hit);
  } catch {
    return 0;
  }
}

function hintsAsLinked(site: KeySiteFact): LinkedParcel[] {
  return (site.requiredParcelHints ?? []).map((h, i) => ({
    externalParcelId: `hint:${i}:${h}`,
    cadid: -1,
    address: h,
    suburb: null,
    lotLabel: h,
    lot: null,
    section: null,
    dp: null,
    lotIdString: null,
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [0, 0],
          [0, 0],
          [0, 0],
          [0, 0],
        ],
      ],
    },
    centroid: [0, 0],
    areaSqm: 0,
    intersectionSqm: 0,
    matchMethod: "POLYGON_INTERSECTION",
    addressMatchMethod: "NONE",
  }));
}

/** Query cadastral lots with proper KeySite polygon intersection + spatial address match. */
export async function resolveParcelsForKeySite(site: KeySiteFact): Promise<LinkedParcel[]> {
  const siteFeat = sitePolygon(site);
  const bbox = bboxFromSite(site);
  if (!siteFeat || !bbox) return hintsAsLinked(site);

  try {
    const lotUrl = buildUrl(`${NSW_CADASTRE_BASE}/8/query`, {
      where: "1=1",
      geometry: `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
      geometryType: "esriGeometryEnvelope",
      inSR: 4326,
      spatialRel: "esriSpatialRelIntersects",
      outFields: "cadid,lotidstring,planlabel,lotnumber,sectionnumber",
      returnGeometry: true,
      outSR: 4326,
      resultRecordCount: 120,
      f: "json",
    });
    const propUrl = buildUrl(`${NSW_CADASTRE_BASE}/12/query`, {
      where: "principaladdresstype=1",
      geometry: `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
      geometryType: "esriGeometryEnvelope",
      inSR: 4326,
      spatialRel: "esriSpatialRelIntersects",
      outFields: "address,propid,principaladdresstype",
      returnGeometry: true,
      outSR: 4326,
      resultRecordCount: 120,
      f: "json",
    });
    const [lots, props] = await Promise.all([
      fetchJson<EsriQueryResponse<LotAttrs>>(lotUrl, { service: "nsw-cadastre-lots", ttlMs: 10 * 60 * 1000 }),
      fetchJson<EsriQueryResponse<PropertyAttrs>>(propUrl, {
        service: "nsw-cadastre-props",
        ttlMs: 10 * 60 * 1000,
      }).catch(() => ({ features: [] }) as EsriQueryResponse<PropertyAttrs>),
    ]);

    const propertyPolys: { address: string | null; geom: Feature<Polygon | MultiPolygon> }[] = [];
    for (const f of props.features ?? []) {
      if (!f.geometry) continue;
      const g = esriToGeoJSON(f.geometry);
      if (g) propertyPolys.push({ address: f.attributes.address, geom: { type: "Feature", properties: {}, geometry: g } });
    }

    const siteArea = Math.max(area(siteFeat), 1e-9);
    const linked: LinkedParcel[] = [];
    const seen = new Set<number>();

    for (const f of lots.features ?? []) {
      const a = f.attributes;
      if (!f.geometry || seen.has(a.cadid)) continue;
      const geometry = esriToGeoJSON(f.geometry);
      if (!geometry) continue;
      const parcelFeat = asFeature(geometry);
      const parcelArea = Math.max(area(parcelFeat), 1e-9);
      const ix = intersectionAreaSqm(siteFeat.geometry, geometry);
      if (ix <= 0) continue;
      const share = ix / Math.min(parcelArea, siteArea);
      if (share < MIN_INTERSECTION_SHARE) continue;
      // Avoid pure boundary-touch: require interior-ish area (absolute floor ~1 m²).
      if (ix < 1) continue;

      seen.add(a.cadid);
      const inside = pointOnFeature(parcelFeat);
      const c = centroid(parcelFeat).geometry.coordinates as [number, number];
      const propMatch = propertyPolys.find((p) => booleanPointInPolygon(inside, p.geom));
      const { address, suburb } = splitNswAddress(propMatch?.address ?? null);
      const plan = a.planlabel ?? null;

      linked.push({
        externalParcelId: `nsw-cadid:${a.cadid}`,
        cadid: a.cadid,
        address,
        suburb,
        lotLabel: plan ? `Lot ${a.lotnumber ?? "?"} ${plan}` : a.lotidstring ?? `cad:${a.cadid}`,
        lot: a.lotnumber,
        section: a.sectionnumber,
        dp: plan,
        lotIdString: a.lotidstring,
        geometry,
        centroid: c,
        areaSqm: Math.round(parcelArea),
        intersectionSqm: Math.round(ix),
        matchMethod: "POLYGON_INTERSECTION",
        addressMatchMethod: propMatch ? "PROPERTY_CONTAINS_POINT" : "NONE",
      });
    }

    if (linked.length) {
      linked.sort((x, y) => y.intersectionSqm - x.intersectionSqm);
      return linked;
    }
  } catch {
    // Fall through to hints.
  }

  return hintsAsLinked(site);
}

/** Enrich KeySite hits with parcel links for Site page / ANALYSE REQUIRED ASSEMBLY. */
export async function resolveKeySitesWithParcels(input: {
  lng: number;
  lat: number;
  areas?: PlanningChangeAreaFact[];
}): Promise<KeySiteHit[]> {
  const hits = resolveKeySitesForPoint(input);
  const out: KeySiteHit[] = [];
  for (const hit of hits) {
    const parcels = await resolveParcelsForKeySite(hit.keySite);
    const real = parcels.filter((p) => p.externalParcelId.startsWith("nsw-cadid:"));
    const requiredCount = real.length || hit.requiredCount;
    let yourIndex: number | null = null;
    if (real.length) {
      const idx = real.findIndex((p) => pointInGeometry(input.lng, input.lat, p.geometry, null));
      yourIndex = idx >= 0 ? idx + 1 : 1;
    } else if (hit.requiredCount) {
      yourIndex = 1;
    }
    const ids = real.map((p) => p.externalParcelId);
    const addresses = real.map((p) => p.address ?? p.lotLabel ?? p.externalParcelId);
    out.push({
      ...hit,
      requiredCount,
      requiredParcelIds: ids.length ? ids : hit.keySite.requiredParcelIds,
      requiredAddresses: addresses.length ? addresses : hit.keySite.requiredParcelHints,
      keySite: {
        ...hit.keySite,
        requiredParcelIds: ids.length ? ids : hit.keySite.requiredParcelIds,
        requiredParcelHints:
          hit.keySite.requiredParcelHints?.length
            ? hit.keySite.requiredParcelHints
            : addresses,
      },
      yourPropertyIndex: yourIndex,
    });
  }
  return out;
}

export function proposedFindFieldsAtPoint(input: {
  lng: number;
  lat: number;
  areas?: PlanningChangeAreaFact[];
}): ProposedPlanningFindFields {
  const areas = input.areas ?? loadFixturePlanningAreas();
  const proposed = resolveProposedPlanningAtPoint({ ...input, areas });
  const area = proposed.planningChangeAreas[0];
  const ks = proposed.keySites[0];
  const controls = ks?.keySite.incentiveControls ?? ks?.keySite.proposedControls ?? area?.proposedControls;
  return {
    insidePlanningChangeArea: proposed.planningChangeAreas.length > 0,
    planningChangeStatus: area?.status ?? null,
    proposedZone: controls?.zone ?? null,
    proposedFsr: controls?.incentiveFsr ?? controls?.fsr ?? null,
    proposedHeight: controls?.incentiveHeightM ?? controls?.heightM ?? null,
    keySiteId: ks?.keySite.externalKeySiteId ?? null,
    requiredParcelCount: ks?.requiredCount ?? null,
  };
}
