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

  return (res.features ?? []).map((f, i) => {
    const id = String(f.attributes.KEYSITE_ID ?? f.attributes.OBJECTID ?? `IW-KYS-${i}`);
    const geom = f.geometry ? esriToGeoJSON(f.geometry) : null;
    let bbox: KeySiteFact["bbox"] = null;
    if (geom?.type === "Polygon") {
      const ring = geom.coordinates[0] ?? [];
      const xs = ring.map((c) => c[0]!);
      const ys = ring.map((c) => c[1]!);
      if (xs.length && ys.length) {
        bbox = {
          west: Math.min(...xs),
          south: Math.min(...ys),
          east: Math.max(...xs),
          north: Math.max(...ys),
        };
      }
    }
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
