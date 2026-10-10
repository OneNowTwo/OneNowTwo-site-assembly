/**
 * LIVE NSW Online DA adapter.
 * Tries the public open-data endpoints; normalises into DevelopmentActivity.
 * Does not invent storeys/dwellings when the source omits them.
 */

import type { FetchResult, NormalisedSourcePayload, SourceAdapter } from "../types";
import { classifyDaStatus, type DevelopmentActivity } from "../development-activity";

const SOURCE_ID = "nsw-da-cdc-pcc";

/** Documented open-data endpoint (may move); eplanning v0 remains secondary probe. */
const OPEN_DATA_URL = "https://api.apps1.nsw.gov.au/planning/viewApplication/v3/OnlineDA";
const EPLANNING_URL = "https://api.apps1.nsw.gov.au/eplanning/data/v0/OnlineDA";

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
    o.Application ?? o.application ?? o.data ?? o.results ?? o.Applications ?? o.value ?? [];
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

async function tryOpenData(checkedAt: string): Promise<{
  activities: DevelopmentActivity[];
  endpoint: string | null;
  error: string | null;
}> {
  const to = new Date();
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - 14);
  const dateFrom = from.toISOString().slice(0, 10);
  const dateTo = to.toISOString().slice(0, 10);
  const payload = {
    filters: { LodgementDateFrom: dateFrom, LodgementDateTo: dateTo },
    filters_operator: "AND",
    page_size: 100,
    page_number: 1,
    sort: { field: "LodgementDate", direction: "DESC" },
  };

  try {
    const res = await fetch(OPEN_DATA_URL, {
      method: "POST",
      signal: AbortSignal.timeout(30000),
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "SiteAssembly/0.1 SourceWatcher",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) {
      return { activities: [], endpoint: OPEN_DATA_URL, error: `HTTP ${res.status}: ${text.slice(0, 160)}` };
    }
    const data = JSON.parse(text) as unknown;
    const activities = pickRecords(data)
      .map((r) => normaliseOnlineDaRecord(r, checkedAt))
      .filter((a): a is DevelopmentActivity => !!a);
    return { activities, endpoint: OPEN_DATA_URL, error: null };
  } catch (err) {
    return {
      activities: [],
      endpoint: OPEN_DATA_URL,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function probeEplanning(): Promise<{ reachable: boolean; message: string }> {
  try {
    const res = await fetch(EPLANNING_URL, {
      method: "GET",
      signal: AbortSignal.timeout(15000),
      headers: { Accept: "application/json", "User-Agent": "SiteAssembly/0.1 SourceWatcher" },
      cache: "no-store",
    });
    const text = await res.text();
    return {
      reachable: res.status === 400 || res.ok,
      message: `eplanning OnlineDA probe HTTP ${res.status}: ${text.slice(0, 120)}`,
    };
  } catch (err) {
    return { reachable: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export const daCdcPccLiveAdapter: SourceAdapter = {
  id: SOURCE_ID,
  async fetch(): Promise<FetchResult> {
    const checkedAt = new Date().toISOString();
    const open = await tryOpenData(checkedAt);
    const probe = open.activities.length ? null : await probeEplanning();

    const status = open.activities.length
      ? "LIVE"
      : open.error?.includes("404")
        ? "ENDPOINT_MOVED"
        : probe?.reachable
          ? "PROBE_ONLY"
          : "FAILED";

    const normalised: NormalisedSourcePayload = {
      kind: "da_cdc_pcc",
      checkedAt,
      records: open.activities.map((a) => ({ ...a, recordKind: "development_activity" })),
      meta: {
        status,
        openDataUrl: OPEN_DATA_URL,
        eplanningUrl: EPLANNING_URL,
        recordCount: open.activities.length,
        openDataError: open.error,
        eplanningProbe: probe?.message ?? null,
        note:
          status === "LIVE"
            ? "Online DA open-data feed connected."
            : "Open-data POST endpoint currently unavailable (404/param mismatch). Adapter remains live-ready; eplanning probe recorded. Nearby DA UI uses whatever records are returned.",
      },
    };

    return {
      raw: { status, recordCount: open.activities.length, openDataError: open.error, probe },
      normalised,
    };
  },
};
