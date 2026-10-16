/**
 * Generic DevelopmentActivity model — DA / HDA / SSD / CDC / PCC / OTHER
 * display through the same UI. Never invent height/dwellings when unpublished.
 */

export type DevelopmentActivityType = "DA" | "HDA" | "SSD" | "CDC" | "PCC" | "OTHER";

export type DevelopmentActivityStatus =
  | "LODGED"
  | "APPROVED"
  | "REFUSED"
  | "WITHDRAWN"
  | "EXHIBITION"
  | "ASSESSMENT"
  | "DETERMINED"
  | "RECOMMENDED"
  | "NOT_RECOMMENDED"
  | "DEFERRED"
  | "OTHER";

export interface DevelopmentActivity {
  id: string;
  sourceId: string;
  externalId: string;
  type: DevelopmentActivityType;
  status: DevelopmentActivityStatus;
  address: string | null;
  suburb?: string | null;
  lga?: string | null;
  geometry: GeoJSON.Point | GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  developmentType: string | null;
  description: string | null;
  dwellings: number | null;
  storeys: number | null;
  estimatedCost: number | null;
  lodgedAt: string | null;
  determinedAt: string | null;
  sourceUrl: string | null;
  checkedAt: string;
  recommendation?: string | null;
  distanceM?: number | null;
}

export function classifyDaStatus(raw: string | null | undefined): DevelopmentActivityStatus {
  if (!raw) return "OTHER";
  const s = raw.toLowerCase();
  if (/withdrawn|lapsed|cancelled/.test(s)) return "WITHDRAWN";
  if (/refus|reject|not.?approv/.test(s)) return "REFUSED";
  if (/approv|consent|determined.?approv|deferred commencement/.test(s)) return "APPROVED";
  if (/exhibit/.test(s)) return "EXHIBITION";
  if (/assess|under.?consider|referral/.test(s)) return "ASSESSMENT";
  if (/lodg|submitted|received|under.?assessment/.test(s)) return "LODGED";
  if (/determin/.test(s)) return "DETERMINED";
  return "OTHER";
}

export function haversineM(a: { lng: number; lat: number }, b: { lng: number; lat: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function activityCentroid(activity: DevelopmentActivity): { lng: number; lat: number } | null {
  const g = activity.geometry;
  if (!g) return null;
  if (g.type === "Point") {
    const lng = g.coordinates[0];
    const lat = g.coordinates[1];
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    return { lng, lat };
  }
  const ring =
    g.type === "Polygon"
      ? g.coordinates[0]
      : g.type === "MultiPolygon"
        ? g.coordinates[0]?.[0]
        : null;
  if (!ring?.length) return null;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const c of ring) {
    if (c[0] == null || c[1] == null || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
    sx += c[0];
    sy += c[1];
    n += 1;
  }
  if (!n) return null;
  return { lng: sx / n, lat: sy / n };
}

/** Leaflet-friendly [lat, lng] for Point / Polygon / MultiPolygon; null when unplottable. */
export function activityPlotLatLng(activity: DevelopmentActivity): [number, number] | null {
  const c = activityCentroid(activity);
  if (!c) return null;
  return [c.lat, c.lng];
}

export function activityHasPlottableGeometry(activity: DevelopmentActivity): boolean {
  return activityCentroid(activity) != null;
}

export function filterActivitiesNear(
  activities: DevelopmentActivity[],
  point: { lng: number; lat: number },
  radiusM = 500,
): DevelopmentActivity[] {
  const out: DevelopmentActivity[] = [];
  for (const a of activities) {
    const c = activityCentroid(a);
    if (!c) continue;
    const d = haversineM(point, c);
    if (d <= radiusM) out.push({ ...a, distanceM: Math.round(d) });
  }
  return out.sort((x, y) => (x.distanceM ?? 0) - (y.distanceM ?? 0));
}

export function developmentActivityFromRecord(
  record: Record<string, unknown>,
  defaults: { sourceId: string; checkedAt: string; type?: DevelopmentActivityType },
): DevelopmentActivity | null {
  const externalId = String(record.externalId ?? record.id ?? "").trim();
  if (!externalId) return null;
  const type = (record.type as DevelopmentActivityType | undefined) ?? defaults.type ?? "OTHER";
  const status = (record.status as DevelopmentActivityStatus | undefined) ?? "OTHER";
  let geometry: DevelopmentActivity["geometry"] = null;
  if (record.geometry && typeof record.geometry === "object") {
    geometry = record.geometry as DevelopmentActivity["geometry"];
  } else if (typeof record.lng === "number" && typeof record.lat === "number") {
    geometry = { type: "Point", coordinates: [record.lng, record.lat] };
  }
  return {
    id: `${defaults.sourceId}:${externalId}`,
    sourceId: defaults.sourceId,
    externalId,
    type,
    status,
    address: (record.address as string | null | undefined) ?? null,
    suburb: (record.suburb as string | null | undefined) ?? null,
    lga: (record.lga as string | null | undefined) ?? null,
    geometry,
    developmentType: (record.developmentType as string | null | undefined) ?? null,
    description: (record.description as string | null | undefined) ?? null,
    dwellings: typeof record.dwellings === "number" ? record.dwellings : null,
    storeys: typeof record.storeys === "number" ? record.storeys : null,
    estimatedCost: typeof record.estimatedCost === "number" ? record.estimatedCost : null,
    lodgedAt: (record.lodgedAt as string | null | undefined) ?? null,
    determinedAt: (record.determinedAt as string | null | undefined) ?? null,
    sourceUrl: (record.sourceUrl as string | null | undefined) ?? null,
    checkedAt: defaults.checkedAt,
    recommendation: (record.recommendation as string | null | undefined) ?? null,
  };
}
