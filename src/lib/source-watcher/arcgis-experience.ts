/**
 * Generic ArcGIS Experience Builder → WebMap/WebScene → FeatureServer/MapServer resolver.
 * Do not scrape rendered map canvases — always resolve official item/config/service URLs.
 */

import { buildUrl, fetchJson } from "@/lib/data-sources/http";

export type ArcgisPortalHost = string;

export interface ResolvedLayer {
  title: string;
  url: string | null;
  itemId: string | null;
  layerType: string | null;
  parentTitle?: string | null;
  /** Draft / proposed / current heuristic from layer title. */
  role: "DRAFT" | "CURRENT" | "OTHER";
}

export interface ResolvedService {
  url: string;
  layerId?: number | null;
  title?: string | null;
  fields?: string[];
  editingInfo?: { lastEditDate?: number | null } | null;
  geometryType?: string | null;
}

export interface ResolvedExperience {
  experienceItemId: string;
  portalHost: ArcgisPortalHost;
  title: string;
  type: string;
  modified: number | null;
  webMapItemIds: string[];
  layers: ResolvedLayer[];
  services: ResolvedService[];
  /** Stable hash input for cache / change detection. */
  discoveryFingerprint: string;
  resolvedAt: string;
}

const DEFAULT_ARCGIS = "https://www.arcgis.com";

/** In-process cache so scheduled runs do not rediscover services every poll. */
const resolveCache = new Map<string, { expires: number; value: ResolvedExperience }>();
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

const ITEM_ID_RE = /[0-9a-f]{32}/gi;

export function extractExperienceItemId(input: string): string | null {
  const fromQuery = input.match(/[?&]id=([0-9a-f]{32})/i);
  if (fromQuery) return fromQuery[1]!.toLowerCase();
  const fromPath = input.match(/experience\/([0-9a-f]{32})/i);
  if (fromPath) return fromPath[1]!.toLowerCase();
  if (/^[0-9a-f]{32}$/i.test(input.trim())) return input.trim().toLowerCase();
  return null;
}

export function portalHostFromUrl(input: string): ArcgisPortalHost {
  try {
    const u = new URL(input.includes("://") ? input : `https://${input}`);
    if (u.hostname.includes("spatialportal.dpie.nsw.gov.au")) {
      return `${u.origin}/portal`;
    }
    if (u.hostname.includes("arcgis.com")) return DEFAULT_ARCGIS;
    return u.origin;
  } catch {
    return DEFAULT_ARCGIS;
  }
}

function sharingBase(portalHost: ArcgisPortalHost): string {
  if (portalHost.endsWith("/portal")) return `${portalHost}/sharing/rest`;
  return `${portalHost}/sharing/rest`;
}

function layerRole(title: string): ResolvedLayer["role"] {
  const t = title.toLowerCase();
  if (/\bdraft\b|\bendorsed\b|\bproposed\b|\bincentive\b/.test(t)) return "DRAFT";
  if (/\bcurrent\b/.test(t)) return "CURRENT";
  return "OTHER";
}

function collectItemIds(node: unknown, out: Set<string>, depth = 0) {
  if (depth > 12 || node == null) return;
  if (typeof node === "string") {
    if (/^[0-9a-f]{32}$/i.test(node)) out.add(node.toLowerCase());
    return;
  }
  if (Array.isArray(node)) {
    for (const v of node) collectItemIds(v, out, depth + 1);
    return;
  }
  if (typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "itemId" && typeof v === "string" && /^[0-9a-f]{32}$/i.test(v)) {
        out.add(v.toLowerCase());
      }
      collectItemIds(v, out, depth + 1);
    }
  }
}

function walkOperationalLayers(
  layers: unknown[] | undefined,
  out: ResolvedLayer[],
  parentTitle: string | null = null,
) {
  for (const raw of layers ?? []) {
    if (!raw || typeof raw !== "object") continue;
    const op = raw as Record<string, unknown>;
    const title = String(op.title ?? op.id ?? "layer");
    const url = typeof op.url === "string" ? op.url : null;
    const itemId = typeof op.itemId === "string" ? op.itemId.toLowerCase() : null;
    const layerType = typeof op.layerType === "string" ? op.layerType : null;
    if (url || itemId || layerType === "GroupLayer") {
      out.push({
        title,
        url,
        itemId,
        layerType,
        parentTitle,
        role: layerRole(`${parentTitle ?? ""} ${title}`),
      });
    }
    const nested = op.layers;
    if (Array.isArray(nested)) walkOperationalLayers(nested, out, title);
  }
}

function serviceUrlsFromText(text: string): string[] {
  const re = /https?:\/\/[^"\\\s]+?(?:FeatureServer|MapServer)(?:\/\d+)?/gi;
  return [...new Set((text.match(re) ?? []).map((u) => u.replace(/\\/g, "")))];
}

async function fetchItemMeta(portalHost: ArcgisPortalHost, itemId: string) {
  const url = buildUrl(`${sharingBase(portalHost)}/content/items/${itemId}`, { f: "json" });
  return fetchJson<{
    id?: string;
    title?: string;
    type?: string;
    modified?: number;
    url?: string;
    error?: { message?: string };
  }>(url, { service: "arcgis-item", ttlMs: CACHE_TTL_MS, timeoutMs: 20000 });
}

async function fetchItemData(portalHost: ArcgisPortalHost, itemId: string) {
  const url = buildUrl(`${sharingBase(portalHost)}/content/items/${itemId}/data`, { f: "json" });
  return fetchJson<unknown>(url, { service: "arcgis-item-data", ttlMs: CACHE_TTL_MS, timeoutMs: 30000 });
}

async function enrichService(url: string): Promise<ResolvedService> {
  const base = url.replace(/\/\d+$/, "");
  const layerMatch = url.match(/\/(\d+)$/);
  const layerId = layerMatch ? Number(layerMatch[1]) : null;
  try {
    const meta = await fetchJson<{
      fields?: Array<{ name: string }>;
      editingInfo?: { lastEditDate?: number };
      geometryType?: string;
      name?: string;
      layers?: Array<{ id: number; name: string }>;
    }>(buildUrl(layerId != null ? url : base, { f: "json" }), {
      service: "arcgis-service",
      ttlMs: CACHE_TTL_MS,
      timeoutMs: 20000,
    });
    return {
      url,
      layerId,
      title: meta.name ?? null,
      fields: (meta.fields ?? []).map((f) => f.name),
      editingInfo: meta.editingInfo ?? null,
      geometryType: meta.geometryType ?? null,
    };
  } catch {
    return { url, layerId, title: null, fields: [], editingInfo: null, geometryType: null };
  }
}

export async function resolveArcGisExperience(
  experienceUrlOrId: string,
  opts?: { portalHost?: ArcgisPortalHost; forceRefresh?: boolean; enrichServices?: boolean },
): Promise<ResolvedExperience> {
  const itemId = extractExperienceItemId(experienceUrlOrId);
  if (!itemId) throw new Error(`Could not extract Experience item id from: ${experienceUrlOrId}`);
  const portalHost = opts?.portalHost ?? portalHostFromUrl(experienceUrlOrId);
  const cacheKey = `${portalHost}:${itemId}`;
  const hit = resolveCache.get(cacheKey);
  if (!opts?.forceRefresh && hit && hit.expires > Date.now()) return hit.value;

  const meta = await fetchItemMeta(portalHost, itemId);
  if (!meta.type && !meta.title) throw new Error(`Experience item inaccessible: ${itemId}`);
  const data = await fetchItemData(portalHost, itemId);

  const nestedIds = new Set<string>();
  collectItemIds(data, nestedIds);
  nestedIds.delete(itemId);

  const layers: ResolvedLayer[] = [];
  const webMapItemIds: string[] = [];
  const serviceUrlSet = new Set<string>(serviceUrlsFromText(JSON.stringify(data)));

  for (const nid of nestedIds) {
    try {
      const nMeta = await fetchItemMeta(portalHost, nid);
      if (!nMeta.type) continue;
      if (nMeta.type === "Web Map" || nMeta.type === "Web Scene") {
        webMapItemIds.push(nid);
        const nData = await fetchItemData(portalHost, nid);
        const ops =
          nData && typeof nData === "object"
            ? ((nData as { operationalLayers?: unknown[] }).operationalLayers ?? [])
            : [];
        walkOperationalLayers(ops, layers);
        for (const u of serviceUrlsFromText(JSON.stringify(nData))) serviceUrlSet.add(u);
      } else if (nMeta.url && /FeatureServer|MapServer/i.test(nMeta.url)) {
        serviceUrlSet.add(nMeta.url);
        layers.push({
          title: nMeta.title ?? nid,
          url: nMeta.url,
          itemId: nid,
          layerType: nMeta.type,
          role: layerRole(nMeta.title ?? ""),
        });
      }
    } catch {
      // Nested item may live on another org — skip.
    }
  }

  // Also walk Experience dataSources for map references.
  if (data && typeof data === "object") {
    const ds = (data as { dataSources?: Record<string, unknown> }).dataSources;
    if (ds) collectItemIds(ds, nestedIds);
  }

  let services: ResolvedService[] = [...serviceUrlSet].map((url) => ({
    url,
    layerId: (() => {
      const m = url.match(/\/(\d+)$/);
      return m ? Number(m[1]) : null;
    })(),
    title: null,
    fields: [],
    editingInfo: null,
    geometryType: null,
  }));

  if (opts?.enrichServices !== false) {
    // Cap enrichment to keep discovery bounded.
    const draftPreferred = services
      .filter((s) => /Adopted_Planning|FeatureServer/i.test(s.url))
      .slice(0, 24);
    const rest = services.filter((s) => !draftPreferred.includes(s)).slice(0, 8);
    services = await Promise.all([...draftPreferred, ...rest].map((s) => enrichService(s.url)));
  }

  const fingerprintPayload = {
    itemId,
    modified: meta.modified ?? null,
    webMapItemIds: webMapItemIds.sort(),
    layers: layers.map((l) => ({ t: l.title, u: l.url, r: l.role })).sort((a, b) => a.t.localeCompare(b.t)),
    services: services.map((s) => ({
      u: s.url,
      e: s.editingInfo?.lastEditDate ?? null,
      f: (s.fields ?? []).slice(0, 12),
    })),
  };
  const discoveryFingerprint = JSON.stringify(fingerprintPayload);

  const value: ResolvedExperience = {
    experienceItemId: itemId,
    portalHost,
    title: meta.title ?? itemId,
    type: meta.type ?? "Web Experience",
    modified: meta.modified ?? null,
    webMapItemIds,
    layers,
    services,
    discoveryFingerprint,
    resolvedAt: new Date().toISOString(),
  };
  resolveCache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, value });
  return value;
}

/** Clear resolver cache (tests). */
export function clearArcGisExperienceCache() {
  resolveCache.clear();
}

/** Developer-relevant draft layers from an Inner West–style Experience. */
export function pickDeveloperRelevantLayers(resolved: ResolvedExperience): ResolvedLayer[] {
  const prefer = /draft|incentive|key site|zoning|floor space|height|affordable|heritage|lot size|reservation|frontage|public realm|entertainment/i;
  return resolved.layers.filter((l) => l.url && prefer.test(`${l.parentTitle ?? ""} ${l.title}`) && l.role !== "CURRENT");
}

export { ITEM_ID_RE };
