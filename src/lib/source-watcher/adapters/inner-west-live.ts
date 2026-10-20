/**
 * Live Inner West — Our Fairer Future / endorsed planning controls adapter.
 * Resolves ArcGIS Experience → WebMap → Adopted_Planning_Layers FeatureServer.
 * Does NOT scrape the rendered map.
 */

import { buildUrl, fetchJson } from "@/lib/data-sources/http";
import { esriToGeoJSON, type EsriQueryResponse } from "@/lib/data-sources/esri";
import {
  pickDeveloperRelevantLayers,
  resolveArcGisExperience,
  type ResolvedExperience,
} from "../arcgis-experience";
import type {
  FetchResult,
  KeySiteFact,
  NormalisedSourcePayload,
  ProposedControls,
  SourceAdapter,
} from "../types";

export const IW_EXPERIENCE_URL =
  "https://experience.arcgis.com/experience/2b5ffd9da4f44cd7b7886b632a180556/page/Page";
export const IW_EXPERIENCE_ITEM_ID = "2b5ffd9da4f44cd7b7886b632a180556";
export const IW_ADOPTED_FS =
  "https://services-ap1.arcgis.com/dp2UIID5MUpTUFVA/arcgis/rest/services/Adopted_Planning_Layers/FeatureServer";

/** Developer-relevant draft layer ids on Adopted_Planning_Layers. */
export const IW_LAYER = {
  LZN: 1,
  FSR: 3,
  HOB: 5,
  KYS: 7,
  IFS: 15,
  IHB: 16,
  AHC: 18,
} as const;

const IW_BBOX = { west: 151.12, south: -33.925, east: 151.2, north: -33.87 };

interface PointAttrs {
  [key: string]: unknown;
}

async function queryPoint<A extends PointAttrs>(
  layerId: number,
  lng: number,
  lat: number,
): Promise<A | null> {
  const url = buildUrl(`${IW_ADOPTED_FS}/${layerId}/query`, {
    where: "1=1",
    geometry: JSON.stringify({ x: lng, y: lat }),
    geometryType: "esriGeometryPoint",
    inSR: 4326,
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    returnGeometry: false,
    outSR: 4326,
    resultRecordCount: 1,
    f: "json",
  });
  const res = await fetchJson<EsriQueryResponse<A>>(url, {
    service: "iw-adopted-planning",
    ttlMs: 5 * 60 * 1000,
    timeoutMs: 20000,
  });
  return res.features[0]?.attributes ?? null;
}

function bboxFromPolygon(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon | null): KeySiteFact["bbox"] {
  if (!geom) return null;
  const rings =
    geom.type === "Polygon"
      ? geom.coordinates
      : geom.coordinates.flatMap((poly) => poly);
  const ring = rings[0] ?? [];
  const xs = ring.map((c) => c[0]!);
  const ys = ring.map((c) => c[1]!);
  if (!xs.length || !ys.length) return null;
  return {
    west: Math.min(...xs),
    south: Math.min(...ys),
    east: Math.max(...xs),
    north: Math.max(...ys),
  };
}

/** Interior point on the key-site polygon — never bbox centre (may fall outside). */
async function interiorPoint(
  geom: GeoJSON.Polygon | GeoJSON.MultiPolygon | null,
  bbox: NonNullable<KeySiteFact["bbox"]>,
): Promise<{ lng: number; lat: number }> {
  if (geom) {
    try {
      const pointOnFeature = (await import("@turf/point-on-feature")).default;
      const pt = pointOnFeature({ type: "Feature", properties: {}, geometry: geom });
      const [lng, lat] = pt.geometry.coordinates;
      if (Number.isFinite(lng) && Number.isFinite(lat)) return { lng: lng!, lat: lat! };
    } catch {
      // fall through
    }
  }
  return { lng: (bbox.west + bbox.east) / 2, lat: (bbox.south + bbox.north) / 2 };
}

const DISTINCT_QUERY_LIMIT = 80;

type DistinctAttrResult = {
  ok: boolean;
  values: string[];
  /** True when the query hit the record cap or ArcGIS transfer limit — incomplete. */
  truncated: boolean;
};

/**
 * Distinct control attribute values that intersect the key-site geometry
 * (or its bbox when geometry is missing). Filters envelope hits by true
 * polygon intersection so neighbouring controls are not counted as "mixed".
 * Failed / truncated queries return ok:false — callers must not treat that as uniform.
 */
async function queryDistinctAttrsOverKeySite(
  layerId: number,
  bbox: NonNullable<KeySiteFact["bbox"]>,
  field: string,
  geom: GeoJSON.Polygon | GeoJSON.MultiPolygon | null,
): Promise<DistinctAttrResult> {
  const usePoly = !!geom;
  const geometry = usePoly
    ? JSON.stringify(
        geom!.type === "Polygon"
          ? { rings: geom!.coordinates }
          : { rings: geom!.coordinates.flatMap((p) => p) },
      )
    : `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`;
  const url = buildUrl(`${IW_ADOPTED_FS}/${layerId}/query`, {
    where: "1=1",
    geometry,
    geometryType: usePoly ? "esriGeometryPolygon" : "esriGeometryEnvelope",
    inSR: 4326,
    spatialRel: "esriSpatialRelIntersects",
    outFields: field,
    returnGeometry: !usePoly, // need rings to filter when envelope-only
    outSR: 4326,
    resultRecordCount: DISTINCT_QUERY_LIMIT,
    f: "json",
  });
  try {
    const res = await fetchJson<EsriQueryResponse<Record<string, unknown>> & { exceededTransferLimit?: boolean }>(url, {
      service: "iw-key-site-distinct",
      ttlMs: 30 * 60 * 1000,
      timeoutMs: 15000,
    });
    const features = res.features ?? [];
    const truncated = features.length >= DISTINCT_QUERY_LIMIT || res.exceededTransferLimit === true;
    const vals = new Set<string>();
    if (usePoly || !geom) {
      for (const f of features) {
        const v = f.attributes?.[field];
        if (v == null || v === "") continue;
        vals.add(String(v));
      }
      return { ok: true, values: [...vals], truncated };
    }
    // Envelope fallback: keep only features that truly intersect the key-site polygon.
    const booleanIntersects = (await import("@turf/boolean-intersects")).default;
    const siteFeat = { type: "Feature" as const, properties: {}, geometry: geom! };
    for (const f of features) {
      if (!f.geometry) continue;
      const g = esriToGeoJSON(f.geometry);
      if (!g) continue;
      try {
        if (!booleanIntersects(siteFeat, { type: "Feature", properties: {}, geometry: g })) continue;
      } catch {
        continue;
      }
      const v = f.attributes?.[field];
      if (v == null || v === "") continue;
      vals.add(String(v));
    }
    return { ok: true, values: [...vals], truncated };
  } catch {
    return { ok: false, values: [], truncated: false };
  }
}

/**
 * Enrich a key-site with an interior-point screening sample + mixed-control check.
 * Never present a point sample as uniform controls across the whole key site when
 * intersecting control polygons disagree. Sample values are not parcel-level evidence.
 */
export async function enrichKeySiteProposedControls(site: KeySiteFact): Promise<KeySiteFact> {
  const bbox = site.bbox ?? bboxFromPolygon(site.geometry ?? null);
  if (!bbox) return site;
  try {
    const { lng, lat } = await interiorPoint(site.geometry ?? null, bbox);
    const siteGeom = site.geometry ?? null;
    const [live, zoneRes, fsrRes, heightRes] = await Promise.all([
      queryInnerWestProposedAtPoint(lng, lat),
      queryDistinctAttrsOverKeySite(IW_LAYER.LZN, bbox, "SYM_CODE", siteGeom),
      queryDistinctAttrsOverKeySite(IW_LAYER.FSR, bbox, "FSR", siteGeom),
      queryDistinctAttrsOverKeySite(IW_LAYER.HOB, bbox, "MAX_B_H", siteGeom),
    ]);
    const hasControls =
      live.zone != null || live.fsr != null || live.heightM != null || live.incentiveFsr != null || live.incentiveHeightM != null;
    if (!hasControls) return site;

    const zones = zoneRes.values;
    const distinctFsrs = fsrRes.values.map(Number).filter((n) => Number.isFinite(n));
    const distinctHeights = heightRes.values.map(Number).filter((n) => Number.isFinite(n));
    // Failed or truncated polygon queries must never establish "uniform" controls.
    const distinctIncomplete =
      !zoneRes.ok ||
      !fsrRes.ok ||
      !heightRes.ok ||
      zoneRes.truncated ||
      fsrRes.truncated ||
      heightRes.truncated;
    const mixedAcrossKeySite =
      distinctIncomplete ||
      zones.length > 1 ||
      new Set(distinctFsrs).size > 1 ||
      new Set(distinctHeights).size > 1;

    const screeningSample: NonNullable<ProposedControls["screeningSample"]> = {
      lng,
      lat,
      zone: live.zone,
      fsr: live.fsr,
      heightM: live.heightM,
      mixedAcrossKeySite,
      distinctZones: zones,
      distinctFsrs,
      distinctHeights,
      scope: "INTERIOR_POINT_SAMPLE",
    };

    const ahPct =
      live.affordableHousingLabel && /\d+/.test(live.affordableHousingLabel)
        ? Number(live.affordableHousingLabel.match(/\d+/)![0])
        : null;

    if (mixedAcrossKeySite) {
      const incompleteness = distinctIncomplete
        ? "Polygon distinct-control query failed or was truncated — controls are not verified as uniform. "
        : "";
      return {
        ...site,
        bbox,
        proposedControls: {
          legalStatus: "PROPOSED",
          machineReadable: true,
          // Do not assign uniform zone/FSR/height — mixed / incomplete evidence across the key site.
          zone: null,
          fsr: null,
          heightM: null,
          incentiveFsr: null,
          incentiveHeightM: null,
          affordableHousingContributionPct: Number.isFinite(ahPct) ? ahPct : null,
          screeningSample,
          notes: `${incompleteness}Mixed or unverified proposed controls across this key site (zones: ${zones.join(", ") || "—"}; FSR: ${distinctFsrs.join(", ") || "—"}; height m: ${distinctHeights.join(", ") || "—"}). Interior-point screening sample at ${lng.toFixed(5)},${lat.toFixed(5)}: zone ${live.zone ?? "—"}, FSR ${live.fsr ?? "—"}, height ${live.heightM ?? "—"} m. Sample is for screening only — not parcel-level evidence and not uniform across the area. Source: ${IW_ADOPTED_FS}. NOT CURRENT LAW until gazetted.`,
        },
      };
    }

    return {
      ...site,
      bbox,
      proposedControls: {
        legalStatus: "PROPOSED",
        machineReadable: true,
        zone: live.zone,
        fsr: live.fsr,
        heightM: live.heightM,
        incentiveFsr: live.incentiveFsr,
        incentiveHeightM: live.incentiveHeightM,
        affordableHousingContributionPct: Number.isFinite(ahPct) ? ahPct : null,
        screeningSample,
        notes: `Interior-point screening sample (verified uniform across intersecting control polygons for this key site) at ${lng.toFixed(5)},${lat.toFixed(5)} from Adopted_Planning_Layers. Not parcel-level evidence. Source: ${IW_ADOPTED_FS}. NOT CURRENT LAW until gazetted.`,
      },
    };
  } catch {
    return site;
  }
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return out;
}

async function queryKeySitesSample(limit = 40): Promise<KeySiteFact[]> {
  const url = buildUrl(`${IW_ADOPTED_FS}/${IW_LAYER.KYS}/query`, {
    where: "1=1",
    outFields: "KEYSITE_ID,LAY_CLASS,EPI_NAME,OBJECTID",
    returnGeometry: true,
    outSR: 4326,
    resultRecordCount: limit,
    f: "json",
  });
  const res = await fetchJson<
    EsriQueryResponse<{ KEYSITE_ID?: string; LAY_CLASS?: string; EPI_NAME?: string; OBJECTID?: number }>
  >(url, { service: "iw-key-sites", ttlMs: 30 * 60 * 1000, timeoutMs: 30000 });

  const base: KeySiteFact[] = (res.features ?? []).map((f, i) => {
    const id = String(f.attributes.KEYSITE_ID ?? f.attributes.OBJECTID ?? `IW-KYS-${i}`);
    const geom = f.geometry ? esriToGeoJSON(f.geometry) : null;
    const bbox = bboxFromPolygon(geom);
    return {
      externalKeySiteId: id,
      name: `Inner West key site ${id}`,
      geometry: geom,
      bbox,
      geometrySource: "OFFICIAL_FEATURE_SERVICE" as const,
      requiredParcelHints: [],
      proposedControls: {
        legalStatus: "PROPOSED",
        machineReadable: true,
        notes: "Draft Key Sites layer from Adopted_Planning_Layers FeatureServer",
      },
      structuredConditions: [],
    };
  });

  // Point-enrich each key site so Today detail can show real proposed controls
  // (zone / FSR / height) instead of notes-only placeholders.
  return mapPool(base, 4, enrichKeySiteProposedControls);
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

/** Live spatial lookup of proposed controls at a point (site page). */
export async function queryInnerWestProposedAtPoint(lng: number, lat: number): Promise<{
  zone: string | null;
  fsr: number | null;
  heightM: number | null;
  incentiveFsr: number | null;
  incentiveHeightM: number | null;
  affordableHousingLabel: string | null;
  keySiteId: string | null;
  source: string;
  geometrySource: "OFFICIAL_FEATURE_SERVICE";
}> {
  const [lzn, fsr, hob, ifs, ihb, ahc, kys] = await Promise.all([
    queryPoint<{ SYM_CODE?: string }>(IW_LAYER.LZN, lng, lat),
    queryPoint<{ FSR?: number }>(IW_LAYER.FSR, lng, lat),
    queryPoint<{ MAX_B_H?: number; MAX_B_H_M?: number }>(IW_LAYER.HOB, lng, lat),
    queryPoint<{ FSR?: number }>(IW_LAYER.IFS, lng, lat),
    queryPoint<{ MAX_B_H?: number; MAX_B_H_M?: number }>(IW_LAYER.IHB, lng, lat),
    queryPoint<{ Layer?: string }>(IW_LAYER.AHC, lng, lat),
    queryPoint<{ KEYSITE_ID?: string }>(IW_LAYER.KYS, lng, lat),
  ]);
  return {
    zone: lzn?.SYM_CODE ?? null,
    fsr: num(fsr?.FSR),
    heightM: num(hob?.MAX_B_H_M) ?? num(hob?.MAX_B_H),
    incentiveFsr: num(ifs?.FSR),
    incentiveHeightM: num(ihb?.MAX_B_H) ?? num(ihb?.MAX_B_H_M),
    affordableHousingLabel: typeof ahc?.Layer === "string" ? ahc.Layer : null,
    keySiteId: kys?.KEYSITE_ID ? String(kys.KEYSITE_ID) : null,
    source: IW_ADOPTED_FS,
    geometrySource: "OFFICIAL_FEATURE_SERVICE",
  };
}

export class InnerWestLiveAdapter implements SourceAdapter {
  readonly id = "live-inner-west-fairer-future";

  async fetch(): Promise<FetchResult> {
    const resolved: ResolvedExperience = await resolveArcGisExperience(IW_EXPERIENCE_URL, {
      enrichServices: true,
    });
    const relevant = pickDeveloperRelevantLayers(resolved);
    const keySites = await queryKeySitesSample(30);

    const proposedControls: ProposedControls = {
      legalStatus: "PROPOSED",
      machineReadable: true,
      notes:
        "Draft/endorsed Inner West LEP map amendment layers via ArcGIS Experience → Adopted_Planning_Layers FeatureServer. NOT CURRENT LAW until gazetted.",
    };

    const normalised: NormalisedSourcePayload = {
      kind: "council_strategic_plan",
      checkedAt: new Date().toISOString(),
      planningChangeAreas: [
        {
          id: "council:inner-west-our-fairer-future",
          title: "Inner West — Our Fairer Future / Endorsed Planning Controls",
          status: "PROPOSED",
          authority: "Inner West Council",
          lgas: ["INNER WEST"],
          suburbs: ["Marrickville", "Dulwich Hill", "Petersham", "Lewisham", "Ashfield", "Summer Hill"],
          sourceUrl: IW_EXPERIENCE_URL,
          bbox: IW_BBOX,
          proposedControls,
          keySites,
        },
      ],
      meta: {
        experienceItemId: resolved.experienceItemId,
        webMapItemIds: resolved.webMapItemIds,
        discoveryFingerprint: resolved.discoveryFingerprint,
        developerLayers: relevant.map((l) => ({ title: l.title, url: l.url, role: l.role })),
        featureServer: IW_ADOPTED_FS,
        geometrySource: "OFFICIAL_FEATURE_SERVICE",
        legalStatus: "PROPOSED",
      },
    };

    return {
      raw: {
        experience: {
          itemId: resolved.experienceItemId,
          title: resolved.title,
          modified: resolved.modified,
          webMapItemIds: resolved.webMapItemIds,
          serviceCount: resolved.services.length,
          fingerprint: resolved.discoveryFingerprint,
        },
      },
      normalised,
      sourceModifiedAt: resolved.modified ? new Date(resolved.modified).toISOString() : null,
    };
  }
}

export const innerWestLiveAdapter = new InnerWestLiveAdapter();
