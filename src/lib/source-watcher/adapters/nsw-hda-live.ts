/**
 * LIVE Housing Delivery Authority published-records adapter.
 * Official source: planning.nsw.gov.au HDA published records page.
 * Indexes briefing PDFs, extracts structured project entries when text is available,
 * geocodes addresses via the approved geocoder — never invents missing fields.
 */

import { geocode } from "@/lib/data-sources/geocoder";
import type { DiffEvent, FetchResult, NormalisedSourcePayload, SourceAdapter } from "../types";
import type { DevelopmentActivity } from "../development-activity";

const SOURCE_ID = "nsw-hda-records";
const PAGE_URL =
  "https://www.planning.nsw.gov.au/the-planning-system/housing/housing-delivery-authority/published-records";
const ORIGIN = "https://www.planning.nsw.gov.au";
/** Cap PDF downloads per crawl — newest briefings first. */
const MAX_PDFS_TO_PARSE = 4;
const MAX_GEOCODES = 40;

export interface HdaPublishedRecord {
  externalId: string;
  meetingDate: string | null;
  title: string;
  sourceUrl: string;
  kind: "RECORD_OF_BRIEFING" | "ADDENDUM" | "CRITERIA" | "OTHER";
}

export interface HdaProjectEntry {
  eoiId: string | null;
  address: string | null;
  suburb: string | null;
  lga: string | null;
  proponent: string | null;
  dwellings: number | null;
  recommendation: string | null;
  sourceUrl: string;
  meetingDate: string | null;
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

/** Extract readable text from a PDF buffer (simple stream/literal scrape — no invented fields). */
export function extractPdfText(buffer: ArrayBuffer | Buffer): string {
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const chunks: string[] = [];
  // Literal strings in parentheses
  const re = /\((?:\\.|[^\\)]){3,200}\)/g;
  const ascii = data.toString("latin1");
  let m: RegExpExecArray | null;
  while ((m = re.exec(ascii))) {
    const raw = m[0].slice(1, -1);
    const decoded = raw
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "")
      .replace(/\\t/g, " ")
      .replace(/\\\(/g, "(")
      .replace(/\\\)/g, ")")
      .replace(/\\\\/g, "\\");
    if (/[A-Za-z]{3,}/.test(decoded)) chunks.push(decoded);
  }
  // Also pull TJ array text fragments
  const tj = /\[([^\]]{4,400})\]\s*TJ/g;
  while ((m = tj.exec(ascii))) {
    const inner = m[1]!;
    const parts = [...inner.matchAll(/\((?:\\.|[^\\)]){2,120}\)/g)].map((p) =>
      p[0]
        .slice(1, -1)
        .replace(/\\n/g, " ")
        .replace(/\\\(/g, "(")
        .replace(/\\\)/g, ")")
        .replace(/\\\\/g, "\\"),
    );
    if (parts.length) chunks.push(parts.join(""));
  }
  return chunks.join("\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n");
}

/**
 * Parse project-like rows from HDA briefing text.
 * Only captures fields present as patterns in the official document.
 */
export function parseHdaProjectsFromText(text: string, meta: { sourceUrl: string; meetingDate: string | null }): HdaProjectEntry[] {
  const out: HdaProjectEntry[] = [];
  const seen = new Set<string>();
  // EOI / proposal ids commonly appear as HDA-… or EOI-…
  const eoiRe = /\b((?:HDA|EOI)[- ]?\d{2,6}(?:[-/]\d{1,4})?)\b/gi;
  let m: RegExpExecArray | null;
  const eoiHits: { id: string; index: number }[] = [];
  while ((m = eoiRe.exec(text))) {
    eoiHits.push({ id: m[1]!.replace(/\s+/g, "-").toUpperCase(), index: m.index });
  }

  const addressRe =
    /(\d{1,5}[A-Za-z]?(?:[-/]\d{1,5}[A-Za-z]?)?\s+[A-Z][A-Za-z'’\-]+(?:\s+[A-Z][A-Za-z'’\-]+){0,4}\s+(?:Street|St|Road|Rd|Avenue|Ave|Parade|Pde|Drive|Dr|Lane|Ln|Place|Pl|Way|Circuit|Cct|Boulevard|Blvd|Terrace|Tce|Highway|Hwy)\b[^.\n]{0,80})/g;

  if (eoiHits.length) {
    for (let i = 0; i < eoiHits.length; i++) {
      const hit = eoiHits[i]!;
      const chunk = text.slice(hit.index, eoiHits[i + 1]?.index ?? hit.index + 800);
      const addr = chunk.match(addressRe)?.[1]?.trim() ?? null;
      const suburbMatch = chunk.match(
        /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+){0,2})\s+(?:NSW|New South Wales)\b/,
      );
      const lgaMatch = chunk.match(
        /\b((?:City of |Municipality of |Shire of )?[A-Z][A-Za-z]+(?:\s[A-Z][A-Za-z]+){0,3}\s(?:City|Shire|Council|Municipal))\b/,
      );
      const dwellingsMatch = chunk.match(/\b(\d{1,4})\s*(?:dwellings?|homes?|units?|apartments?)\b/i);
      const recMatch = chunk.match(
        /\b(not\s+recommended|recommended|deferred|ssd\s+pathway(?:\s+recommended)?)\b/i,
      );
      const proponentMatch = chunk.match(/\b(?:Proponent|Applicant)\s*[:\-]\s*([^\n]{3,80})/i);
      const key = `${hit.id}:${addr ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        eoiId: hit.id,
        address: addr,
        suburb: suburbMatch?.[1] ?? null,
        lga: lgaMatch?.[1] ?? null,
        proponent: proponentMatch?.[1]?.trim() ?? null,
        dwellings: dwellingsMatch ? parseInt(dwellingsMatch[1]!, 10) : null,
        recommendation: recMatch?.[1]?.toUpperCase().replace(/\s+/g, "_") ?? null,
        sourceUrl: meta.sourceUrl,
        meetingDate: meta.meetingDate,
      });
    }
  } else {
    // Fallback: address-led rows when EOI ids are not machine-readable in the PDF text layer.
    let am: RegExpExecArray | null;
    while ((am = addressRe.exec(text))) {
      const address = am[1]!.trim();
      if (seen.has(address)) continue;
      seen.add(address);
      const window = text.slice(Math.max(0, am.index - 120), am.index + 400);
      const dwellingsMatch = window.match(/\b(\d{1,4})\s*(?:dwellings?|homes?|units?|apartments?)\b/i);
      const recMatch = window.match(/\b(not\s+recommended|recommended|deferred)\b/i);
      out.push({
        eoiId: null,
        address,
        suburb: null,
        lga: null,
        proponent: null,
        dwellings: dwellingsMatch ? parseInt(dwellingsMatch[1]!, 10) : null,
        recommendation: recMatch?.[1]?.toUpperCase().replace(/\s+/g, "_") ?? null,
        sourceUrl: meta.sourceUrl,
        meetingDate: meta.meetingDate,
      });
      if (out.length >= 30) break;
    }
  }
  return out;
}

function classifyRecommendation(raw: string | null): DevelopmentActivity["status"] {
  if (!raw) return "OTHER";
  if (/NOT_RECOMMENDED/i.test(raw)) return "REFUSED";
  if (/DEFERRED/i.test(raw)) return "OTHER";
  if (/RECOMMENDED|SSD_PATHWAY/i.test(raw)) return "RECOMMENDED";
  return "OTHER";
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

export function hdaProjectsToDevelopmentActivities(
  projects: HdaProjectEntry[],
  checkedAt: string,
  geocoded: Map<string, { lng: number; lat: number }>,
): DevelopmentActivity[] {
  return projects.map((p, i) => {
    const externalId = p.eoiId ?? `addr-${i}-${(p.address ?? "unknown").slice(0, 40)}`;
    const geoKey = p.address ?? "";
    const pt = geoKey ? geocoded.get(geoKey) : undefined;
    return {
      id: `${SOURCE_ID}:project:${externalId}`,
      sourceId: SOURCE_ID,
      externalId,
      type: "HDA" as const,
      status: classifyRecommendation(p.recommendation),
      address: p.address,
      suburb: p.suburb,
      lga: p.lga,
      geometry: pt ? { type: "Point" as const, coordinates: [pt.lng, pt.lat] as [number, number] } : null,
      developmentType: "Housing Delivery Authority project",
      description: [p.eoiId, p.address, p.proponent].filter(Boolean).join(" · ") || "HDA project",
      dwellings: p.dwellings,
      storeys: null,
      estimatedCost: null,
      lodgedAt: p.meetingDate,
      determinedAt: null,
      sourceUrl: p.sourceUrl,
      checkedAt,
      recommendation: p.recommendation,
    };
  });
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

async function downloadAndParsePdf(url: string): Promise<string> {
  const res = await fetch(url, {
    method: "GET",
    signal: AbortSignal.timeout(45000),
    headers: { "User-Agent": "SiteAssembly/0.1 SourceWatcher", Accept: "application/pdf" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HDA PDF HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  return extractPdfText(buf);
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
    const indexActivities = hdaRecordsToDevelopmentActivities(docs, checkedAt);

    const briefings = docs.filter((d) => d.kind === "RECORD_OF_BRIEFING").slice(0, MAX_PDFS_TO_PARSE);
    const projects: HdaProjectEntry[] = [];
    let pdfsParsed = 0;
    for (const doc of briefings) {
      try {
        const text = await downloadAndParsePdf(doc.sourceUrl);
        pdfsParsed += 1;
        projects.push(...parseHdaProjectsFromText(text, { sourceUrl: doc.sourceUrl, meetingDate: doc.meetingDate }));
      } catch {
        // Keep index activity even if a PDF cannot be parsed.
      }
    }

    const geocoded = new Map<string, { lng: number; lat: number }>();
    let geocodeAttempts = 0;
    for (const p of projects) {
      if (!p.address || geocodeAttempts >= MAX_GEOCODES) continue;
      if (geocoded.has(p.address)) continue;
      geocodeAttempts += 1;
      try {
        const q = [p.address, p.suburb, "NSW"].filter(Boolean).join(", ");
        const geo = await geocode(q);
        const hit = geo.results[0];
        if (hit) geocoded.set(p.address, { lng: hit.lng, lat: hit.lat });
      } catch {
        // leave ungeocoded
      }
    }

    const projectActivities = hdaProjectsToDevelopmentActivities(projects, checkedAt, geocoded);
    const withGeom = projectActivities.filter((a) => a.geometry).length;

    const normalised: NormalisedSourcePayload = {
      kind: "hda_records",
      checkedAt,
      records: [
        ...docs.map((d) => ({ ...d, recordKind: "document_index" })),
        ...indexActivities.map((a) => ({ ...a, recordKind: "development_activity" })),
        ...projectActivities.map((a) => ({ ...a, recordKind: "development_activity" })),
      ],
      meta: {
        status: "LIVE",
        pageUrl: PAGE_URL,
        documentCount: docs.length,
        briefingCount: docs.filter((d) => d.kind === "RECORD_OF_BRIEFING").length,
        pdfsParsed,
        projectsParsed: projects.length,
        projectsGeocoded: withGeom,
        note:
          "Live HDA Record of Briefing index + PDF text extract (when available) + geocode. Fields only when present in official text.",
      },
    };
    return {
      raw: {
        status: res.status,
        documentCount: docs.length,
        pdfsParsed,
        projectsParsed: projects.length,
        projectsGeocoded: withGeom,
      },
      normalised,
    };
  },
};
