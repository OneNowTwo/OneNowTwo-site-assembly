/**
 * Development activity provider — generic DevelopmentActivity for Map / Site / Find / Today.
 * Backed by live Source Watcher adapters (DA / HDA / SSD) when available.
 */

import { filterActivitiesNear, type DevelopmentActivity } from "@/lib/source-watcher/development-activity";
import { runSourceOnce } from "@/lib/source-watcher/pipeline";

export type { DevelopmentActivity };

/** @deprecated Precinct-level stub shape — retained for radar compatibility. */
export interface DevelopmentActivitySummary {
  precinctId: string;
  status: "NOT_CONNECTED" | "LIVE" | "PARTIAL";
  message: string;
  daCount?: number | null;
  cdcCount?: number | null;
  retrievedAt: string | null;
}

export interface DevelopmentActivityProvider {
  name: string;
  getActivityForPrecinct(precinctId: string): Promise<DevelopmentActivitySummary>;
  getNearby?(point: { lng: number; lat: number }, radiusM?: number): Promise<DevelopmentActivity[]>;
}

export type DaFeedStatus = "LIVE" | "AUTH_REQUIRED" | "ENDPOINT_MOVED" | "FAILED" | "EMPTY" | "PARTIAL" | "UNKNOWN";

export interface DevelopmentActivityBundle {
  activities: DevelopmentActivity[];
  messages: string[];
  /** Online DA APIM status — AUTH_REQUIRED until NSW_ONLINE_DA_SUBSCRIPTION_KEY is set. */
  daStatus: DaFeedStatus;
  /** HDA / SSD statuses from adapter meta (for UI honesty). */
  sourceStatus: Record<string, DaFeedStatus>;
}

let cachedBundle: {
  at: number;
  activities: DevelopmentActivity[];
  messages: string[];
  daStatus: DaFeedStatus;
  sourceStatus: Record<string, DaFeedStatus>;
} | null = null;
const CACHE_TTL_MS = 15 * 60 * 1000;

function recordsToActivities(sourceId: string, records: Array<Record<string, unknown>> | undefined, checkedAt: string): DevelopmentActivity[] {
  if (!records?.length) return [];
  const out: DevelopmentActivity[] = [];
  for (const r of records) {
    if (r.recordKind && r.recordKind !== "development_activity") continue;
    if (!r.type && !r.externalId) continue;
    const type = (r.type as DevelopmentActivity["type"] | undefined) ?? (sourceId.includes("hda") ? "HDA" : sourceId.includes("major") ? "SSD" : "DA");
    if (!["DA", "HDA", "SSD", "CDC", "PCC", "OTHER"].includes(type)) continue;
    const externalId = String(r.externalId ?? r.id ?? "");
    if (!externalId) continue;
    out.push({
      id: String(r.id ?? `${sourceId}:${externalId}`),
      sourceId,
      externalId,
      type,
      status: (r.status as DevelopmentActivity["status"]) ?? "OTHER",
      address: (r.address as string | null) ?? null,
      suburb: (r.suburb as string | null) ?? null,
      lga: (r.lga as string | null) ?? null,
      geometry: (r.geometry as DevelopmentActivity["geometry"]) ?? null,
      developmentType: (r.developmentType as string | null) ?? null,
      description: (r.description as string | null) ?? null,
      dwellings: typeof r.dwellings === "number" ? r.dwellings : null,
      storeys: typeof r.storeys === "number" ? r.storeys : null,
      estimatedCost: typeof r.estimatedCost === "number" ? r.estimatedCost : null,
      lodgedAt: (r.lodgedAt as string | null) ?? null,
      determinedAt: (r.determinedAt as string | null) ?? null,
      sourceUrl: (r.sourceUrl as string | null) ?? null,
      checkedAt,
      recommendation: (r.recommendation as string | null) ?? null,
    });
  }
  return out;
}

export async function loadDevelopmentActivityBundle(opts?: { force?: boolean }): Promise<DevelopmentActivityBundle> {
  if (!opts?.force && cachedBundle && Date.now() - cachedBundle.at < CACHE_TTL_MS) {
    return {
      activities: cachedBundle.activities,
      messages: cachedBundle.messages,
      daStatus: cachedBundle.daStatus,
      sourceStatus: cachedBundle.sourceStatus,
    };
  }
  const messages: string[] = [];
  const activities: DevelopmentActivity[] = [];
  const sourceStatus: Record<string, DaFeedStatus> = {};
  for (const sourceId of ["nsw-da-cdc-pcc", "nsw-hda-records", "nsw-major-projects"] as const) {
    try {
      const result = await runSourceOnce(sourceId, null);
      if (result.normalised) {
        const checkedAt = result.normalised.checkedAt;
        activities.push(...recordsToActivities(sourceId, result.normalised.records as Array<Record<string, unknown>>, checkedAt));
        const meta = result.normalised.meta as { status?: string; note?: string } | undefined;
        const status = (meta?.status as DaFeedStatus | undefined) ?? (result.normalised.records?.length ? "LIVE" : "EMPTY");
        sourceStatus[sourceId] = status;
        if (meta?.status && meta.status !== "LIVE") {
          messages.push(`${sourceId}: ${meta.status}${meta.note ? ` — ${meta.note}` : ""}`);
        }
      } else if (result.error) {
        sourceStatus[sourceId] = "FAILED";
        messages.push(`${sourceId}: ${result.error}`);
      } else {
        sourceStatus[sourceId] = "UNKNOWN";
      }
    } catch (err) {
      sourceStatus[sourceId] = "FAILED";
      messages.push(`${sourceId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const daStatus = sourceStatus["nsw-da-cdc-pcc"] ?? "UNKNOWN";
  cachedBundle = { at: Date.now(), activities, messages, daStatus, sourceStatus };
  return { activities, messages, daStatus, sourceStatus };
}

export function clearDevelopmentActivityCache() {
  cachedBundle = null;
}

export class LiveDevelopmentActivityProvider implements DevelopmentActivityProvider {
  readonly name = "NSW development activity (DA / HDA / SSD)";

  async getActivityForPrecinct(precinctId: string): Promise<DevelopmentActivitySummary> {
    const bundle = await loadDevelopmentActivityBundle();
    const withGeom = bundle.activities.filter((a) => a.geometry);
    const status: DevelopmentActivitySummary["status"] = withGeom.length
      ? "LIVE"
      : bundle.activities.length
        ? "PARTIAL"
        : "NOT_CONNECTED";
    return {
      precinctId,
      status,
      message:
        status === "LIVE"
          ? `${withGeom.length} geocoded development activity records loaded.`
          : status === "PARTIAL"
            ? `${bundle.activities.length} activity records loaded (limited coordinates). ${bundle.messages[0] ?? ""}`
            : bundle.messages[0] ?? "DEVELOPMENT ACTIVITY DATA NOT CONNECTED",
      daCount: bundle.activities.filter((a) => a.type === "DA").length,
      cdcCount: null,
      retrievedAt: new Date().toISOString(),
    };
  }

  async getNearby(point: { lng: number; lat: number }, radiusM = 500): Promise<DevelopmentActivity[]> {
    const bundle = await loadDevelopmentActivityBundle();
    // When Online DA is AUTH_REQUIRED, still return HDA/SSD with geometry — never pretend DA is live.
    const usable =
      bundle.daStatus === "AUTH_REQUIRED"
        ? bundle.activities.filter((a) => a.type !== "DA" && a.type !== "CDC" && a.type !== "PCC")
        : bundle.activities;
    return filterActivitiesNear(usable, point, radiusM);
  }
}

export class StubDevelopmentActivityProvider implements DevelopmentActivityProvider {
  readonly name = "NSW Planning Portal Online DA Data API (not connected)";

  async getActivityForPrecinct(precinctId: string): Promise<DevelopmentActivitySummary> {
    return {
      precinctId,
      status: "NOT_CONNECTED",
      message: "DEVELOPMENT ACTIVITY DATA NOT CONNECTED — DA/CDC volume will feed an opportunity/competition index once wired.",
      daCount: null,
      cdcCount: null,
      retrievedAt: null,
    };
  }
}

export const developmentActivityProvider: DevelopmentActivityProvider = new LiveDevelopmentActivityProvider();
