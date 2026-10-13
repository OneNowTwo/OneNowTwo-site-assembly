/**
 * Generic MapTarget resolver — every app surface should deep-link via these URLs.
 *
 * Supported search params:
 *   lat, lng, zoom
 *   parcelId
 *   opportunityId
 *   planningChangeAreaId | pca
 *   keySiteId | keySite
 *   activityId
 *   bbox (west,south,east,north)
 *   scan (legacy area-scan bootstrap)
 */

export type MapTargetKind =
  | "POINT"
  | "PARCEL"
  | "OPPORTUNITY"
  | "PLANNING_AREA"
  | "KEY_SITE"
  | "DEVELOPMENT_ACTIVITY"
  | "BBOX"
  | "SCAN";

export type MapTarget = {
  kind: MapTargetKind;
  lat?: number;
  lng?: number;
  zoom?: number;
  parcelId?: string;
  opportunityId?: string;
  planningChangeAreaId?: string;
  keySiteId?: string;
  activityId?: string;
  bbox?: { west: number; south: number; east: number; north: number };
  scan?: string;
  /** Stable string for effect deps */
  key: string;
};

/**
 * Today / Find / Sites deep-links keep MapWorkspace mounted. A new entity or
 * point target must drop the previous area-scan overlay so Harry does not see
 * stale ranked assemblies on the wrong place.
 * SCAN targets intentionally keep / bootstrap scan state.
 */
export function shouldClearScanForMapTarget(kind: MapTargetKind | null | undefined): boolean {
  if (!kind) return false;
  return kind !== "SCAN";
}

export type MapSelectionState = {
  assembly: string[];
  selectedId: string | null;
};

/**
 * Every non-SCAN MapTarget starts from a clean selection (scan/find/assembly/
 * selected parcel cleared in the workspace). Target handlers may then set a
 * new assembly/selection only after they successfully resolve parcel IDs.
 * If resolution fails or returns none, prior assembly must not remain.
 */
export function resetSelectionForMapTarget(
  kind: MapTargetKind | null | undefined,
  prev: MapSelectionState,
  resolved?: { assemblyIds?: string[] | null; selectedId?: string | null },
): MapSelectionState {
  if (!shouldClearScanForMapTarget(kind)) return prev;
  const ids = (resolved?.assemblyIds ?? []).filter(Boolean);
  if (ids.length) {
    return {
      assembly: ids,
      selectedId: resolved?.selectedId ?? ids[0] ?? null,
    };
  }
  if (resolved?.selectedId) {
    return { assembly: [], selectedId: resolved.selectedId };
  }
  return { assembly: [], selectedId: null };
}

function num(v: string | null): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function parseBBox(raw: string | null): MapTarget["bbox"] | undefined {
  if (!raw) return undefined;
  const parts = raw.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return undefined;
  const [west, south, east, north] = parts as [number, number, number, number];
  return { west, south, east, north };
}

type ParamSource = {
  get(name: string): string | null;
};

/** Resolve MapTarget from URLSearchParams or any get()-compatible source. */
export function resolveMapTarget(searchParams: ParamSource): MapTarget | null {
  const parcelId = searchParams.get("parcelId") ?? undefined;
  const opportunityId = searchParams.get("opportunityId") ?? undefined;
  const planningChangeAreaId =
    searchParams.get("planningChangeAreaId") ?? searchParams.get("pca") ?? undefined;
  const keySiteId = searchParams.get("keySiteId") ?? searchParams.get("keySite") ?? undefined;
  const activityId = searchParams.get("activityId") ?? undefined;
  const bbox = parseBBox(searchParams.get("bbox"));
  const lat = num(searchParams.get("lat"));
  const lng = num(searchParams.get("lng"));
  const zoom = num(searchParams.get("zoom"));
  const scan = searchParams.get("scan") ?? undefined;

  if (keySiteId) {
    return {
      kind: "KEY_SITE",
      planningChangeAreaId,
      keySiteId,
      lat,
      lng,
      zoom,
      bbox,
      key: `keysite:${planningChangeAreaId ?? ""}:${keySiteId}`,
    };
  }

  if (planningChangeAreaId) {
    return {
      kind: "PLANNING_AREA",
      planningChangeAreaId,
      lat,
      lng,
      zoom,
      bbox,
      key: `pca:${planningChangeAreaId}`,
    };
  }

  if (opportunityId) {
    return {
      kind: "OPPORTUNITY",
      opportunityId,
      lat,
      lng,
      zoom,
      key: `opp:${opportunityId}`,
    };
  }

  if (parcelId) {
    return {
      kind: "PARCEL",
      parcelId,
      lat,
      lng,
      zoom: zoom ?? 18,
      key: `parcel:${parcelId}`,
    };
  }

  if (activityId) {
    return {
      kind: "DEVELOPMENT_ACTIVITY",
      activityId,
      lat,
      lng,
      zoom: zoom ?? 16,
      key: `activity:${activityId}`,
    };
  }

  if (bbox) {
    return {
      kind: "BBOX",
      bbox,
      zoom,
      key: `bbox:${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
    };
  }

  if (lat != null && lng != null) {
    return {
      kind: "POINT",
      lat,
      lng,
      zoom: zoom ?? 16,
      key: `point:${lat},${lng},${zoom ?? ""}`,
    };
  }

  if (scan && scan.trim().length >= 2) {
    return {
      kind: "SCAN",
      scan: scan.trim(),
      key: `scan:${scan.trim().toLowerCase()}`,
    };
  }

  return null;
}

/** Build a canonical /map?... href from a partial target. */
export function buildMapHref(partial: {
  lat?: number | null;
  lng?: number | null;
  zoom?: number | null;
  parcelId?: string | null;
  opportunityId?: string | null;
  planningChangeAreaId?: string | null;
  keySiteId?: string | null;
  activityId?: string | null;
  bbox?: { west: number; south: number; east: number; north: number } | null;
  scan?: string | null;
}): string {
  const params = new URLSearchParams();
  if (partial.lat != null && partial.lng != null) {
    params.set("lat", Number(partial.lat).toFixed(5));
    params.set("lng", Number(partial.lng).toFixed(5));
  }
  if (partial.zoom != null) params.set("zoom", String(Math.round(Number(partial.zoom) * 10) / 10));
  if (partial.parcelId) params.set("parcelId", partial.parcelId);
  if (partial.opportunityId) params.set("opportunityId", partial.opportunityId);
  if (partial.planningChangeAreaId) params.set("pca", partial.planningChangeAreaId);
  if (partial.keySiteId) params.set("keySite", partial.keySiteId);
  if (partial.activityId) params.set("activityId", partial.activityId);
  if (partial.bbox) {
    const b = partial.bbox;
    params.set("bbox", `${b.west},${b.south},${b.east},${b.north}`);
  }
  if (partial.scan) params.set("scan", partial.scan);
  const q = params.toString();
  return q ? `/map?${q}` : "/map";
}

/** Sydney metro default view — not Manly Vale. */
export const SYDNEY_METRO_START = {
  lat: -33.8688,
  lng: 151.2093,
  zoom: 11,
} as const;

export function bboxFromGeometry(geometry: unknown): MapTarget["bbox"] | null {
  if (!geometry || typeof geometry !== "object") return null;
  const g = geometry as { type?: string; coordinates?: unknown; west?: number; south?: number; east?: number; north?: number };
  if (
    typeof g.west === "number" &&
    typeof g.south === "number" &&
    typeof g.east === "number" &&
    typeof g.north === "number"
  ) {
    return { west: g.west, south: g.south, east: g.east, north: g.north };
  }
  try {
    const coords: number[][] = [];
    const walk = (node: unknown): void => {
      if (!Array.isArray(node)) return;
      if (typeof node[0] === "number" && typeof node[1] === "number") {
        coords.push([node[0] as number, node[1] as number]);
        return;
      }
      for (const c of node) walk(c);
    };
    walk(g.coordinates);
    if (!coords.length) return null;
    let west = Infinity,
      south = Infinity,
      east = -Infinity,
      north = -Infinity;
    for (const [lng, lat] of coords) {
      west = Math.min(west, lng);
      east = Math.max(east, lng);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
    return { west, south, east, north };
  } catch {
    return null;
  }
}
