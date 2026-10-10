/**
 * LIVE Housing Delivery Authority published-records adapter.
 * Official source: planning.nsw.gov.au HDA published records page.
 * Captures briefing PDF index + meeting dates; structured dwellings/addresses
 * when parseable from link text — never invents missing fields.
 */

import type { DiffEvent, FetchResult, NormalisedSourcePayload, SourceAdapter } from "../types";
import type { DevelopmentActivity } from "../development-activity";

const SOURCE_ID = "nsw-hda-records";
const PAGE_URL =
  "https://www.planning.nsw.gov.au/the-planning-system/housing/housing-delivery-authority/published-records";
const ORIGIN = "https://www.planning.nsw.gov.au";

export interface HdaPublishedRecord {
  externalId: string;
  meetingDate: string | null;
  title: string;
  sourceUrl: string;
  kind: "RECORD_OF_BRIEFING" | "ADDENDUM" | "CRITERIA" | "OTHER";
}

function absoluteUrl(href: string): string {
  if (href.startsWith("http")) return href;
  if (href.startsWith("/")) return `${ORIGIN}${href}`;
  return `${ORIGIN}/${href}`;
}

function parseMeetingDateFromHref(href: string): string | null {
  const m = href.match(/(\d{8})/);
  if (!m) return null;
  const raw = m[1]!;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

export function parseHdaPublishedRecordsHtml(html: string): HdaPublishedRecord[] {
  const records: HdaPublishedRecord[] = [];
  const seen = new Set<string>();
  const re = /href="([^"]+\.pdf[^"]*)"/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const href = match[1]!;
    if (!/housing-delivery-authority/i.test(href)) continue;
    const sourceUrl = absoluteUrl(href);
    if (seen.has(sourceUrl)) continue;
    seen.add(sourceUrl);
    const file = sourceUrl.split("/").pop() ?? sourceUrl;
    const kind: HdaPublishedRecord["kind"] = /addendum/i.test(file)
      ? "ADDENDUM"
      : /criteria/i.test(file)
        ? "CRITERIA"
        : /record-of-briefing/i.test(file)
          ? "RECORD_OF_BRIEFING"
          : "OTHER";
    const meetingDate = parseMeetingDateFromHref(file);
    const externalId = file.replace(/\.pdf$/i, "");
    records.push({
      externalId,
      meetingDate,
      title: file.replace(/-/g, " ").replace(/\.pdf$/i, ""),
      sourceUrl,
      kind,
    });
  }
  return records.sort((a, b) => (b.meetingDate ?? "").localeCompare(a.meetingDate ?? ""));
}

export function hdaRecordsToDevelopmentActivities(
  records: HdaPublishedRecord[],
  checkedAt: string,
): DevelopmentActivity[] {
  return records
    .filter((r) => r.kind === "RECORD_OF_BRIEFING" || r.kind === "ADDENDUM")
    .map((r) => ({
      id: `${SOURCE_ID}:${r.externalId}`,
      sourceId: SOURCE_ID,
      externalId: r.externalId,
      type: "HDA" as const,
      status: "OTHER" as const,
      address: null,
      geometry: null,
      developmentType: "Housing Delivery Authority briefing",
      description: r.title,
      dwellings: null,
      storeys: null,
      estimatedCost: null,
      lodgedAt: r.meetingDate,
      determinedAt: null,
      sourceUrl: r.sourceUrl,
      checkedAt,
      recommendation: null,
    }));
}

/** Pure helper for tests — emit publish events when new briefing docs appear. */
export function diffHdaDocumentIndex(
  previousUrls: string[],
  next: HdaPublishedRecord[],
): DiffEvent[] {
  const prev = new Set(previousUrls);
  const events: DiffEvent[] = [];
  for (const r of next) {
    if (prev.has(r.sourceUrl)) continue;
    if (r.kind === "CRITERIA") continue;
    events.push({
      kind: "HDA_RECORD_PUBLISHED",
      title: `HDA record published${r.meetingDate ? ` · ${r.meetingDate}` : ""}`,
      summary: r.title,
      changeKey: `hda:published:${r.externalId}`,
      newValue: r,
      href: r.sourceUrl,
      importance: 0.75,
    });
  }
  return events;
}

export const hdaLiveAdapter: SourceAdapter = {
  id: SOURCE_ID,
  async fetch(): Promise<FetchResult> {
    const checkedAt = new Date().toISOString();
    const res = await fetch(PAGE_URL, {
      method: "GET",
      signal: AbortSignal.timeout(25000),
      headers: { "User-Agent": "SiteAssembly/0.1 SourceWatcher", Accept: "text/html" },
      cache: "no-store",
    });
    const html = await res.text();
    if (!res.ok) {
      throw new Error(`HDA published-records HTTP ${res.status}`);
    }
    const docs = parseHdaPublishedRecordsHtml(html);
    const activities = hdaRecordsToDevelopmentActivities(docs, checkedAt);
    const normalised: NormalisedSourcePayload = {
      kind: "hda_records",
      checkedAt,
      records: [
        ...docs.map((d) => ({ ...d, recordKind: "document_index" })),
        ...activities.map((a) => ({ ...a, recordKind: "development_activity" })),
      ],
      meta: {
        status: "LIVE",
        pageUrl: PAGE_URL,
        documentCount: docs.length,
        briefingCount: docs.filter((d) => d.kind === "RECORD_OF_BRIEFING").length,
        note:
          "Live index of official HDA Record of Briefing PDFs. Per-proposal address/dwellings require PDF extract when published as structured text.",
      },
    };
    return { raw: { status: res.status, documentCount: docs.length }, normalised };
  },
};
