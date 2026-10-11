/**
 * LIVE NSW Online DA adapter.
 *
 * Official documented feed: NSW Planning Portal Online DA Data API
 * (data.nsw.gov.au package online-da-data-api / dictionary v2.0).
 *
 * Current public gateway:
 *   GET https://api.apps1.nsw.gov.au/eplanning/data/v1/OnlineDA
 *   requires Ocp-Apim-Subscription-Key (env NSW_ONLINE_DA_SUBSCRIPTION_KEY)
 *
 * Legacy v0 probe remains for diagnostics. Filter schema follows the
 * official DA Open APIs data dictionary (CouncilName / ApplicationType /
 * ApplicationStatus / LodgementDate* / pagination).
 */

import type { FetchResult, NormalisedSourcePayload, SourceAdapter } from "../types";
import { classifyDaStatus, type DevelopmentActivity } from "../development-activity";

const SOURCE_ID = "nsw-da-cdc-pcc";

/** Current APIM Online DA endpoint (subscription key required). */
const APIM_V1_URL =
  process.env.NSW_ONLINE_DA_URL ?? "https://api.apps1.nsw.gov.au/eplanning/data/v1/OnlineDA";
/** Legacy open probe — returns 400 without a complete filter set. */
const EPLANNING_V0_URL = "https://api.apps1.nsw.gov.au/eplanning/data/v0/OnlineDA";
/** Retired Phase-3 POST URL (404 Resource not found). */
const RETIRED_V3_URL = "https://api.apps1.nsw.gov.au/planning/viewApplication/v3/OnlineDA";

type RawDa = Record<string, unknown>;

function asNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function asStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function pickRecords(data: unknown): RawDa[] {
  if (!data || typeof data !== "object") return [];
  const o = data as Record<string, unknown>;
  const list =
    o.Application ?? o.application ?? o.data ?? o.results ?? o.Applications ?? o.value ?? o.Items ?? [];
  return Array.isArray(list) ? (list as RawDa[]) : [];
}

export function normaliseOnlineDaRecord(record: RawDa, checkedAt: string): DevelopmentActivity | null {
  const externalId =
    asStr(record.PlanningPortalApplicationNumber) ??
    asStr(record.ApplicationNumber) ??
    asStr(record.CouncilApplicationNumber) ??
    asStr(record.applicationId);
  if (!externalId) return null;

  const locations = record.Location ?? record.Locations ?? record.location;
  const loc = Array.isArray(locations) ? (locations[0] as RawDa | undefined) : (locations as RawDa | undefined);
  const lng = asNum(loc?.X) ?? asNum(loc?.Longitude) ?? asNum(record.X) ?? asNum(record.Longitude);
  const lat = asNum(loc?.Y) ?? asNum(loc?.Latitude) ?? asNum(record.Y) ?? asNum(record.Latitude);
  const address =
    asStr(loc?.FullAddress) ??
    asStr(record.FullAddress) ??
    asStr(record.Address) ??
    ([asStr(loc?.StreetNumber1), asStr(loc?.StreetName), asStr(loc?.StreetType), asStr(loc?.Suburb)]
      .filter(Boolean)
      .join(" ") ||
      null);

  const statusRaw = asStr(record.ApplicationStatus) ?? asStr(record.Status);
  const dwellings = asNum(record.NumberOfNewDwellings) ?? asNum(record.NumberOfDwellings);
  const storeys = asNum(record.NumberOfStoreys);
  const cost = asNum(record.CostofDevelopment) ?? asNum(record.CostOfDevelopment);

  return {
    id: `${SOURCE_ID}:${externalId}`,
    sourceId: SOURCE_ID,
    externalId,
    type: "DA",
    status: classifyDaStatus(statusRaw),
    address,
    suburb: asStr(loc?.Suburb) ?? asStr(record.Suburb),
    lga: asStr(record.CouncilName) ?? asStr(record.LGA),
    geometry: lng != null && lat != null ? { type: "Point", coordinates: [lng, lat] } : null,
    developmentType: asStr(record.DevelopmentType) ?? asStr(record.DevelopmentCategory),
    description: asStr(record.DevelopmentType) ?? asStr(record.ApplicationType),
    dwellings,
    storeys,
    estimatedCost: cost,
    lodgedAt: asStr(record.LodgementDate) ?? asStr(record.SubmissionDate),
    determinedAt: asStr(record.DeterminationDate),
    sourceUrl: `https://www.planningportal.nsw.gov.au/`,
    checkedAt,
  };
}

function lodgementWindow(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - 14);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

/** Build query string per Online DA dictionary (filter fields + pagination). */
function buildOnlineDaQuery(pageNumber: number, pageSize: number): string {
  const { from, to } = lodgementWindow();
  const params = new URLSearchParams();
  // Dictionary marks ApplicationType / ApplicationStatus / CouncilName as filterable arrays.
  params.append("ApplicationType", "Development Application");
  params.append("ApplicationStatus", "Under Assessment");
  params.append("ApplicationStatus", "On Exhibition");
  params.append("ApplicationStatus", "Determined");
  params.append("LodgementDateFrom", from);
  params.append("LodgementDateTo", to);
  params.set("PageNumber", String(pageNumber));
  params.set("PageSize", String(pageSize));
  return params.toString();
}

async function fetchOnlineDaGet(
  baseUrl: string,
  headers: Record<string, string>,
  checkedAt: string,
): Promise<{ activities: DevelopmentActivity[]; error: string | null; httpStatus: number | null }> {
  const qs = buildOnlineDaQuery(1, 100);
  try {
    const res = await fetch(`${baseUrl}?${qs}`, {
      method: "GET",
      signal: AbortSignal.timeout(30000),
      headers: {
        Accept: "application/json",
        "User-Agent": "SiteAssembly/0.1 SourceWatcher",
        ...headers,
      },
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        activities: [],
        error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
        httpStatus: res.status,
      };
    }
    const data = JSON.parse(text) as unknown;
    const activities = pickRecords(data)
      .map((r) => normaliseOnlineDaRecord(r, checkedAt))
      .filter((a): a is DevelopmentActivity => !!a);
    return { activities, error: null, httpStatus: res.status };
  } catch (err) {
    return {
      activities: [],
      error: err instanceof Error ? err.message : String(err),
      httpStatus: null,
    };
  }
}

async function fetchOnlineDaPostJson(
  baseUrl: string,
  headers: Record<string, string>,
  checkedAt: string,
): Promise<{ activities: DevelopmentActivity[]; error: string | null; httpStatus: number | null }> {
  const { from, to } = lodgementWindow();
  const payload = {
    filters: {
      ApplicationType: "Development Application",
      ApplicationStatus: ["Under Assessment", "On Exhibition", "Determined", "Withdrawn", "Rejected"],
      LodgementDateFrom: from,
      LodgementDateTo: to,
    },
    filters_operator: "AND",
    page_size: 100,
    page_number: 1,
    sort: { field: "LodgementDate", direction: "DESC" },
  };
  try {
    const res = await fetch(baseUrl, {
      method: "POST",
      signal: AbortSignal.timeout(30000),
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "SiteAssembly/0.1 SourceWatcher",
        ...headers,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        activities: [],
        error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
        httpStatus: res.status,
      };
    }
    const data = JSON.parse(text) as unknown;
    const activities = pickRecords(data)
      .map((r) => normaliseOnlineDaRecord(r, checkedAt))
      .filter((a): a is DevelopmentActivity => !!a);
    return { activities, error: null, httpStatus: res.status };
  } catch (err) {
    return {
      activities: [],
      error: err instanceof Error ? err.message : String(err),
      httpStatus: null,
    };
  }
}

export const daCdcPccLiveAdapter: SourceAdapter = {
  id: SOURCE_ID,
  async fetch(): Promise<FetchResult> {
    const checkedAt = new Date().toISOString();
    const key = process.env.NSW_ONLINE_DA_SUBSCRIPTION_KEY?.trim() || "";
    const authHeaders: Record<string, string> = key ? { "Ocp-Apim-Subscription-Key": key } : {};

    let activities: DevelopmentActivity[] = [];
    let endpoint: string | null = null;
    let error: string | null = null;
    let httpStatus: number | null = null;

    // 1) Current official APIM v1 GET (subscription key).
    if (key) {
      const v1 = await fetchOnlineDaGet(APIM_V1_URL, authHeaders, checkedAt);
      activities = v1.activities;
      endpoint = APIM_V1_URL;
      error = v1.error;
      httpStatus = v1.httpStatus;
      if (!activities.length) {
        const v1post = await fetchOnlineDaPostJson(APIM_V1_URL, authHeaders, checkedAt);
        if (v1post.activities.length) {
          activities = v1post.activities;
          error = null;
          httpStatus = v1post.httpStatus;
        } else if (!error) {
          error = v1post.error;
          httpStatus = v1post.httpStatus;
        }
      }
    } else {
      error = "NSW_ONLINE_DA_SUBSCRIPTION_KEY not configured — Online DA APIM requires a subscription key (data.broker@environment.nsw.gov.au).";
    }

    // 2) Legacy v0 diagnostic probe (no key) — document filter contract readiness.
    let v0Probe: string | null = null;
    if (!activities.length) {
      const v0 = await fetchOnlineDaGet(EPLANNING_V0_URL, {}, checkedAt);
      v0Probe = v0.error ?? (v0.activities.length ? `LIVE ${v0.activities.length}` : "EMPTY");
      if (v0.activities.length) {
        activities = v0.activities;
        endpoint = EPLANNING_V0_URL;
        error = null;
        httpStatus = v0.httpStatus;
      }
    }

    const withGeom = activities.filter((a) => a.geometry).length;
    const status = activities.length
      ? "LIVE"
      : !key
        ? "AUTH_REQUIRED"
        : httpStatus === 401
          ? "AUTH_REQUIRED"
          : httpStatus === 404
            ? "ENDPOINT_MOVED"
            : error
              ? "FAILED"
              : "EMPTY";

    const normalised: NormalisedSourcePayload = {
      kind: "da_cdc_pcc",
      checkedAt,
      records: activities.map((a) => ({ ...a, recordKind: "development_activity" })),
      meta: {
        status,
        openDataPackage: "https://www.data.nsw.gov.au/data/dataset/online-da-data-api",
        dictionaryPdf:
          "https://www.planningportal.nsw.gov.au/opendata/dataset/88c61ad1-7096-45ae-b1ac-94963e4cfca1/resource/95279ab6-b115-4300-bb21-30461dae3985/download/online-da-api-v2.0.pdf",
        apimV1Url: APIM_V1_URL,
        eplanningV0Url: EPLANNING_V0_URL,
        retiredV3Url: RETIRED_V3_URL,
        endpointUsed: endpoint,
        recordCount: activities.length,
        recordsWithGeometry: withGeom,
        openDataError: error,
        v0Probe,
        subscriptionKeyConfigured: !!key,
        note:
          status === "LIVE"
            ? "Online DA feed connected via official APIM/filter schema."
            : status === "AUTH_REQUIRED"
              ? "Official Online DA API is behind APIM subscription. Set NSW_ONLINE_DA_SUBSCRIPTION_KEY (request via data.broker@environment.nsw.gov.au). Filter schema implemented from DA Open APIs dictionary v2.0."
              : "Online DA connection attempted against current documented endpoints; see openDataError.",
      },
    };

    return {
      raw: {
        status,
        recordCount: activities.length,
        recordsWithGeometry: withGeom,
        openDataError: error,
        v0Probe,
      },
      normalised,
    };
  },
};
