/**
 * Complete Greater Sydney source-coverage matrix — every LGA in the selected market.
 * Statuses reflect actual source capability (not optimistic labels).
 */

import { GREATER_SYDNEY_LGAS } from "./greater-sydney-lgas";

export type CoverageStatus = "LIVE" | "PARTIAL" | "NOT_YET_CONNECTED";

export type CoverageCategory =
  | "CURRENT_PLANNING"
  | "PROPOSED_PLANNING"
  | "KEY_SITE_DETAIL"
  | "DCP_DETAIL"
  | "DA"
  | "HDA"
  | "SSD"
  | "SALES"
  | "MARKET";

export type LgaCoverageRow = {
  lga: string;
  region: string;
  categories: Record<CoverageCategory, CoverageStatus>;
  notes?: string;
};

/** Statewide layers available everywhere; richer proposed/key-site only where adapters exist. */
function baseCategories(opts?: {
  proposed?: CoverageStatus;
  keySite?: CoverageStatus;
  hda?: CoverageStatus;
  ssd?: CoverageStatus;
}): Record<CoverageCategory, CoverageStatus> {
  return {
    CURRENT_PLANNING: "LIVE", // NSW EPI statewide
    PROPOSED_PLANNING: opts?.proposed ?? "PARTIAL", // statewide PPR partial geometry
    KEY_SITE_DETAIL: opts?.keySite ?? "PARTIAL",
    DCP_DETAIL: "NOT_YET_CONNECTED",
    DA: "NOT_YET_CONNECTED", // needs NSW_ONLINE_DA_SUBSCRIPTION_KEY
    HDA: opts?.hda ?? "PARTIAL",
    SSD: opts?.ssd ?? "PARTIAL",
    SALES: "LIVE", // NSW registered sales
    MARKET: "PARTIAL",
  };
}

const RICH_PROPOSED = new Set(["Inner West", "Woollahra"]);

export const SYDNEY_COVERAGE_MATRIX: LgaCoverageRow[] = GREATER_SYDNEY_LGAS.map((lga) => {
  const rich = RICH_PROPOSED.has(lga.name);
  return {
    lga: lga.name,
    region: lga.region,
    categories: baseCategories({
      proposed: rich ? "LIVE" : "PARTIAL",
      keySite: rich ? "LIVE" : "PARTIAL",
      hda: lga.region === "Central River City" || lga.name === "City of Sydney" ? "LIVE" : "PARTIAL",
      ssd: lga.name === "City of Sydney" || lga.name === "Parramatta" ? "LIVE" : "PARTIAL",
    }),
    notes: rich
      ? "Council/state adapter provides richer proposed controls / key sites"
      : "Current EPI + sales LIVE; proposed via statewide PPR (partial); DA not connected without API key",
  };
});

export function coverageSummary(matrix: LgaCoverageRow[] = SYDNEY_COVERAGE_MATRIX) {
  const cats: CoverageCategory[] = [
    "CURRENT_PLANNING",
    "PROPOSED_PLANNING",
    "KEY_SITE_DETAIL",
    "DCP_DETAIL",
    "DA",
    "HDA",
    "SSD",
    "SALES",
    "MARKET",
  ];
  const summary: Record<CoverageCategory, Record<CoverageStatus, number>> = {} as never;
  for (const c of cats) {
    summary[c] = { LIVE: 0, PARTIAL: 0, NOT_YET_CONNECTED: 0 };
    for (const row of matrix) summary[c][row.categories[c]]++;
  }
  return { lgaCount: matrix.length, byCategory: summary, matrix };
}
