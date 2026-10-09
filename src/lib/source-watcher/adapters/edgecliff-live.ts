/**
 * Live Edgecliff–Woollahra state-led rezoning adapter.
 * Official portal page + structured map-pack controls (MANUALLY_STRUCTURED_FIXTURE geometry
 * until an official FeatureServer exposes the exhibition layers).
 * Never writes into PlanningSnapshot / current law.
 */

import type { FetchResult, NormalisedSourcePayload, SourceAdapter } from "../types";
import edgecliff from "../fixtures/edgecliff-woollahra.json";
import edgecliffBump from "../fixtures/edgecliff-woollahra-fsr-bump.json";

const PORTAL_URL =
  "https://www.planningportal.nsw.gov.au/ppr/under-exhibition/edgecliff-woollahra-precinct";

/** Test-only: when true, return FSR-bump structured pack with live metadata. */
let bumpVariant = false;

export function setEdgecliffLiveBumpVariant(on: boolean) {
  bumpVariant = on;
}

export function getEdgecliffLiveBumpVariant() {
  return bumpVariant;
}

async function fetchPortalMeta(): Promise<{
  ok: boolean;
  lastModified: string | null;
  etag: string | null;
  title: string | null;
  statusHint: string;
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
    const html = (await res.text()).slice(0, 20000);
    const titleMatch = html.match(/<title[^>]*>([^<]+)/i);
    const underExhibition = /under.?exhibition|public exhibition/i.test(html);
    return {
      ok: res.ok,
      lastModified,
      etag,
      title: titleMatch?.[1]?.trim() ?? null,
      statusHint: underExhibition ? "UNDER_EXHIBITION" : "PROPOSED",
    };
  } catch {
    return {
      ok: false,
      lastModified: null,
      etag: null,
      title: null,
      statusHint: "UNDER_EXHIBITION",
    };
  }
}

function applyLiveMeta(
  pack: NormalisedSourcePayload,
  portal: Awaited<ReturnType<typeof fetchPortalMeta>>,
): NormalisedSourcePayload {
  const checkedAt = new Date().toISOString();
  const areas = (pack.planningChangeAreas ?? []).map((area) => ({
    ...area,
    sourceUrl: PORTAL_URL,
    status: portal.statusHint === "UNDER_EXHIBITION" ? "UNDER_EXHIBITION" : area.status,
    proposedControls: {
      ...area.proposedControls,
      legalStatus: "UNDER_EXHIBITION" as const,
      machineReadable: true,
      notes: `${area.proposedControls.notes ?? ""} Live portal checked ${checkedAt}. Geometry source: MANUALLY_STRUCTURED_FIXTURE from official map pack until FeatureServer published.`.trim(),
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

  return {
    ...pack,
    checkedAt,
    planningChangeAreas: areas,
    meta: {
      ...pack.meta,
      livePortal: {
        url: PORTAL_URL,
        ok: portal.ok,
        lastModified: portal.lastModified,
        etag: portal.etag,
        title: portal.title,
      },
      geometrySource: "MANUALLY_STRUCTURED_FIXTURE",
      documentPack: "Edgecliff-Woollahra Proposed Maps (exhibition)",
      legalStatus: "UNDER_EXHIBITION",
      authority: "NSW DPHI",
    },
  };
}

export class EdgecliffLiveAdapter implements SourceAdapter {
  readonly id = "live-edgecliff-woollahra";

  async fetch(): Promise<FetchResult> {
    const portal = await fetchPortalMeta();
    const base = structuredClone(
      (bumpVariant ? edgecliffBump : edgecliff) as NormalisedSourcePayload,
    );
    const normalised = applyLiveMeta(base, portal);
    return {
      raw: {
        portal,
        documentPack: "Edgecliff-Woollahra Proposed Maps",
        geometrySource: "MANUALLY_STRUCTURED_FIXTURE",
      },
      normalised,
      sourceModifiedAt: portal.lastModified,
      etag: portal.etag,
    };
  }
}

export const edgecliffLiveAdapter = new EdgecliffLiveAdapter();
