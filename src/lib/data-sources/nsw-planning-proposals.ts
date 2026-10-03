import type { PlanningChangeRecord, PlanningRuleStatus } from "@/lib/planning/types";
import { buildUrl, fetchJson } from "./http";
import type { EsriQueryResponse } from "./esri";

/**
 * NSW ePlanning — Planning Proposal Agency MapServer (statewide).
 * Public sibling service currently has empty layers; Agency is queryable without auth
 * and carries PLANNING_PROPOSAL_NO + proposed FSR/height/zone attributes.
 *
 * These features are PROPOSED / pending only — never CURRENT development rights.
 */
export const NSW_PLANNING_PROPOSAL_BASE =
  process.env.NSW_PLANNING_PROPOSAL_URL ??
  "https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Proposal_Agency/MapServer";

const LAYERS = {
  fsr: 3013,
  height: 3020,
  zone: 3029,
} as const;

const SOURCE_URL = "https://www.planningportal.nsw.gov.au/";
const SOURCE_AUTHORITY = "NSW Planning Portal — Planning Proposal layers";

type Attrs = Record<string, string | number | null | undefined>;

/** Known NSW PP status ids observed on the Agency service. Unknown Active → PROPOSED. */
function mapStatus(statusId: number | null, versionStatus: string | null): PlanningRuleStatus | null {
  if (versionStatus && /superseded|withdrawn|closed/i.test(versionStatus)) return "SUPERSEDED";
  if (statusId === 207) return "SUPERSEDED";
  if (statusId === 205 || statusId === 206) return "PROPOSED";
  if (statusId == null) return "PROPOSED";
  return "PROPOSED";
}

function isTestProposal(ppNo: string | null | undefined): boolean {
  if (!ppNo) return true;
  return /test/i.test(ppNo);
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

async function queryLayer(
  layerId: number,
  envelope: string,
  outFields: string,
): Promise<Attrs[]> {
  const url = buildUrl(`${NSW_PLANNING_PROPOSAL_BASE}/${layerId}/query`, {
    where: "PP_CLOSED=0 AND PLANNING_PROPOSAL_NO IS NOT NULL",
    geometry: envelope,
    geometryType: "esriGeometryEnvelope",
    // Service extent uses GDA94 (4283); 4326 envelopes often 400.
    inSR: 4283,
    spatialRel: "esriSpatialRelIntersects",
    outFields,
    returnGeometry: false,
    resultRecordCount: 200,
    f: "json",
  });
  try {
    const res = await fetchJson<EsriQueryResponse<Attrs>>(url, {
      service: "NSW Planning Proposal layers",
      timeoutMs: 20000,
      ttlMs: 15 * 60 * 1000,
    });
    return (res.features ?? []).map((f) => f.attributes ?? {});
  } catch {
    return [];
  }
}

interface Agg {
  ppNo: string;
  statusId: number | null;
  versionStatus: string | null;
  lga: string | null;
  epiName: string | null;
  amendment: string | null;
  fsrs: number[];
  heights: number[];
  zones: string[];
}

function upsert(map: Map<string, Agg>, attrs: Attrs, kind: "fsr" | "height" | "zone"): void {
  const ppNo = str(attrs.PLANNING_PROPOSAL_NO);
  if (!ppNo || isTestProposal(ppNo)) return;
  let row = map.get(ppNo);
  if (!row) {
    row = {
      ppNo,
      statusId: num(attrs.PLANNING_PROPOSAL_STATUS_ID),
      versionStatus: str(attrs.PP_DATA_VERSION_STATUS),
      lga: str(attrs.LGA_NAME),
      epiName: str(attrs.EPI_NAME),
      amendment: str(attrs.AMENDMENT),
      fsrs: [],
      heights: [],
      zones: [],
    };
    map.set(ppNo, row);
  } else {
    if (row.statusId == null) row.statusId = num(attrs.PLANNING_PROPOSAL_STATUS_ID);
    if (!row.versionStatus) row.versionStatus = str(attrs.PP_DATA_VERSION_STATUS);
    if (!row.lga) row.lga = str(attrs.LGA_NAME);
    if (!row.epiName) row.epiName = str(attrs.EPI_NAME);
    if (!row.amendment) row.amendment = str(attrs.AMENDMENT);
  }
  if (kind === "fsr") {
    const f = num(attrs.FSR);
    if (f != null) row.fsrs.push(f);
  } else if (kind === "height") {
    const h = num(attrs.MAX_B_H_M) ?? num(attrs.MAX_B_H);
    if (h != null) row.heights.push(h);
  } else {
    const z = str(attrs.SYM_CODE) ?? str(attrs.LAY_CLASS);
    if (z) row.zones.push(z);
  }
}

function uniqSorted(nums: number[]): number[] {
  return [...new Set(nums.map((n) => Math.round(n * 1000) / 1000))].sort((a, b) => a - b);
}

function toRecord(agg: Agg, now: string): PlanningChangeRecord | null {
  const status = mapStatus(agg.statusId, agg.versionStatus);
  if (!status || status === "SUPERSEDED" || status === "WITHDRAWN" || status === "CURRENT") return null;

  const fsrs = uniqSorted(agg.fsrs);
  const heights = uniqSorted(agg.heights);
  const zones = [...new Set(agg.zones)];
  const singleFsr = fsrs.length === 1 ? fsrs[0]! : null;
  const singleHeight = heights.length === 1 ? heights[0]! : null;
  const singleZone = zones.length === 1 ? zones[0]! : null;
  const machineReadable = singleFsr != null || singleHeight != null || singleZone != null;

  const controlBits: string[] = [];
  if (fsrs.length) controlBits.push(fsrs.length === 1 ? `FSR ${fsrs[0]}:1` : `FSR range ${fsrs[0]}–${fsrs[fsrs.length - 1]}:1`);
  if (heights.length)
    controlBits.push(heights.length === 1 ? `height ${heights[0]} m` : `height range ${heights[0]}–${heights[heights.length - 1]} m`);
  if (zones.length) controlBits.push(zones.length === 1 ? `zone ${zones[0]}` : `zones ${zones.slice(0, 4).join(", ")}${zones.length > 4 ? "…" : ""}`);

  const lgaLabel = agg.lga && agg.lga !== "LEP" ? agg.lga : null;
  const title = `${agg.ppNo}${lgaLabel ? ` — ${lgaLabel}` : ""}${agg.amendment ? ` (${agg.amendment})` : ""}`;

  return {
    id: `nsw:pp-layer:${agg.ppNo}`,
    title,
    description:
      `Planning proposal ${agg.ppNo} intersects this location on the NSW Planning Proposal spatial layers` +
      (agg.epiName ? ` (${agg.epiName})` : "") +
      `. NOT current development rights.` +
      (controlBits.length ? ` Mapped proposed controls at this site: ${controlBits.join("; ")}.` : " Proposed numerical controls incomplete at this point."),
    status,
    instrumentName: agg.epiName ?? `Planning proposal ${agg.ppNo}`,
    planningProposalNumber: agg.ppNo,
    authority: lgaLabel ? `${lgaLabel} / NSW DPHI` : "NSW DPHI",
    sourceUrl: SOURCE_URL,
    sourceAuthority: SOURCE_AUTHORITY,
    announcementDate: null,
    effectiveDate: null,
    lastChecked: now,
    lgas: lgaLabel ? [lgaLabel] : [],
    proposedControls: {
      machineReadable,
      fsr: singleFsr,
      heightM: singleHeight,
      zone: singleZone,
      notes: machineReadable
        ? "Proposed controls from official PP spatial layers at this location — NOT CURRENT LAW. Confirm against Planning Portal documents before acquisition."
        : "PROPOSED CONTROL NOT FULLY MACHINE-READABLE at this point — inspect Planning Portal documents. NOT CURRENT LAW.",
    },
    timeline: [{ date: now.slice(0, 10), label: "Matched via NSW Planning Proposal Agency layers (Active, not closed)" }],
  };
}

/**
 * Query statewide NSW planning-proposal layers around a WGS84 point.
 * Returns PROPOSED/pending records only (never CURRENT).
 */
export async function fetchPlanningProposalsNear(input: {
  lng: number;
  lat: number;
  /** Degrees pad around the point (default ~250 m). */
  padDeg?: number;
}): Promise<PlanningChangeRecord[]> {
  const pad = input.padDeg ?? 0.0025;
  const envelope = `${input.lng - pad},${input.lat - pad},${input.lng + pad},${input.lat + pad}`;
  const now = new Date().toISOString();

  const [fsrRows, heightRows, zoneRows] = await Promise.all([
    queryLayer(LAYERS.fsr, envelope, "PLANNING_PROPOSAL_NO,PLANNING_PROPOSAL_STATUS_ID,PP_DATA_VERSION_STATUS,EPI_NAME,LGA_NAME,FSR,AMENDMENT"),
    queryLayer(
      LAYERS.height,
      envelope,
      "PLANNING_PROPOSAL_NO,PLANNING_PROPOSAL_STATUS_ID,PP_DATA_VERSION_STATUS,EPI_NAME,LGA_NAME,MAX_B_H,MAX_B_H_M,AMENDMENT",
    ),
    queryLayer(
      LAYERS.zone,
      envelope,
      "PLANNING_PROPOSAL_NO,PLANNING_PROPOSAL_STATUS_ID,PP_DATA_VERSION_STATUS,EPI_NAME,LGA_NAME,SYM_CODE,LAY_CLASS,AMENDMENT",
    ),
  ]);

  const byPp = new Map<string, Agg>();
  for (const a of fsrRows) upsert(byPp, a, "fsr");
  for (const a of heightRows) upsert(byPp, a, "height");
  for (const a of zoneRows) upsert(byPp, a, "zone");

  const out: PlanningChangeRecord[] = [];
  for (const agg of byPp.values()) {
    const rec = toRecord(agg, now);
    if (rec) out.push(rec);
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}
