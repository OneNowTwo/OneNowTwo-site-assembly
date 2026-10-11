/**
 * Official NSW Spatial Services train / metro / light-rail stations
 * (NSW_FOI_Transport_Facilities — Train Station layer).
 * Used for Find station-distance filters (straight-line metres).
 */

import { buildUrl, fetchJson } from "./http";
import type { EsriQueryResponse } from "./esri";
import type { BBox } from "@/lib/types";

const TRAIN_STATION_LAYER =
  process.env.NSW_TRAIN_STATIONS_URL ??
  "https://portal.spatial.nsw.gov.au/server/rest/services/NSW_FOI_Transport_Facilities/FeatureServer/1";

export interface TrainStation {
  id: string;
  label: string;
  lng: number;
  lat: number;
}

interface StationAttrs {
  objectid?: number;
  generalname?: string;
  alternativelabel?: string;
}

function haversineM(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Fetch train/metro/SLR stations intersecting a bbox (WGS84). */
export async function fetchTrainStations(bbox: BBox): Promise<TrainStation[]> {
  const envelope = `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`;
  const url = buildUrl(`${TRAIN_STATION_LAYER}/query`, {
    where: "1=1",
    geometry: envelope,
    geometryType: "esriGeometryEnvelope",
    inSR: 4326,
    spatialRel: "esriSpatialRelIntersects",
    outFields: "objectid,generalname,alternativelabel",
    returnGeometry: true,
    outSR: 4326,
    resultRecordCount: 200,
    f: "json",
  });
  try {
    const res = await fetchJson<
      EsriQueryResponse<StationAttrs> & {
        features?: Array<{ attributes?: StationAttrs; geometry?: { x?: number; y?: number } }>;
      }
    >(url, {
      service: "NSW Train Stations",
      timeoutMs: 20000,
      ttlMs: 60 * 60 * 1000,
    });
    const out: TrainStation[] = [];
    for (const f of res.features ?? []) {
      const lng = f.geometry?.x;
      const lat = f.geometry?.y;
      if (lng == null || lat == null) continue;
      const label = (f.attributes?.generalname ?? f.attributes?.alternativelabel ?? "Station")
        .replace(/\s+RAILWAY STATION$/i, "")
        .replace(/\s+SLR STOP$/i, " (metro/light rail)")
        .replace(/\s+STATION$/i, "");
      out.push({
        id: String(f.attributes?.objectid ?? `${lng},${lat}`),
        label: label
          .toLowerCase()
          .replace(/\b\w/g, (c) => c.toUpperCase()),
        lng,
        lat,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export function nearestTrainStation(
  point: { lng: number; lat: number },
  stations: TrainStation[],
): { station: TrainStation; distanceM: number } | null {
  if (!stations.length) return null;
  let best: { station: TrainStation; distanceM: number } | null = null;
  for (const s of stations) {
    const distanceM = Math.round(haversineM(point.lng, point.lat, s.lng, s.lat));
    if (!best || distanceM < best.distanceM) best = { station: s, distanceM };
  }
  return best;
}
