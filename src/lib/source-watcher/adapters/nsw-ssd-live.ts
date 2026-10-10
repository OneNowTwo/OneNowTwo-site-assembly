/**
 * LIVE NSW Major Projects / SSD listing adapter.
 * Scrapes official Planning Portal major-projects listing pages (statewide),
 * then resolves geometry via project detail pages or approved geocoder.
 */

import { geocode } from "@/lib/data-sources/geocoder";
import type { FetchResult, NormalisedSourcePayload, SourceAdapter } from "../types";
import type { DevelopmentActivity } from "../development-activity";

const SOURCE_ID = "nsw-major-projects";
const LIST_URL = "https://www.planningportal.nsw.gov.au/major-projects/projects";
const ORIGIN = "https://www.planningportal.nsw.gov.au";

const STATUS_PAGES = ["Exhibition", "Assessment", "Determination"] as const;
const MAX_DETAIL_FETCHES = 40;
const MAX_GEOCODES = 40;

export interface MajorProjectListing {
  externalId: string;
  name: string;
  address: string | null;
  lga: string | null;
  status: string;
  caseType: string | null;
  caseNumber: string | null;
  sourceUrl: string;
  developmentType: string | null;
  lng?: number | null;
  lat?: number | null;
}

function classifyStatus(raw: string): DevelopmentActivity["status"] {
  const s = raw.toLowerCase();
  if (/exhibit/.test(s)) return "EXHIBITION";
  if (/assess/.test(s)) return "ASSESSMENT";
  if (/determin|approv/.test(s)) return "DETERMINED";
  if (/refus/.test(s)) return "REFUSED";
  if (/withdraw/.test(s)) return "WITHDRAWN";
  return "OTHER";
}

export function parseMajorProjectsHtml(html: string, pageStatus: string): MajorProjectListing[] {
  const out: MajorProjectListing[] = [];
  const hrefRe = /href="(\/major-projects\/projects\/[^"]+)"/g;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html))) {
    const path = m[1]!;
    if (seen.has(path)) continue;
    seen.add(path);
    const i = m.index;
    const chunk = html.slice(Math.max(0, i - 800), Math.min(html.length, i + 1200));
    const text = chunk
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const slug = path.split("/").pop() ?? path;
    const caseMatch = text.match(/\b((?:SSD|SSI|CSSI|MOD)-\d+)\b/i);
    const caseNumber = caseMatch?.[1] ?? null;
    const titleMatch = text.match(/([A-Z][^.]{8,120}?)\s+Read more/i);
    const name = titleMatch?.[1]?.trim() ?? slug.replace(/-/g, " ");
    const addrMatch = text.match(
      /(\d+[^,]{0,40},\s*[A-Za-z][A-Za-z\s-]{2,40}(?:,\s*Nsw\s*\d{4})?)/i,
    );
    const lgaMatch = text.match(
      /\b((?:City of |Municipality of |Shire of )?[A-Z][A-Za-z]+(?:\s[A-Z][A-Za-z]+)?(?:\s(?:City|Shire|Council))?)\s+(?:SSD|SSI|CSSI|Exhibition|Assessment|Determination|State Significant)/,
    );
    out.push({
      externalId: caseNumber ?? slug,
      name,
      address: addrMatch?.[1]?.trim() ?? null,
      lga: lgaMatch?.[1]?.trim() ?? null,
      status: pageStatus,
      caseType: /SSI/i.test(caseNumber ?? "")
        ? "State Significant Infrastructure"
        : /SSD/i.test(caseNumber ?? text)
          ? "State Significant Development"
          : null,
      caseNumber,
      sourceUrl: `${ORIGIN}${path}`,
      developmentType: /housing|residential|mixed use|shop top|apartment/i.test(text)
        ? "Residential / mixed use"
        : null,
    });
  }
  return out;
}

/** Pull address / lat-lng from an official major-project detail page when present. */
export function parseMajorProjectDetail(html: string): {
  address: string | null;
  lng: number | null;
  lat: number | null;
} {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
  const addr =
    text.match(/\bAddress\s*[:\-]\s*([^|]{8,120}?)(?:\s{2,}|LGA|Local government|Project)/i)?.[1]?.trim() ??
    text.match(/(\d{1,5}[^,]{0,40},\s*[A-Za-z][A-Za-z\s-]{2,40},\s*NSW\s*\d{4})/i)?.[1]?.trim() ??
    null;
  const lngMatch =
    html.match(/["'](?:lng|longitude|x)["']\s*[:=]\s*(-?\d+\.\d+)/i) ??
    html.match(/longitude["']?\s*[:=]\s*(-?\d+\.\d+)/i);
  const latMatch =
    html.match(/["'](?:lat|latitude|y)["']\s*[:=]\s*(-?\d+\.\d+)/i) ??
    html.match(/latitude["']?\s*[:=]\s*(-?\d+\.\d+)/i);
  let lng = lngMatch ? parseFloat(lngMatch[1]!) : null;
  let lat = latMatch ? parseFloat(latMatch[1]!) : null;
  // GeoJSON-ish coordinates array [lng, lat]
  if (lng == null || lat == null) {
    const pair = html.match(/coordinates"\s*:\s*\[\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*\]/);
    if (pair) {
      lng = parseFloat(pair[1]!);
      lat = parseFloat(pair[2]!);
    }
  }
  if (lng != null && (lng < 140 || lng > 155)) {
    // Swap if lat/lng inverted
    if (lat != null && lat > 140 && lat < 155) {
      const t = lng;
      lng = lat;
      lat = t;
    } else {
      lng = null;
      lat = null;
    }
  }
  return { address: addr, lng, lat };
}

export function majorProjectsToDevelopmentActivities(
  listings: MajorProjectListing[],
  checkedAt: string,
): DevelopmentActivity[] {
  return listings.map((p) => ({
    id: `${SOURCE_ID}:${p.externalId}`,
    sourceId: SOURCE_ID,
    externalId: p.externalId,
    type: "SSD" as const,
    status: classifyStatus(p.status),
    address: p.address,
    lga: p.lga,
    geometry:
      p.lng != null && p.lat != null
        ? { type: "Point" as const, coordinates: [p.lng, p.lat] as [number, number] }
        : null,
    developmentType: p.developmentType ?? p.caseType,
    description: p.name,
    dwellings: null,
    storeys: null,
    estimatedCost: null,
    lodgedAt: null,
    determinedAt: null,
    sourceUrl: p.sourceUrl,
    checkedAt,
  }));
}

async function fetchStatusPage(status: string): Promise<string> {
  const url = `${LIST_URL}?status=${encodeURIComponent(status)}`;
  const res = await fetch(url, {
    method: "GET",
    signal: AbortSignal.timeout(25000),
    headers: { "User-Agent": "SiteAssembly/0.1 SourceWatcher", Accept: "text/html" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Major Projects list HTTP ${res.status} (${status})`);
  return res.text();
}

async function enrichListing(listing: MajorProjectListing): Promise<MajorProjectListing> {
  try {
    const res = await fetch(listing.sourceUrl, {
      method: "GET",
      signal: AbortSignal.timeout(20000),
      headers: { "User-Agent": "SiteAssembly/0.1 SourceWatcher", Accept: "text/html" },
      cache: "no-store",
    });
    if (!res.ok) return listing;
    const html = await res.text();
    const detail = parseMajorProjectDetail(html);
    return {
      ...listing,
      address: listing.address ?? detail.address,
      lng: detail.lng,
      lat: detail.lat,
    };
  } catch {
    return listing;
  }
}

export const majorProjectsLiveAdapter: SourceAdapter = {
  id: SOURCE_ID,
  async fetch(): Promise<FetchResult> {
    const checkedAt = new Date().toISOString();
    const byId = new Map<string, MajorProjectListing>();
    for (const status of STATUS_PAGES) {
      const html = await fetchStatusPage(status);
      for (const row of parseMajorProjectsHtml(html, status)) {
        if (!byId.has(row.externalId)) byId.set(row.externalId, row);
      }
    }
    let listings = [...byId.values()];

    // Enrich a capped set with detail-page coordinates / addresses.
    const toEnrich = listings.slice(0, MAX_DETAIL_FETCHES);
    const enriched = await Promise.all(toEnrich.map((l) => enrichListing(l)));
    const enrichedById = new Map(enriched.map((l) => [l.externalId, l]));
    listings = listings.map((l) => enrichedById.get(l.externalId) ?? l);

    let geocodeAttempts = 0;
    for (const l of listings) {
      if (l.lng != null && l.lat != null) continue;
      if (!l.address || geocodeAttempts >= MAX_GEOCODES) continue;
      geocodeAttempts += 1;
      try {
        const geo = await geocode(`${l.address}, NSW`);
        const hit = geo.results[0];
        if (hit) {
          l.lng = hit.lng;
          l.lat = hit.lat;
        }
      } catch {
        // leave null
      }
    }

    const activities = majorProjectsToDevelopmentActivities(listings, checkedAt);
    const withGeom = activities.filter((a) => a.geometry).length;
    const normalised: NormalisedSourcePayload = {
      kind: "major_projects",
      checkedAt,
      records: activities.map((a) => ({ ...a, recordKind: "development_activity", name: a.description })),
      meta: {
        status: listings.length ? "LIVE" : "EMPTY",
        listUrl: LIST_URL,
        projectCount: listings.length,
        projectsWithGeometry: withGeom,
        detailPagesFetched: Math.min(listings.length, MAX_DETAIL_FETCHES),
        geocodeAttempts,
        statuses: [...STATUS_PAGES],
      },
    };
    return {
      raw: { projectCount: listings.length, projectsWithGeometry: withGeom },
      normalised,
    };
  },
};
