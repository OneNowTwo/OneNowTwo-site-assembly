/**
 * LIVE statewide NSW Planning Proposal Register adapter.
 * Uses official Planning Proposal Agency ArcGIS layers (machine-readable statewide).
 * Portal HTML register remains a secondary index when available.
 * Proposed ≠ current law.
 */

import { buildUrl, fetchJson } from "@/lib/data-sources/http";
import type { EsriQueryResponse } from "@/lib/data-sources/esri";
import { NSW_PLANNING_PROPOSAL_BASE } from "@/lib/data-sources/nsw-planning-proposals";
import type { FetchResult, NormalisedSourcePayload, PlanningChangeAreaFact, SourceAdapter } from "../types";

const SOURCE_ID = "nsw-planning-proposal-register";
const PORTAL_URL = "https://www.planningportal.nsw.gov.au/";
const LAYERS = { fsr: 3013, height: 3020, zone: 3029 } as const;

/** Sample envelopes across Greater Sydney + regional NSW for statewide crawl. */
const SAMPLE_ENVELOPES = [
  // Sydney metro
  "150.6,-34.1,151.4,-33.5",
  // Illawarra
  "150.6,-34.6,151.1,-34.2",
  // Newcastle / Hunter
  "151.4,-33.1,151.9,-32.7",
  // Central Coast
  "151.2,-33.55,151.55,-33.2",
  // Western Sydney
  "150.6,-34.0,151.0,-33.6",
];

type Attrs = Record<string, string | number | null | undefined>;

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function mapStage(statusId: number | null, versionStatus: string | null): string {
  if (versionStatus && /withdrawn/i.test(versionStatus)) return "WITHDRAWN";
  if (versionStatus && /finalis|made|gazett/i.test(versionStatus)) return "FINALISATION";
  if (statusId === 207) return "WITHDRAWN";
  // Observed agency status ids are sparse — keep a readable statewide stage label.
  if (versionStatus && /exhibit/i.test(versionStatus)) return "UNDER_EXHIBITION";
  if (versionStatus && /gateway|pre.?exhibit/i.test(versionStatus)) return "PRE-EXHIBITION";
  if (versionStatus && /post.?exhibit/i.test(versionStatus)) return "POST-EXHIBITION";
  if (versionStatus && /assess/i.test(versionStatus)) return "UNDER_ASSESSMENT";
  return "UNDER_ASSESSMENT";
}

async function queryLayer(layerId: number, envelope: string): Promise<Attrs[]> {
  const url = buildUrl(`${NSW_PLANNING_PROPOSAL_BASE}/${layerId}/query`, {
    where: "PP_CLOSED=0 AND PLANNING_PROPOSAL_NO IS NOT NULL",
    geometry: envelope,
    geometryType: "esriGeometryEnvelope",
    inSR: 4283,
    spatialRel: "esriSpatialRelIntersects",
    outFields:
      "PLANNING_PROPOSAL_NO,PLANNING_PROPOSAL_STATUS_ID,PP_DATA_VERSION_STATUS,EPI_NAME,LGA_NAME,FSR,MAX_B_H,MAX_B_H_M,SYM_CODE,LAY_CLASS,AMENDMENT",
    returnGeometry: false,
    resultRecordCount: 500,
    f: "json",
  });
  try {
    const res = await fetchJson<EsriQueryResponse<Attrs>>(url, {
      service: "NSW Planning Proposal Register live",
      timeoutMs: 25000,
      ttlMs: 10 * 60 * 1000,
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

function upsert(map: Map<string, Agg>, attrs: Attrs): void {
  const ppNo = str(attrs.PLANNING_PROPOSAL_NO);
  if (!ppNo || /test/i.test(ppNo)) return;
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
  }
  const f = num(attrs.FSR);
  if (f != null) row.fsrs.push(f);
  const h = num(attrs.MAX_B_H_M) ?? num(attrs.MAX_B_H);
  if (h != null) row.heights.push(h);
  const z = str(attrs.SYM_CODE) ?? str(attrs.LAY_CLASS);
  if (z) row.zones.push(z);
}

function toArea(agg: Agg): PlanningChangeAreaFact {
  const fsrs = [...new Set(agg.fsrs)].sort((a, b) => a - b);
  const heights = [...new Set(agg.heights)].sort((a, b) => a - b);
  const zones = [...new Set(agg.zones)];
  const stage = mapStage(agg.statusId, agg.versionStatus);
  const lga = agg.lga && agg.lga !== "LEP" ? agg.lga : null;
  return {
    id: `nsw-ppr:${agg.ppNo}`,
    title: `${agg.ppNo}${lga ? ` — ${lga}` : ""}${agg.amendment ? ` (${agg.amendment})` : ""}`,
    status: stage,
    authority: lga ? `${lga} / NSW DPHI` : "NSW DPHI",
    lgas: lga ? [lga] : [],
    suburbs: [],
    sourceUrl: PORTAL_URL,
    proposedControls: {
      legalStatus: stage === "UNDER_EXHIBITION" ? "UNDER_EXHIBITION" : "PROPOSED",
      zone: zones.length === 1 ? zones[0]! : null,
      fsr: fsrs.length === 1 ? fsrs[0]! : null,
      heightM: heights.length === 1 ? heights[0]! : null,
      notes:
        "Statewide Planning Proposal Agency layers — PROPOSED / pending only, not current LEP law. Confirm against Planning Portal documents.",
      machineReadable: fsrs.length === 1 || heights.length === 1 || zones.length === 1,
    },
  };
}

export const planningProposalRegisterLiveAdapter: SourceAdapter = {
  id: SOURCE_ID,
  async fetch(): Promise<FetchResult> {
    const checkedAt = new Date().toISOString();
    const byPp = new Map<string, Agg>();
    let layerHits = 0;
    for (const envelope of SAMPLE_ENVELOPES) {
      const [fsrRows, heightRows, zoneRows] = await Promise.all([
        queryLayer(LAYERS.fsr, envelope),
        queryLayer(LAYERS.height, envelope),
        queryLayer(LAYERS.zone, envelope),
      ]);
      layerHits += fsrRows.length + heightRows.length + zoneRows.length;
      for (const a of [...fsrRows, ...heightRows, ...zoneRows]) upsert(byPp, a);
    }

    const planningChangeAreas = [...byPp.values()].map(toArea).sort((a, b) => a.title.localeCompare(b.title));
    const records = planningChangeAreas.map((a) => ({
      proposalNumber: a.id.replace(/^nsw-ppr:/, ""),
      name: a.title,
      lga: a.lgas?.[0] ?? null,
      status: a.status,
      gateway: null,
      exhibition: a.status === "UNDER_EXHIBITION" ? a.status : null,
      finalisation: a.status === "FINALISATION" ? a.status : null,
      sourceUrl: a.sourceUrl,
      proposedZone: a.proposedControls.zone ?? null,
      proposedFsr: a.proposedControls.fsr ?? null,
      proposedHeight: a.proposedControls.heightM ?? null,
    }));

    const normalised: NormalisedSourcePayload = {
      kind: "planning_proposal_register",
      checkedAt,
      planningChangeAreas,
      records,
      meta: {
        status: planningChangeAreas.length ? "LIVE" : layerHits === 0 ? "EMPTY" : "LIVE",
        transport: "ARCGIS",
        service: NSW_PLANNING_PROPOSAL_BASE,
        proposalCount: planningChangeAreas.length,
        layerAttributeHits: layerHits,
        note: "Statewide Agency PP layers — geometry association via on-demand point query / PCA persistence.",
      },
    };

    return { raw: { proposalCount: planningChangeAreas.length, layerHits }, normalised };
  },
};
