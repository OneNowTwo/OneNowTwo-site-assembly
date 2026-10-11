/**
 * IntelligenceStory aggregation — many low-level IntelChangeEvents → one Today story.
 */

import type { StrategyProfile } from "@/lib/source-watcher/strategy-profile";
import {
  eventDedupeFingerprint,
  isMaterialForToday,
  type MaterialEventInput,
} from "./material-change";
import { buildMapHref } from "@/lib/map/map-target";

export type RawIntelForStory = MaterialEventInput & {
  id: string;
  createdAt: Date | string;
  href?: string | null;
  geometry?: unknown;
  affectedParcelHints?: unknown;
  importance?: number | null;
  payload?: unknown;
};

export type IntelligenceStoryView = {
  id: string;
  kind: "PLANNING_UPDATE" | "KEY_SITE_PROGRAM" | "DEVELOPMENT_ACTIVITY" | "MARKET" | "OTHER";
  title: string;
  summary: string;
  locationLabel: string | null;
  whatChanged: string;
  whyItMatters: string;
  affectedSiteCount: number | null;
  eventCount: number;
  date: string;
  importance: number;
  mapHref: string | null;
  findHref: string | null;
  sourceHref: string | null;
  sourceLabel: string | null;
  strategyTags: string[];
  eventIds: string[];
};

const STORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function locationFromEvent(e: RawIntelForStory): string | null {
  const payload = asRecord(e.payload) ?? asRecord(e.newValue) ?? {};
  if (typeof payload.lga === "string") return payload.lga;
  if (typeof payload.suburb === "string") return payload.suburb;
  if (Array.isArray(payload.lgas) && payload.lgas[0]) return String(payload.lgas[0]);
  if (Array.isArray(payload.suburbs) && payload.suburbs[0]) return String(payload.suburbs[0]);
  // Infer from title e.g. "Inner West …"
  const m = (e.title ?? "").match(/^([A-Za-z ]+?)(?:\s[—-]|\sKey\s|\sPlanning|\sHDA|\sSSD)/);
  return m?.[1]?.trim() || null;
}

function storyKindFor(kind: string): IntelligenceStoryView["kind"] {
  if (/HDA|SSD|DA_|PCC_/i.test(kind)) return "DEVELOPMENT_ACTIVITY";
  if (/KEY_SITE|ASSEMBLY/i.test(kind)) return "KEY_SITE_PROGRAM";
  if (/PLANNING|ZONE|FSR|HEIGHT|DCP|AFFORDABLE/i.test(kind)) return "PLANNING_UPDATE";
  return "OTHER";
}

function groupKey(e: RawIntelForStory): string {
  const loc = (locationFromEvent(e) ?? "sydney").toLowerCase().replace(/\s+/g, "-");
  const sk = storyKindFor(e.kind);
  const source = e.sourceId ?? "unknown";
  // Collapse many key-site updates from same source+area into one story
  if (sk === "KEY_SITE_PROGRAM" || sk === "PLANNING_UPDATE") {
    return `${source}|${sk}|${loc}`;
  }
  return `${source}|${e.kind}|${eventDedupeFingerprint(e)}|${loc}`;
}

function strategyRelevance(profile: StrategyProfile, kind: string, location: string | null): number {
  let score = 0;
  if (profile.planningChangeInterest && /PLANNING|ZONE|FSR|HEIGHT|KEY_SITE|ASSEMBLY|AFFORDABLE|DCP/i.test(kind)) {
    score += 2;
  }
  if (profile.developmentActivityInterest && /HDA|SSD|DA_|PCC_/i.test(kind)) score += 2;
  if (profile.strategy === "APARTMENTS" && /FSR|HEIGHT|KEY_SITE|R3|R4|MU1/i.test(kind + (location ?? ""))) {
    score += 1.5;
  }
  if (profile.strategy === "TOWNHOUSES" && /R2|TOWN|LOW.?DENSITY/i.test(kind + (location ?? ""))) score += 1.5;
  if (profile.strategy === "CO_LIVING" && /STATION|TRANSPORT|SSD|HDA/i.test(kind + (location ?? ""))) score += 1.5;
  if (profile.targetLgas.length && location) {
    if (profile.targetLgas.some((l) => location.toLowerCase().includes(l.toLowerCase()))) score += 2;
  }
  if (profile.targetSuburbs.length && location) {
    if (profile.targetSuburbs.some((s) => location.toLowerCase().includes(s.toLowerCase()))) score += 2;
  }
  return score;
}

function pcaIdFromEvent(e: RawIntelForStory): string | null {
  const payload = asRecord(e.payload) ?? asRecord(e.newValue) ?? {};
  if (typeof payload.planningChangeAreaId === "string") return payload.planningChangeAreaId;
  if (typeof payload.id === "string" && !payload.id.includes(":")) return payload.id;
  const href = e.href ?? "";
  const m = href.match(/[?&]pca=([^&]+)/);
  return m ? decodeURIComponent(m[1]!) : null;
}

function keySiteIdFromEvent(e: RawIntelForStory): string | null {
  const payload = asRecord(e.payload) ?? asRecord(e.newValue) ?? {};
  if (typeof payload.externalKeySiteId === "string") return payload.externalKeySiteId;
  if (typeof payload.keySiteId === "string") return payload.keySiteId;
  const href = e.href ?? "";
  const m = href.match(/[?&]keySite=([^&]+)/);
  return m ? decodeURIComponent(m[1]!) : null;
}

/**
 * Aggregate material intel events into ranked IntelligenceStory views.
 * Dedupes identical source+kind+material-value within the window.
 */
export function aggregateIntelligenceStories(
  events: RawIntelForStory[],
  profile: StrategyProfile,
  opts?: { maxStories?: number; now?: Date },
): IntelligenceStoryView[] {
  const now = opts?.now ?? new Date();
  const maxStories = opts?.maxStories ?? 5;
  const cutoff = now.getTime() - STORY_WINDOW_MS;

  const material = events.filter((e) => {
    if (!isMaterialForToday(e)) return false;
    const t = typeof e.createdAt === "string" ? Date.parse(e.createdAt) : e.createdAt.getTime();
    return t >= cutoff;
  });

  // Fingerprint dedupe before grouping
  const seenFp = new Set<string>();
  const deduped: RawIntelForStory[] = [];
  for (const e of material) {
    const day = (typeof e.createdAt === "string" ? e.createdAt : e.createdAt.toISOString()).slice(0, 10);
    const fp = `${eventDedupeFingerprint(e)}|${day}`;
    if (seenFp.has(fp)) continue;
    seenFp.add(fp);
    deduped.push(e);
  }

  const groups = new Map<string, RawIntelForStory[]>();
  for (const e of deduped) {
    const key = groupKey(e);
    const list = groups.get(key) ?? [];
    list.push(e);
    groups.set(key, list);
  }

  const stories: IntelligenceStoryView[] = [];
  for (const [key, group] of groups) {
    group.sort((a, b) => {
      const ta = typeof a.createdAt === "string" ? Date.parse(a.createdAt) : a.createdAt.getTime();
      const tb = typeof b.createdAt === "string" ? Date.parse(b.createdAt) : b.createdAt.getTime();
      return tb - ta;
    });
    const head = group[0]!;
    const sk = storyKindFor(head.kind);
    const location = locationFromEvent(head);
    const keySiteCount = group.filter((g) => /KEY_SITE/i.test(g.kind)).length;
    const affected = group.reduce((n, g) => {
      const hints = g.affectedParcelHints;
      if (Array.isArray(hints)) return n + hints.length;
      return n;
    }, 0);

    const pca = pcaIdFromEvent(head);
    const keySite = keySiteIdFromEvent(head);
    const mapHref =
      pca || keySite
        ? buildMapHref({
            planningChangeAreaId: pca,
            keySiteId: keySite,
          })
        : head.href?.startsWith("/map")
          ? head.href
          : null;

    const findParams = new URLSearchParams();
    findParams.set("strategy", profile.strategy);
    if (location) findParams.set("lga", location);
    if (pca) findParams.set("pca", pca);

    const baseImportance = Math.max(...group.map((g) => g.importance ?? 0));
    const importance =
      baseImportance +
      strategyRelevance(profile, head.kind, location) +
      Math.min(3, group.length * 0.15) +
      (keySiteCount > 5 ? 1.5 : keySiteCount > 1 ? 0.75 : 0);

    let title: string;
    let summary: string;
    if (sk === "KEY_SITE_PROGRAM" && keySiteCount + group.length >= 3) {
      title = `${(location ?? "Sydney").toUpperCase()} KEY SITE UPDATE`;
      summary = `${group.length} key site / assembly signals across the planning program.`;
    } else if (sk === "PLANNING_UPDATE" && group.length >= 2) {
      title = `${(location ?? "Sydney").toUpperCase()} PLANNING UPDATE`;
      summary = `${group.length} material planning changes detected.`;
    } else {
      title = (head.title ?? head.kind).replace(/^SOURCE_DOCUMENT_CHANGED\s*—\s*/i, "");
      summary = head.summary ?? head.title ?? "";
    }

    // Strip engineering language from user-facing copy
    title = title.replace(/NEEDS_RE_EXTRACTION|SOURCE_DOCUMENT_CHANGED/gi, "").trim() || "Planning update";
    summary = summary
      .replace(/NEEDS_RE_EXTRACTION|content hash|fixture-\S+/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();

    const matchingHint =
      profile.strategy === "APARTMENTS"
        ? "Ranked for apartment density / FSR / height pathways."
        : profile.strategy === "TOWNHOUSES"
          ? "Ranked for lower-density / townhouse pathways."
          : profile.strategy === "CO_LIVING"
            ? "Ranked for transport-proximate co-living pathways."
            : "Relevant to your selected strategy.";

    stories.push({
      id: `story:${key}`,
      kind: sk,
      title,
      summary,
      locationLabel: location,
      whatChanged: summary,
      whyItMatters: matchingHint,
      affectedSiteCount: affected || (keySiteCount || null),
      eventCount: group.length,
      date: (typeof head.createdAt === "string" ? head.createdAt : head.createdAt.toISOString()).slice(0, 10),
      importance,
      mapHref,
      findHref: `/find?${findParams.toString()}`,
      sourceHref: head.href && !head.href.startsWith("/map") ? head.href : null,
      sourceLabel: null,
      strategyTags: [profile.strategy],
      eventIds: group.map((g) => g.id),
    });
  }

  stories.sort((a, b) => b.importance - a.importance);
  return stories.slice(0, maxStories);
}
