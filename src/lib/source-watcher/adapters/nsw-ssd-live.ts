/**
 * LIVE NSW Major Projects / SSD listing adapter.
 * Scrapes official Planning Portal major-projects listing pages (statewide).
 */

import type { FetchResult, NormalisedSourcePayload, SourceAdapter } from "../types";
import type { DevelopmentActivity } from "../development-activity";

const SOURCE_ID = "nsw-major-projects";
const LIST_URL = "https://www.planningportal.nsw.gov.au/major-projects/projects";
const ORIGIN = "https://www.planningportal.nsw.gov.au";

const STATUS_PAGES = ["Exhibition", "Assessment", "Determination"] as const;

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
    // Title often appears just before "Read more"
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
    geometry: null,
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
    const listings = [...byId.values()];
    const activities = majorProjectsToDevelopmentActivities(listings, checkedAt);
    const normalised: NormalisedSourcePayload = {
      kind: "major_projects",
      checkedAt,
      records: activities.map((a) => ({ ...a, recordKind: "development_activity", name: a.description })),
      meta: {
        status: listings.length ? "LIVE" : "EMPTY",
        listUrl: LIST_URL,
        projectCount: listings.length,
        statuses: [...STATUS_PAGES],
      },
    };
    return { raw: { projectCount: listings.length }, normalised };
  },
};
