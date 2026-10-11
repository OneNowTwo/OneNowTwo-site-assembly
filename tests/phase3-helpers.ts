/**
 * Re-export Phase 3 symbols for tests without pulling DB barrels incorrectly.
 */

export {
  annotateParcelWithProposedFindFields,
  matchesProposedFindFilters,
} from "@/lib/source-watcher/find-fields";
export {
  findMatchReasons,
  whyProposedFsrUplift,
  theoreticalGfaIncreaseSqm,
} from "@/lib/source-watcher/why-it-matters";
export { parseNaturalLanguageFind } from "@/lib/find/nl-parse";
export {
  parseHdaPublishedRecordsHtml,
  diffHdaDocumentIndex,
  parseHdaProjectsFromText,
  extractPdfText,
} from "@/lib/source-watcher/adapters/nsw-hda-live";
export {
  parseMajorProjectsHtml,
  majorProjectsToDevelopmentActivities,
  parseMajorProjectDetail,
} from "@/lib/source-watcher/adapters/nsw-ssd-live";
export { normaliseOnlineDaRecord } from "@/lib/source-watcher/adapters/nsw-da-live";
export {
  classifyDaStatus,
  filterActivitiesNear,
} from "@/lib/source-watcher/development-activity";
export { profileForStrategy } from "@/lib/source-watcher/strategy-profile";

/** Mirrors primary nav in nav-links.tsx — keep in sync. */
export const PRIMARY_NAV_LABELS_FOR_TEST = ["Today", "Find", "Map", "Sites", "Pipeline"] as const;
