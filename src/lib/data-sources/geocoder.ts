import { buildUrl, fetchJson } from "./http";
import type { GeocodeResult, GeocoderProvider } from "./providers";

/** NSW bounding box used to bias / restrict geocoding. */
const NSW_VIEWBOX = "140.99,-28.15,153.64,-37.51";

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
  boundingbox?: [string, string, string, string];
  addresstype?: string;
  type?: string;
}

/** OpenStreetMap Nominatim (free, no key; usage policy: identify the app, max 1 req/s, cache results). */
export const nominatimGeocoder: GeocoderProvider = {
  name: "OpenStreetMap Nominatim",
  async search(query) {
    const url = buildUrl(process.env.GEOCODER_URL ?? "https://nominatim.openstreetmap.org/search", {
      q: /nsw|new south wales/i.test(query) ? query : `${query}, NSW`,
      format: "jsonv2",
      countrycodes: "au",
      viewbox: NSW_VIEWBOX,
      bounded: 1,
      limit: 6,
      addressdetails: 0,
    });
    const rows = await fetchJson<NominatimResult[]>(url, {
      service: "Geocoder",
      timeoutMs: 8000,
      ttlMs: 24 * 60 * 60 * 1000,
      headers: { "Accept-Language": "en-AU" },
    });
    return rows.map((r) => {
      const [s, n, w, e] = (r.boundingbox ?? []).map(Number);
      const kind: GeocodeResult["kind"] =
        r.addresstype === "suburb" || r.addresstype === "city" || r.addresstype === "town" ? "suburb" : r.addresstype === "building" || r.addresstype === "house" || r.addresstype === "road" ? "address" : "place";
      return {
        label: r.display_name.replace(/, Australia$/, ""),
        lat: Number(r.lat),
        lng: Number(r.lon),
        bbox: r.boundingbox ? { south: s, north: n, west: w, east: e } : undefined,
        kind,
        source: "OpenStreetMap Nominatim",
      };
    });
  },
};

/** Offline fallback so the core suburbs remain searchable if the geocoder is unreachable. */
const KNOWN_PLACES: GeocodeResult[] = [
  ["Neutral Bay", -33.8357, 151.2186],
  ["Crows Nest", -33.8263, 151.2034],
  ["Cremorne", -33.8297, 151.2272],
  ["Chatswood", -33.7969, 151.1832],
  ["St Leonards", -33.8228, 151.1946],
  ["North Sydney", -33.8389, 151.2071],
  ["Parramatta", -33.8148, 151.0017],
  ["Epping", -33.7727, 151.0818],
  ["Hornsby", -33.7025, 151.0993],
  ["Burwood", -33.8773, 151.1043],
  ["Strathfield", -33.8794, 151.0827],
  ["Kogarah", -33.9631, 151.1336],
  ["Randwick", -33.9146, 151.2414],
  ["Ryde", -33.8149, 151.1048],
  ["Castle Hill", -33.7316, 151.0034],
].map(([name, lat, lng]) => ({
  label: `${name}, NSW (offline gazetteer)`,
  lat: lat as number,
  lng: lng as number,
  kind: "suburb" as const,
  source: "Built-in suburb list (geocoder unavailable)",
}));

export function offlineGeocode(query: string): GeocodeResult[] {
  const q = query.toLowerCase().replace(/,?\s*(nsw|new south wales)\b/g, "").trim();
  if (!q) return [];
  return KNOWN_PLACES.filter((p) => p.label.toLowerCase().includes(q));
}

export async function geocode(query: string): Promise<{ results: GeocodeResult[]; fallback: boolean; message?: string }> {
  try {
    const results = await nominatimGeocoder.search(query);
    if (results.length) return { results, fallback: false };
    const off = offlineGeocode(query);
    return { results: off, fallback: off.length > 0 };
  } catch (err) {
    return {
      results: offlineGeocode(query),
      fallback: true,
      message: `Geocoder unavailable (${err instanceof Error ? err.message : "error"}); showing built-in suburbs.`,
    };
  }
}
