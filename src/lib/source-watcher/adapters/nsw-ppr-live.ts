/**
 * LIVE statewide NSW Planning Proposal Register adapter.
 * Paginates official Planning Proposal Agency ArcGIS layers (no sample envelopes).
 * Retains proposal geometry where the service provides it.
 * Proposed ≠ current law.
 */

import { buildUrl, fetchJson } from "@/lib/data-sources/http";
import { esriToGeoJSON, type EsriQueryResponse } from "@/lib/data-sources/esri";
import { NSW_PLANNING_PROPOSAL_BASE } from "@/lib/data-sources/nsw-planning-proposals";
import type { BBox, FetchResult, NormalisedSourcePayload, PlanningChangeAreaFact, SourceAdapter } from "../types";

const SOURCE_ID = "nsw-planning-proposal-register";
const PORTAL_URL = "https://www.planningportal.nsw.gov.au/";
const LAYERS = { fsr: 3013, height: 3020, zone: 3029 } as const;
const PAGE_SIZE = 1000;
/** Hard safety cap — Agency FSR layer is ~6–7k open features statewide. */
const MAX_OFFSET = 50_000;

type Attrs = Record<string, string | number | null | undefined>;

interface EsriGeom {
  rings?: number[][][];
  x?: number;
  y?: number;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function mapStage(statusId: number | null, versionStatus: string | null): string {
  if (versionStatus && /withdrawn/i.test(versionStatus)) return "WITHDRAWN";
  if (versionStatus && /finalis|made|gazett/i.test(versionStatus)) return "FINALISATION";
  if (statusId === 207) return "WITHDRAWN";
  if (versionStatus && /exhibit/i.test(versionStatus)) return "UNDER_EXHIBITION";
  if (versionStatus && /gateway|pre.?exhibit/i.test(versionStatus)) return "PRE-EXHIBITION";
  if (versionStatus && /post.?exhibit/i.test(versionStatus)) return "POST-EXHIBITION";
  if (versionStatus && /assess/i.test(versionStatus)) return "UNDER_ASSESSMENT";
  return "UNDER_ASSESSMENT";
}

function bboxFromGeom(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon | null): BBox | null {
  if (!geom) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  const rings =
    geom.type === "Polygon"
      ? geom.coordinates
      : geom.coordinates.flatMap((poly) => poly);
  for (const ring of rings) {
    for (const pt of ring) {
      const lng = pt[0]!;
      const lat = pt[1]!;
      if (lng < west) west = lng;
      if (lng > east) east = lng;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  }
  if (!Number.isFinite(west)) return null;
  return { west, south, east, north };
}

function mergeBBox(a: BBox | null, b: BBox | null): BBox | null {
  if (!a) return b;
  if (!b) return a;
  return {
    west: Math.min(a.west, b.west),
    south: Math.min(a.south, b.south),
    east: Math.max(a.east, b.east),
    north: Math.max(a.north, b.north),
  };
}

function preferGeometry(
  current: GeoJSON.Polygon | GeoJSON.MultiPolygon | null,
  next: GeoJSON.Polygon | GeoJSON.MultiPolygon | null,
): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  if (!current) return next;
  if (!next) return current;
  // Keep MultiPolygon if either side already is; otherwise first wins.
  if (current.type === "MultiPolygon") return current;
  if (next.type === "MultiPolygon") return next;
  return current;
}

async function queryLayerPaged(input: {
  layerId: number;
  outFields: string;
  returnGeometry: boolean;
}): Promise<{ attrs: Attrs; geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | null }[]> {
  const out: { attrs: Attrs; geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | null }[] = [];
  let offset = 0;
  while (offset <= MAX_OFFSET) {
    const url = buildUrl(`${NSW_PLANNING_PROPOSAL_BASE}/${input.layerId}/query`, {
      where: "PP_CLOSED=0 AND PLANNING_PROPOSAL_NO IS NOT NULL",
      outFields: input.outFields,
      returnGeometry: input.returnGeometry,
      outSR: 4326,
      resultOffset: offset,
      resultRecordCount: PAGE_SIZE,
      orderByFields: "PLANNING_PROPOSAL_NO ASC",
      f: "json",
    });
    try {
      const res = await fetchJson<EsriQueryResponse<Attrs> & { features?: Array<{ attributes?: Attrs; geometry?: EsriGeom }> }>(
        url,
        {
          service: "NSW Planning Proposal Register live",
          timeoutMs: 45000,
          ttlMs: 10 * 60 * 1000,
        },
      );
      const features = res.features ?? [];
      for (const f of features) {
        const attrs = f.attributes ?? {};
        let geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | null = null;
        if (input.returnGeometry && f.geometry?.rings) {
          geometry = esriToGeoJSON(f.geometry as { rings: number[][][] });
        }
        out.push({ attrs, geometry });
      }
      if (!features.length) break;
      if (res.exceededTransferLimit === false) break;
      if (features.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    } catch {
      break;
    }
  }
  return out;
}

interface Agg {
  ppNo: string;
  statusId: number | null;
  versionStatus: string | null;
  lga: string | null;
  epiName: string | null;
  amendment: string | null;
  fsrs: number[];
  heights: number[];
  zones: string[];
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  bbox: BBox | null;
}

function upsert(
  map: Map<string, Agg>,
  attrs: Attrs,
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | null,
): void {
  const ppNo = str(attrs.PLANNING_PROPOSAL_NO);
  if (!ppNo || /test/i.test(ppNo)) return;
  let row = map.get(ppNo);
  if (!row) {
    row = {
      ppNo,
      statusId: num(attrs.PLANNING_PROPOSAL_STATUS_ID),
      versionStatus: str(attrs.PP_DATA_VERSION_STATUS),
      lga: str(attrs.LGA_NAME),
      epiName: str(attrs.EPI_NAME),
      amendment: str(attrs.AMENDMENT),
      fsrs: [],
      heights: [],
      zones: [],
      geometry: null,
      bbox: null,
    };
    map.set(ppNo, row);
  }
  const f = num(attrs.FSR);
  if (f != null) row.fsrs.push(f);
  const h = num(attrs.MAX_B_H_M) ?? num(attrs.MAX_B_H);
  if (h != null) row.heights.push(h);
  const z = str(attrs.SYM_CODE) ?? str(attrs.LAY_CLASS);
  if (z) row.zones.push(z);
  if (geometry) {
    row.geometry = preferGeometry(row.geometry, geometry);
    row.bbox = mergeBBox(row.bbox, bboxFromGeom(geometry));
  }
}

function toArea(agg: Agg): PlanningChangeAreaFact {
  const fsrs = [...new Set(agg.fsrs)].sort((a, b) => a - b);
  const heights = [...new Set(agg.heights)].sort((a, b) => a - b);
  const zones = [...new Set(agg.zones)];
  const stage = mapStage(agg.statusId, agg.versionStatus);
  const lga = agg.lga && agg.lga !== "LEP" ? agg.lga : null;
  return {
    id: `nsw-ppr:${agg.ppNo}`,
    title: `${agg.ppNo}${lga ? ` — ${lga}` : ""}${agg.amendment ? ` (${agg.amendment})` : ""}`,
    status: stage,
    authority: lga ? `${lga} / NSW DPHI` : "NSW DPHI",
    lgas: lga ? [lga] : [],
    suburbs: [],
    sourceUrl: PORTAL_URL,
    bbox: agg.bbox,
    geometry: agg.geometry,
    proposedControls: {
      legalStatus: stage === "UNDER_EXHIBITION" ? "UNDER_EXHIBITION" : "PROPOSED",
      zone: zones.length === 1 ? zones[0]! : null,
      fsr: fsrs.length === 1 ? fsrs[0]! : null,
      heightM: heights.length === 1 ? heights[0]! : null,
      notes:
        (agg.geometry
          ? "OFFICIAL_FEATURE_SERVICE geometry retained. "
          : "No geometry on open features for this proposal. ") +
        "Statewide Planning Proposal Agency layers (paginated) — PROPOSED / pending only, not current LEP law. Confirm against Planning Portal documents.",
      machineReadable: fsrs.length === 1 || heights.length === 1 || zones.length === 1,
    },
  };
}

export const planningProposalRegisterLiveAdapter: SourceAdapter = {
  id: SOURCE_ID,
  async fetch(): Promise<FetchResult> {
    const checkedAt = new Date().toISOString();
    const byPp = new Map<string, Agg>();

    const common =
      "PLANNING_PROPOSAL_NO,PLANNING_PROPOSAL_STATUS_ID,PP_DATA_VERSION_STATUS,EPI_NAME,LGA_NAME,AMENDMENT";
    const [fsrRows, heightRows, zoneRows] = await Promise.all([
      queryLayerPaged({
        layerId: LAYERS.fsr,
        outFields: `${common},FSR`,
        returnGeometry: true,
      }),
      queryLayerPaged({
        layerId: LAYERS.height,
        outFields: `${common},MAX_B_H,MAX_B_H_M`,
        returnGeometry: true,
      }),
      queryLayerPaged({
        layerId: LAYERS.zone,
        outFields: `${common},SYM_CODE,LAY_CLASS`,
        returnGeometry: true,
      }),
    ]);

    const layerHits = fsrRows.length + heightRows.length + zoneRows.length;
    for (const row of [...fsrRows, ...heightRows, ...zoneRows]) {
      upsert(byPp, row.attrs, row.geometry);
    }

    const planningChangeAreas = [...byPp.values()].map(toArea).sort((a, b) => a.title.localeCompare(b.title));
    const withGeom = planningChangeAreas.filter((a) => !!a.geometry).length;
    const records = planningChangeAreas.map((a) => ({
      proposalNumber: a.id.replace(/^nsw-ppr:/, ""),
      name: a.title,
      lga: a.lgas?.[0] ?? null,
      status: a.status,
      gateway: null,
      exhibition: a.status === "UNDER_EXHIBITION" ? a.status : null,
      finalisation: a.status === "FINALISATION" ? a.status : null,
      sourceUrl: a.sourceUrl,
      proposedZone: a.proposedControls.zone ?? null,
      proposedFsr: a.proposedControls.fsr ?? null,
      proposedHeight: a.proposedControls.heightM ?? null,
      hasGeometry: !!a.geometry,
    }));

    const normalised: NormalisedSourcePayload = {
      kind: "planning_proposal_register",
      checkedAt,
      planningChangeAreas,
      records,
      meta: {
        status: planningChangeAreas.length ? "LIVE" : layerHits === 0 ? "EMPTY" : "LIVE",
        transport: "ARCGIS_PAGED",
        service: NSW_PLANNING_PROPOSAL_BASE,
        proposalCount: planningChangeAreas.length,
        layerAttributeHits: layerHits,
        proposalsWithGeometry: withGeom,
        pageSize: PAGE_SIZE,
        note: "Statewide Agency PP layers via resultOffset pagination — geometry retained for PCA spatial intersection.",
      },
    };

    return {
      raw: { proposalCount: planningChangeAreas.length, layerHits, proposalsWithGeometry: withGeom },
      normalised,
    };
  },
};
