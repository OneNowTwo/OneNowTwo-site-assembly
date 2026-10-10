/**
 * Live Edgecliff–Woollahra state-led rezoning adapter.
 *
 * LIVE: NSW Planning Portal exhibition page metadata (status / Last-Modified / title).
 * STRUCTURED: MANUALLY_STRUCTURED_FIXTURE controls + geometry from the official map pack
 * until an official FeatureServer exists (portal probe found PDFs only — no ArcGIS layers).
 *
 * Never writes into PlanningSnapshot / current law.
 */

import { createHash } from "node:crypto";
import type { FetchResult, NormalisedSourcePayload, SourceAdapter } from "../types";
import { contentHash } from "../hash";
import edgecliff from "../fixtures/edgecliff-woollahra.json";
import edgecliffBump from "../fixtures/edgecliff-woollahra-fsr-bump.json";

const PORTAL_URL =
  "https://www.planningportal.nsw.gov.au/ppr/under-exhibition/edgecliff-woollahra-precinct";

/** Stable id for the structured map-pack content we ship in-repo. */
export const EDGECLIFF_DOCUMENT_PACK_ID = "Edgecliff-Woollahra Proposed Maps (exhibition)";
export const EDGECLIFF_STRUCTURED_PARSER_VERSION = "edgecliff-structured-2";

/** Test-only: when true, return FSR-bump structured pack with live metadata. */
let bumpVariant = false;

export function setEdgecliffLiveBumpVariant(on: boolean) {
  bumpVariant = on;
}

export function getEdgecliffLiveBumpVariant() {
  return bumpVariant;
}

export function structuredPackDocumentHash(pack: NormalisedSourcePayload): string {
  // Hash controls/geometry only — exclude volatile checkedAt / live portal meta.
  const areas = (pack.planningChangeAreas ?? []).map((a) => ({
    id: a.id,
    status: a.status,
    proposedControls: a.proposedControls,
    keySites: a.keySites,
    bbox: a.bbox,
    geometry: a.geometry,
  }));
  return contentHash({ documentPack: EDGECLIFF_DOCUMENT_PACK_ID, areas });
}

async function fetchPortalMeta(): Promise<{
  ok: boolean;
  lastModified: string | null;
  etag: string | null;
  title: string | null;
  statusHint: string;
  bodyHash: string | null;
  pdfCount: number;
}> {
  try {
    const res = await fetch(PORTAL_URL, {
      method: "GET",
      signal: AbortSignal.timeout(20000),
      headers: { "User-Agent": "SiteAssembly/0.1 SourceWatcher", Accept: "text/html" },
      cache: "no-store",
    });
    const lastModified = res.headers.get("last-modified");
    const etag = res.headers.get("etag");
    const html = await res.text();
    const head = html.slice(0, 40000);
    const titleMatch = head.match(/<title[^>]*>([^<]+)/i);
    const underExhibition = /under.?exhibition|public exhibition/i.test(head);
    const pdfCount = (html.match(/\.pdf/gi) ?? []).length;
    const bodyHash = createHash("sha256").update(html).digest("hex").slice(0, 32);
    return {
      ok: res.ok,
      lastModified,
      etag,
      title: titleMatch?.[1]?.trim() ?? null,
      statusHint: underExhibition ? "UNDER_EXHIBITION" : "PROPOSED",
      bodyHash,
      pdfCount,
    };
  } catch {
    return {
      ok: false,
      lastModified: null,
      etag: null,
      title: null,
      statusHint: "UNDER_EXHIBITION",
      bodyHash: null,
      pdfCount: 0,
    };
  }
}

function applyLiveMeta(
  pack: NormalisedSourcePayload,
  portal: Awaited<ReturnType<typeof fetchPortalMeta>>,
  opts?: { previousDocumentHash?: string | null; previousPortalBodyHash?: string | null },
): NormalisedSourcePayload {
  const checkedAt = new Date().toISOString();
  // Hash structured controls/geometry only — before live notes are attached.
  const documentHash = structuredPackDocumentHash(pack);
  const portalChanged =
    !!opts?.previousPortalBodyHash &&
    !!portal.bodyHash &&
    opts.previousPortalBodyHash !== portal.bodyHash;
  const structuredStale = portalChanged && opts?.previousDocumentHash === documentHash;
  const structuredDataStatus = structuredStale ? "NEEDS_RE_EXTRACTION" : "CURRENT_STRUCTURED";

  const areas = (pack.planningChangeAreas ?? []).map((area) => ({
    ...area,
    sourceUrl: PORTAL_URL,
    status: portal.statusHint === "UNDER_EXHIBITION" ? "UNDER_EXHIBITION" : area.status,
    proposedControls: {
      ...area.proposedControls,
      legalStatus: "UNDER_EXHIBITION" as const,
      machineReadable: true,
      // Stable provenance blurb — omit volatile hashes from notes (live in meta).
      notes: [
        area.proposedControls.notes ?? "",
        "PROVENANCE: LIVE portal metadata + MANUALLY_STRUCTURED_FIXTURE controls/geometry from official map pack.",
        "Not official FeatureServer vector — portal exhibition page exposes PDFs only (no ArcGIS FeatureServer discovered).",
      ]
        .filter(Boolean)
        .join(" "),
    },
    keySites: (area.keySites ?? []).map((site) => ({
      ...site,
      geometrySource: "MANUALLY_STRUCTURED_FIXTURE" as const,
      structuredConditions: site.structuredConditions?.length
        ? site.structuredConditions
        : (site.conditions ?? []).map((c) => ({
            type: /affordable/i.test(c)
              ? ("AFFORDABLE_HOUSING" as const)
              : /community/i.test(c)
                ? ("COMMUNITY_FACILITY" as const)
                : /through-site|link/i.test(c)
                  ? ("THROUGH_SITE_LINK" as const)
                  : /active/i.test(c)
                    ? ("ACTIVE_STREET_FRONTAGE" as const)
                    : ("OTHER" as const),
            description: c,
          })),
    })),
  }));

  // Stable checkedAt for hashing when portal + structured pack unchanged.
  const stableCheckedAt =
    !portalChanged && !structuredStale && opts?.previousDocumentHash === documentHash
      ? pack.checkedAt
      : checkedAt;

  return {
    ...pack,
    checkedAt: stableCheckedAt,
    planningChangeAreas: areas,
    meta: {
      ...pack.meta,
      livePortal: {
        url: PORTAL_URL,
        ok: portal.ok,
        lastModified: portal.lastModified,
        etag: portal.etag,
        title: portal.title,
        bodyHash: portal.bodyHash,
        pdfCount: portal.pdfCount,
      },
      geometrySource: "MANUALLY_STRUCTURED_FIXTURE",
      documentPack: EDGECLIFF_DOCUMENT_PACK_ID,
      documentHash,
      documentParserVersion: EDGECLIFF_STRUCTURED_PARSER_VERSION,
      structuredDataStatus,
      portalDocumentChanged: portalChanged,
      needsReExtraction: structuredStale,
      vectorServiceAvailable: false,
      legalStatus: "UNDER_EXHIBITION",
      authority: "NSW DPHI",
      provenance: {
        portal: "LIVE",
        controlsAndGeometry: "MANUALLY_STRUCTURED_FIXTURE",
        note: "Do not describe structured controls as fully live/vector.",
      },
    },
  };
}

export class EdgecliffLiveAdapter implements SourceAdapter {
  readonly id = "live-edgecliff-woollahra";

  /** Optional previous snapshot meta for invalidation (injected by pipeline/tests). */
  previousMeta: {
    documentHash?: string | null;
    portalBodyHash?: string | null;
  } | null = null;

  async fetch(): Promise<FetchResult> {
    const portal = await fetchPortalMeta();
    const base = structuredClone(
      (bumpVariant ? edgecliffBump : edgecliff) as NormalisedSourcePayload,
    );
    const normalised = applyLiveMeta(base, portal, {
      previousDocumentHash: this.previousMeta?.documentHash,
      previousPortalBodyHash: this.previousMeta?.portalBodyHash,
    });
    return {
      raw: {
        portal,
        documentPack: EDGECLIFF_DOCUMENT_PACK_ID,
        documentHash: normalised.meta?.documentHash,
        geometrySource: "MANUALLY_STRUCTURED_FIXTURE",
        vectorServiceAvailable: false,
      },
      normalised,
      sourceModifiedAt: portal.lastModified,
      etag: portal.etag ?? portal.bodyHash,
    };
  }
}

export const edgecliffLiveAdapter = new EdgecliffLiveAdapter();
