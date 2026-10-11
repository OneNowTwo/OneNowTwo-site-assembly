import type { FindFilters } from "./find-filters-types";

/** Parse a simple NL query into filter overlays (explicit filters still win). */
export function parseNaturalLanguageFind(q: string): Partial<FindFilters> {
  const out: Partial<FindFilters> = {};
  const lower = q.toLowerCase();
  const area = lower.match(/(?:over|above|>|min(?:imum)?)\s*(\d{2,5})\s*(?:sqm|m2|m²)/i);
  if (area) out.minSiteAreaSqm = parseInt(area[1]!, 10);
  const propFsr = lower.match(/proposed\s*fsr\s*(\d+(?:\.\d+)?)\s*\+?/i);
  if (propFsr) out.minProposedFsr = parseFloat(propFsr[1]!);
  const station = lower.match(/within\s*(\d{2,4})\s*m(?:etres?)?\s*(?:of\s*)?(?:a\s*)?station/i);
  if (station) out.maxStationDistanceM = parseInt(station[1]!, 10);
  if (/non[-\s]?strata|not strata|exclude strata/.test(lower)) out.excludeStrata = true;
  if (/key\s*site/.test(lower)) out.keySiteOnly = true;
  if (/inside\s*(?:proposed|planning)/.test(lower)) out.insidePlanningChangeArea = true;
  const place = q.match(/\bin\s+([A-Za-z][A-Za-z\s-]{2,40}?)(?:\s+inside|\s+within|\s+over|\s*$)/i);
  if (place) {
    const name = place[1]!.trim();
    if (name.length >= 3 && !/proposed|non|strata|sites?/i.test(name)) {
      out.suburb = name;
      out.centreQuery = name;
    }
  }
  return out;
}
