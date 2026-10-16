/**
 * Today page user-facing copy — property-agent language only.
 * Internal terms (signal, change cluster, indexed, in scope, material change)
 * must never reach the UI.
 */

import {
  STRATEGY_LABELS,
  type DevelopmentStrategy,
} from "@/lib/source-watcher/strategy-profile";

const JARGON_RE =
  /\b(signals?|change cluster|indexed assemblies|indexed sites|in scope|related signals?|material change|material planning|key-site signals?|discovery ranking|canonical|proximity screen)\b/i;

export function strategyDisplayName(strategy: string): string {
  const key = strategy as DevelopmentStrategy;
  return STRATEGY_LABELS[key] ?? strategy.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export function strategyAdjective(strategy: string): string {
  const name = strategyDisplayName(strategy);
  // "Apartments" → "apartment"; "Co-living" stays; "Townhouses" → "townhouse"
  if (/s$/i.test(name) && !/living$/i.test(name)) return name.slice(0, -1).toLowerCase();
  return name.toLowerCase();
}

export function containsTodayJargon(text: string | null | undefined): boolean {
  return !!text && JARGON_RE.test(text);
}

/** Extract "Area L" / "Area 9" style labels from titles when present. */
export function extractAreaLabel(title: string | null | undefined): string | null {
  if (!title) return null;
  const m = title.match(/\bArea\s+([A-Z0-9]+)\b/i);
  return m ? `Area ${m[1]!.toUpperCase()}` : null;
}

/** Infer a place name from story title when locationLabel is missing. */
export function extractLocationFromTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  const iw = title.match(/\b(Inner West)\b/i);
  if (iw) return "Inner West";
  const edge = title.match(/\b(Edgecliff|Woollahra)\b/i);
  if (edge) return edge[1]!;
  const m = title.match(/^([A-Za-z][A-Za-z ]+?)(?:\s+KEY\s+SITE|\s+PLANNING|\s+key\s+site)/i);
  if (m) {
    const loc = m[1]!.trim();
    if (loc && !/^sydney$/i.test(loc) && loc.length < 40) return loc;
  }
  return null;
}

function isDevelopmentKind(kind: string): boolean {
  return /HDA|SSD|DA_|PCC_|DEVELOPMENT/i.test(kind);
}

function isDaKind(kind: string): boolean {
  // Lodged/approved DA / PCC — not HDA/SSD major-development pathways.
  return /DA_|PCC_/i.test(kind) && !/HDA|SSD/i.test(kind);
}

export function todayTypeLabel(kind: string, title?: string | null): string {
  const area = extractAreaLabel(title);
  // Named official key-site areas keep KEY SITE UPDATE; clustered KEY_SITE kinds become PLANNING UPDATE.
  if (area && /KEY_SITE|ASSEMBLY/i.test(kind)) return "KEY SITE UPDATE";
  if (isDaKind(kind)) return "DEVELOPMENT APPLICATION";
  if (/HDA|SSD|DEVELOPMENT/i.test(kind)) return "NEW DEVELOPMENT ACTIVITY";
  if (/PLANNING_PROPOSAL/i.test(kind)) return "PLANNING PROPOSAL";
  if (/ZONE/i.test(kind)) return "ZONING CHANGE";
  if (/FSR|HEIGHT/i.test(kind)) return "FSR / HEIGHT CHANGE";
  if (/KEY_SITE|ASSEMBLY|PLANNING|DCP|AFFORDABLE/i.test(kind)) return "PLANNING UPDATE";
  // Sales before market — never describe a sale as development activity.
  if (/NEW_SALE|\bSALE\b|_SALE/i.test(kind)) return "PROPERTY SALE";
  if (/MARKET/i.test(kind)) return "MARKET UPDATE";
  const cleaned = kind.replaceAll("_", " ").toUpperCase().trim();
  if (!cleaned || cleaned === "OTHER") return "PLANNING UPDATE";
  return cleaned;
}

export type TodayStoryPresentation = {
  typeLabel: string;
  title: string;
  explanation: string;
};

/**
 * Build plain-English story presentation for Today.
 * Prefer structured fields over any persisted jargon strings.
 */
export function presentTodayStory(
  story: {
    type: string;
    location: string | null;
    title: string;
    whatChanged?: string | null;
    whyItMatters?: string | null;
    affectedSites: number | null;
  },
  strategy: string,
): TodayStoryPresentation {
  const stratAdj = strategyAdjective(strategy);
  const stratName = strategyDisplayName(strategy);
  const rawLocation = story.location?.trim() || null;
  // Persisted stories sometimes store "Key site Area L" as locationLabel — not a place name.
  const locationLooksLikeArea = !!rawLocation && /^key\s*site\b/i.test(rawLocation);
  const area =
    extractAreaLabel(story.title) ??
    extractAreaLabel(story.whatChanged ?? "") ??
    (locationLooksLikeArea ? extractAreaLabel(rawLocation) : null);
  const location =
    (!locationLooksLikeArea ? rawLocation : null) ||
    extractLocationFromTitle(story.title) ||
    extractLocationFromTitle(story.whatChanged ?? "") ||
    null;
  const n = story.affectedSites != null && story.affectedSites > 0 ? story.affectedSites : null;
  const typeLabel = todayTypeLabel(story.type, story.title ?? (area ? area : null));

  // Detect whether we know a concrete control change (FSR) from copy — do not invent zoning/height.
  const fsrMatch =
    `${story.whyItMatters ?? ""} ${story.whatChanged ?? ""} ${story.title}`.match(
      /(?:proposed\s+)?fsr(?:\s+now)?\s*[:=]?\s*(\d+(?:\.\d+)?)/i,
    );
  const knownFsr = fsrMatch ? Number(fsrMatch[1]) : null;

  let title: string;
  let explanation: string;

  // Development kinds BEFORE generic planning / affectedSites branches — never call a DA/HDA a planning update.
  if (isDevelopmentKind(story.type)) {
    if (isDaKind(story.type)) {
      title = location ? `Development application near ${location}` : "Development application";
      explanation =
        "A nearby development application may affect competition, timing or local market evidence.";
    } else {
      title = location ? `Major development activity near ${location}` : "Major development activity";
      explanation =
        "New development activity nearby may affect competition, timing or the local development market.";
    }
    if (n != null && n > 0) {
      explanation = `${explanation} ${n} potential site${n === 1 ? "" : "s"} nearby may be affected.`;
    }
    return { typeLabel, title, explanation };
  }

  if (area && location) {
    title = `${location} planning update — ${area}`;
    if (n === 1) {
      explanation = `One potential ${stratAdj} site sits within the affected planning area and may be worth reviewing.`;
    } else if (n != null && n > 1) {
      explanation = `A planning update covers this area. ${n} potential ${stratAdj} sites may be affected.`;
    } else {
      explanation = `A planning update has been detected for ${area} in ${location}. Review nearby sites for ${stratName}.`;
    }
  } else if (area) {
    title = knownFsr != null ? `Planning update — ${area} (proposed FSR ${knownFsr})` : `Planning update detected — ${area}`;
    explanation =
      n != null
        ? `A new planning update has been detected for this area. ${n} potential ${stratAdj} site${n === 1 ? "" : "s"} may be affected.`
        : `A new planning update has been detected for this area. Sites nearby may be worth reviewing for ${stratName}.`;
  } else if (n != null && n >= 2) {
    title = `Planning update affects ${n} potential ${stratAdj} sites`;
    explanation = location
      ? `A recent planning update covers an area where Site Assembly has identified ${n} potential ${stratAdj} sites${location ? ` in ${location}` : ""}.`
      : `A recent planning update covers an area where Site Assembly has identified ${n} potential ${stratAdj} sites.`;
  } else if (n === 1) {
    title = location ? `${location} planning update` : "Planning update";
    explanation = `One potential ${stratAdj} site sits within the affected planning area and may be worth reviewing.`;
  } else {
    // Fall back to cleaned title if it is already human; otherwise generic.
    const rawTitle = (story.title ?? "").replace(/NEEDS_RE_EXTRACTION|SOURCE_DOCUMENT_CHANGED/gi, "").trim();
    title =
      rawTitle && !containsTodayJargon(rawTitle) && !/KEY SITE UPDATE$/i.test(rawTitle)
        ? rawTitle
        : location
          ? `${location} planning update`
          : "Planning update";
    explanation =
      story.whyItMatters && !containsTodayJargon(story.whyItMatters)
        ? story.whyItMatters
        : location
          ? `A planning update has been detected in ${location}. Sites matching ${stratName} may be worth reviewing.`
          : `A planning update has been detected. Sites matching ${stratName} may be worth reviewing.`;
  }

  return { typeLabel, title, explanation };
}

export function sitesWorthLookingSubheading(strategy: string): string {
  return `Potential development opportunities ranked for ${strategyDisplayName(strategy)}.`;
}

export function todayPageSubheading(): string {
  return "The best sites to investigate, planning changes that may create opportunities, and updates to sites you're watching.";
}

export function todayOrientationLine(): string {
  return "Site Assembly finds potential development sites, checks the planning, and helps you quickly decide which ones are worth investigating.";
}
