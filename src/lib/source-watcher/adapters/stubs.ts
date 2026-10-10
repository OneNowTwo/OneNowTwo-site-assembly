import type { FetchResult, SourceAdapter } from "../types";

/** Placeholder adapters — registered in SourceRegistry, return empty normalised shells until live feeds are wired. */
function stubAdapter(id: string, kind: string, note: string): SourceAdapter {
  return {
    id,
    async fetch(): Promise<FetchResult> {
      const checkedAt = new Date().toISOString();
      return {
        raw: { status: "NOT_CONNECTED", note },
        normalised: {
          kind,
          checkedAt,
          records: [],
          meta: { status: "NOT_CONNECTED", note },
        },
      };
    },
  };
}

export const planningProposalRegisterAdapter = stubAdapter(
  "nsw-planning-proposal-register",
  "planning_proposal_register",
  "Portal register HTML/API not yet wired — use nsw-planning-proposal-agency ArcGIS layers for pending FSR/height.",
);

export const hdaAdapter = stubAdapter(
  "nsw-hda-records",
  "hda_records",
  "HDA briefing document watch pending — will emit HDA_RECORD_PUBLISHED / HDA_RECOMMENDATION_CHANGED.",
);

export const majorProjectsAdapter = stubAdapter(
  "nsw-major-projects",
  "major_projects",
  "Major Projects / SSD tracker feed pending.",
);

export const daCdcPccAdapter = stubAdapter(
  "nsw-da-cdc-pcc",
  "da_cdc_pcc",
  "NSW Online DA/CDC/PCC feeds pending — replaces development-activity stub when connected.",
);

/** Metadata-only registration for existing on-demand EPI/cadastre adapters (no bulk crawl yet). */
export function existingServiceAdapter(id: string, kind: string, note: string): SourceAdapter {
  return stubAdapter(id, kind, note);
}
