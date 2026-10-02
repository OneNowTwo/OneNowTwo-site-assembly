import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import type { Feature, Polygon, MultiPolygon, Point } from "geojson";
import type { BBox, FieldSource, PlanningControls } from "@/lib/types";
import { buildUrl, fetchJson, UpstreamError } from "./http";
import { esriToGeoJSON, type EsriQueryResponse } from "./esri";
import type { PlanningDataProvider } from "./providers";

/** NSW Planning Portal — EPI Primary Planning Layers (ArcGIS MapServer, DPHI). */
export const NSW_PLANNING_BASE =
  process.env.NSW_PLANNING_URL ??
  "https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/EPI_Primary_Planning_Layers/MapServer";
export const NSW_PLANNING_WMS =
  process.env.NSW_PLANNING_WMS_URL ??
  "https://mapprod3.environment.nsw.gov.au/arcgis/services/Planning/EPI_Primary_Planning_Layers/MapServer/WMSServer";
export const PLANNING_SOURCE_LABEL = "NSW Planning Portal — EPI Primary Planning Layers";

const LAYERS = {
  heritage: { id: 0, fields: "EPI_NAME,LGA_NAME,LAY_CLASS,H_NAME,SIG", label: "Heritage" },
  fsr: { id: 1, fields: "EPI_NAME,LGA_NAME,FSR,LAY_CLASS", label: "Floor Space Ratio" },
  zoning: { id: 2, fields: "EPI_NAME,LGA_NAME,SYM_CODE,LAY_CLASS", label: "Land Zoning" },
  lotSize: { id: 4, fields: "EPI_NAME,LGA_NAME,LOT_SIZE,UNITS", label: "Lot Size" },
  height: { id: 5, fields: "EPI_NAME,LGA_NAME,MAX_B_H,UNITS", label: "Height of Buildings" },
} as const;
type LayerKey = keyof typeof LAYERS;

type Attrs = Record<string, string | number | null>;
interface PlanningPolygon {
  attrs: Attrs;
  feature: Feature<Polygon | MultiPolygon>;
}

async function fetchLayer(key: LayerKey, bbox: BBox): Promise<PlanningPolygon[]> {
  const layer = LAYERS[key];
  const url = buildUrl(`${NSW_PLANNING_BASE}/${layer.id}/query`, {
    where: "1=1",
    geometry: `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
    geometryType: "esriGeometryEnvelope",
    inSR: 4326,
    spatialRel: "esriSpatialRelIntersects",
    outFields: layer.fields,
    returnGeometry: true,
    outSR: 4326,
    maxAllowableOffset: 0.000003,
    geometryPrecision: 7,
    f: "json",
  });
  const res = await fetchJson<EsriQueryResponse<Attrs>>(url, { service: `NSW Planning (${layer.label})`, timeoutMs: 20000 });
  const out: PlanningPolygon[] = [];
  for (const f of res.features ?? []) {
    if (!f.geometry) continue;
    const g = esriToGeoJSON(f.geometry);
    if (g) out.push({ attrs: f.attributes, feature: { type: "Feature", properties: {}, geometry: g } });
  }
  return out;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/** Expand a bbox slightly so polygons containing edge parcels are returned. */
function pad(b: BBox, d = 0.0005): BBox {
  return { west: b.west - d, south: b.south - d, east: b.east + d, north: b.north + d };
}

export class NswPlanningProvider implements PlanningDataProvider {
  readonly name = PLANNING_SOURCE_LABEL;

  async getControlsForPoints(bbox: BBox, points: { id: string; point: Point }[]) {
    const keys = Object.keys(LAYERS) as LayerKey[];
    const settled = await Promise.allSettled(keys.map((k) => fetchLayer(k, pad(bbox))));
    const layers = {} as Record<LayerKey, PlanningPolygon[] | null>;
    keys.forEach((k, i) => {
      const r = settled[i];
      layers[k] = r.status === "fulfilled" ? r.value : null;
    });
    if (keys.every((k) => layers[k] === null)) {
      const first = settled.find((s) => s.status === "rejected") as PromiseRejectedResult | undefined;
      throw first?.reason instanceof UpstreamError ? first.reason : new UpstreamError("Planning service unavailable", "NSW Planning");
    }

    const retrievedAt = new Date().toISOString();
    const src = (k: LayerKey): FieldSource => ({
      kind: "OFFICIAL",
      source: `${PLANNING_SOURCE_LABEL} — ${LAYERS[k].label}`,
      retrievedAt,
    });
    const hit = (k: LayerKey, pt: Feature<Point>) => layers[k]?.find((p) => booleanPointInPolygon(pt, p.feature)) ?? null;

    const result = new Map<string, PlanningControls>();
    for (const { id, point } of points) {
      const pt: Feature<Point> = { type: "Feature", properties: {}, geometry: point };
      const zoning = hit("zoning", pt);
      const fsr = hit("fsr", pt);
      const height = hit("height", pt);
      const lotSize = hit("lotSize", pt);
      const heritage = hit("heritage", pt);
      const sources: PlanningControls["sources"] = {};
      if (layers.zoning) sources.zone = src("zoning");
      if (layers.fsr) sources.fsr = src("fsr");
      if (layers.height) sources.heightM = src("height");
      if (layers.lotSize) sources.minLotSizeSqm = src("lotSize");
      if (layers.heritage) sources.heritage = src("heritage");
      const anyAttrs = zoning?.attrs ?? fsr?.attrs ?? height?.attrs;
      const heritageLabel = heritage
        ? [heritage.attrs.LAY_CLASS, heritage.attrs.H_NAME, heritage.attrs.SIG].filter(Boolean).join(" — ")
        : layers.heritage
          ? "None mapped"
          : null;
      const lotUnits = String(lotSize?.attrs.UNITS ?? "m2").toLowerCase();
      const lotVal = num(lotSize?.attrs.LOT_SIZE);
      result.set(id, {
        zone: (zoning?.attrs.SYM_CODE as string) ?? null,
        zoneName: (zoning?.attrs.LAY_CLASS as string) ?? null,
        fsr: num(fsr?.attrs.FSR),
        heightM: num(height?.attrs.MAX_B_H),
        minLotSizeSqm: lotVal == null ? null : lotUnits.startsWith("ha") ? lotVal * 10000 : lotVal,
        heritage: heritageLabel,
        planningInstrument: (anyAttrs?.EPI_NAME as string) ?? null,
        lga: (anyAttrs?.LGA_NAME as string) ?? null,
        sources,
      });
    }
    return result;
  }
}

export const nswPlanningProvider = new NswPlanningProvider();
