/**
 * Internal Sydney source-coverage matrix (admin/diagnostics — not developer UI).
 */

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

const ALL_LIVE_BASE: Record<CoverageCategory, CoverageStatus> = {
  CURRENT_PLANNING: "LIVE",
  PROPOSED_PLANNING: "PARTIAL",
  KEY_SITE_DETAIL: "PARTIAL",
  DCP_DETAIL: "NOT_YET_CONNECTED",
  DA: "NOT_YET_CONNECTED",
  HDA: "PARTIAL",
  SSD: "PARTIAL",
  SALES: "LIVE",
  MARKET: "PARTIAL",
};

/** Representative Greater Sydney LGAs — expand as adapters land. */
export const SYDNEY_COVERAGE_MATRIX: LgaCoverageRow[] = [
  {
    lga: "Inner West",
    region: "Inner",
    categories: {
      ...ALL_LIVE_BASE,
      PROPOSED_PLANNING: "LIVE",
      KEY_SITE_DETAIL: "LIVE",
    },
    notes: "Adopted planning layers + key sites enricher",
  },
  {
    lga: "Woollahra",
    region: "East",
    categories: {
      ...ALL_LIVE_BASE,
      PROPOSED_PLANNING: "LIVE",
      KEY_SITE_DETAIL: "LIVE",
    },
    notes: "Edgecliff corridor adapters (dataset, not product default)",
  },
  {
    lga: "Northern Beaches",
    region: "North",
    categories: { ...ALL_LIVE_BASE },
    notes: "Current EPI + sales; proposed via statewide PPR",
  },
  {
    lga: "North Sydney",
    region: "North",
    categories: { ...ALL_LIVE_BASE },
  },
  {
    lga: "Mosman",
    region: "North",
    categories: { ...ALL_LIVE_BASE },
  },
  {
    lga: "City of Sydney",
    region: "Inner",
    categories: { ...ALL_LIVE_BASE, SSD: "LIVE" },
  },
  {
    lga: "Bayside",
    region: "South",
    categories: { ...ALL_LIVE_BASE },
  },
  {
    lga: "Georges River",
    region: "South",
    categories: { ...ALL_LIVE_BASE },
  },
  {
    lga: "Canterbury-Bankstown",
    region: "South-west",
    categories: { ...ALL_LIVE_BASE },
  },
  {
    lga: "Parramatta",
    region: "West",
    categories: { ...ALL_LIVE_BASE, SSD: "LIVE", HDA: "LIVE" },
  },
  {
    lga: "Blacktown",
    region: "West",
    categories: { ...ALL_LIVE_BASE },
  },
  {
    lga: "Penrith",
    region: "West",
    categories: { ...ALL_LIVE_BASE },
  },
  {
    lga: "Sutherland Shire",
    region: "South",
    categories: { ...ALL_LIVE_BASE },
  },
  {
    lga: "Ryde",
    region: "North-west",
    categories: { ...ALL_LIVE_BASE },
  },
  {
    lga: "Willoughby",
    region: "North",
    categories: { ...ALL_LIVE_BASE },
  },
  {
    lga: "Canada Bay",
    region: "Inner west",
    categories: { ...ALL_LIVE_BASE },
  },
  {
    lga: "Burwood",
    region: "Inner west",
    categories: { ...ALL_LIVE_BASE },
  },
  {
    lga: "Strathfield",
    region: "Inner west",
    categories: { ...ALL_LIVE_BASE },
  },
  {
    lga: "Randwick",
    region: "East",
    categories: { ...ALL_LIVE_BASE },
  },
  {
    lga: "Waverley",
    region: "East",
    categories: { ...ALL_LIVE_BASE },
  },
  {
    lga: "Statewide / NSW",
    region: "NSW",
    categories: {
      CURRENT_PLANNING: "LIVE",
      PROPOSED_PLANNING: "PARTIAL",
      KEY_SITE_DETAIL: "PARTIAL",
      DCP_DETAIL: "NOT_YET_CONNECTED",
      DA: "NOT_YET_CONNECTED",
      HDA: "PARTIAL",
      SSD: "PARTIAL",
      SALES: "LIVE",
      MARKET: "PARTIAL",
    },
    notes: "EPI + PPR + HDA/SSD adapters; DA needs NSW_ONLINE_DA_SUBSCRIPTION_KEY",
  },
];

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
    for (const row of matrix) {
      summary[c][row.categories[c]]++;
    }
  }
  return { lgaCount: matrix.length, byCategory: summary, matrix };
}
