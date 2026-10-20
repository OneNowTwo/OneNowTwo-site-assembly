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
import { presentTodayStory, strategyAdjective, strategyDisplayName } from "./today-agent-copy";
import {
  buildStoryNavHrefs,
  controlsFromUnknown,
  isDocumentOnlyChange,
  isPlaceLikeLocation,
  resolveStoryLocation,
} from "./planning-update-detail";

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
  /** Evidence fields for detail panel — not card presentation copy. */
  evidence?: {
    planningChangeAreaId: string | null;
    keySiteIds: string[];
    awaitingVerification: boolean;
    evidenceSummary: string | null;
    evidenceWhyItMatters: string | null;
    previousControls: ReturnType<typeof controlsFromUnknown>;
    proposedControls: ReturnType<typeof controlsFromUnknown>;
    status: string | null;
    officialTitle: string | null;
  };
};

const STORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function locationFromEvent(e: RawIntelForStory): string | null {
  const payload = asRecord(e.payload) ?? asRecord(e.newValue) ?? {};
  for (const candidate of [
    typeof payload.lga === "string" ? payload.lga : null,
    typeof payload.suburb === "string" ? payload.suburb : null,
    Array.isArray(payload.lgas) && payload.lgas[0] ? String(payload.lgas[0]) : null,
    Array.isArray(payload.suburbs) && payload.suburbs[0] ? String(payload.suburbs[0]) : null,
  ]) {
    if (isPlaceLikeLocation(candidate)) return candidate;
  }
  const name = typeof payload.name === "string" ? payload.name : null;
  // Prefer leading place tokens from key-site names ("… key site Area L") when place-like.
  if (name) {
    const beforeKey = name.match(/^(.+?)\s+key\s+site\b/i)?.[1]?.trim();
    if (isPlaceLikeLocation(beforeKey)) return beforeKey!;
  }
  // Infer from title — never treat "Key site Area L" as a place/LGA.
  const m = (e.title ?? "").match(/^([A-Za-z ]+?)(?:\s[—-]|\sKey\s|\sPlanning|\sHDA|\sSSD)/);
  const inferred = m?.[1]?.trim() || null;
  return isPlaceLikeLocation(inferred) ? inferred : null;
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
  // Stable PCA ids look like "council:…" / "nsw:…" — never treat bare "Area L" as a PCA id.
  if (typeof payload.id === "string" && /^(council|nsw|nsw-ppr):/i.test(payload.id)) return payload.id;
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

function inferPcaFromKeySiteId(_keySiteId: string | null): string | null {
  // PCA is resolved at persist/read time via KeySite.planningChangeAreaId — do not hardcode places here.
  return null;
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

    const keySiteIds = [
      ...new Set(group.map((g) => keySiteIdFromEvent(g)).filter((id): id is string => !!id)),
    ];
    const pca =
      pcaIdFromEvent(head) ||
      group.map((g) => pcaIdFromEvent(g)).find(Boolean) ||
      inferPcaFromKeySiteId(keySiteIds[0] ?? null);
    const keySite = keySiteIds[0] ?? keySiteIdFromEvent(head);
    const placeLocation = resolveStoryLocation({
      locationLabel: location,
      title: head.title,
      summary: head.summary,
    });

    const nav = buildStoryNavHrefs({
      strategy: profile.strategy,
      planningChangeAreaId: pca,
      keySiteId: keySiteIds.length === 1 ? keySite : null,
      keySiteIds,
      locationLabel: placeLocation,
    });
    const mapHref =
      nav.mapHref ||
      (pca || keySite
        ? buildMapHref({
            planningChangeAreaId: pca,
            keySiteId: keySite,
          })
        : head.href?.startsWith("/map")
          ? head.href
          : null);

    const baseImportance = Math.max(...group.map((g) => g.importance ?? 0));
    const importance =
      baseImportance +
      strategyRelevance(profile, head.kind, placeLocation) +
      Math.min(3, group.length * 0.15) +
      (keySiteCount > 5 ? 1.5 : keySiteCount > 1 ? 0.75 : 0);

    const siteCount = affected || keySiteCount || group.length;
    const nv = asRecord(head.newValue);
    const ov = asRecord(head.oldValue);
    const proposedFromEvent = controlsFromUnknown(nv) ?? controlsFromUnknown(nv?.proposedControls);
    const previousFromEvent = controlsFromUnknown(ov) ?? controlsFromUnknown(ov?.proposedControls);
    const fsr = proposedFromEvent?.fsr ?? (nv && typeof nv.fsr === "number" ? nv.fsr : null);
    const headTitle = (head.title ?? head.kind).replace(/^SOURCE_DOCUMENT_CHANGED\s*—\s*/i, "");
    const headSummary = (head.summary ?? head.title ?? "")
      .replace(/NEEDS_RE_EXTRACTION|content hash|fixture-\S+/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    const awaitingVerification = group.some((g) =>
      isDocumentOnlyChange(g.kind, g.title ?? "", g.summary ?? null),
    );

    // Prefer structured plain-English presentation (never expose internal jargon).
    const presented = presentTodayStory(
      {
        type: sk,
        location: placeLocation,
        title: headTitle,
        whatChanged: fsr != null && !awaitingVerification ? `Proposed FSR now ${fsr}` : headSummary,
        whyItMatters: fsr != null && !awaitingVerification ? `Proposed FSR now ${fsr}` : null,
        affectedSites: siteCount || null,
      },
      profile.strategy,
    );
    let title = presented.title;
    let summary = presented.explanation;
    let whyItMatters = presented.explanation;

    if (fsr != null && !awaitingVerification && sk === "PLANNING_UPDATE") {
      title = placeLocation
        ? `${placeLocation} planning update — proposed FSR ${fsr}`
        : `Planning update — proposed FSR ${fsr}`;
      whyItMatters =
        siteCount > 0
          ? `Proposed FSR is now ${fsr}. ${siteCount} potential ${strategyAdjective(profile.strategy)} site${siteCount === 1 ? "" : "s"} may be affected.`
          : `Proposed FSR is now ${fsr}. Sites matching ${strategyDisplayName(profile.strategy)} nearby may be worth reviewing.`;
      summary = whyItMatters;
    }

    title = title.replace(/NEEDS_RE_EXTRACTION|SOURCE_DOCUMENT_CHANGED/gi, "").trim() || "Planning update";
    summary = summary.replace(/\s{2,}/g, " ").trim();
    whyItMatters = whyItMatters.replace(/\s{2,}/g, " ").trim();

    const evidenceSummary = awaitingVerification
      ? "A monitored planning source document changed. Specific control changes are awaiting verification."
      : proposedFromEvent
        ? headSummary
        : headSummary && !/key-site signals|change cluster|indexed assemblies/i.test(headSummary)
          ? headSummary
          : null;

    stories.push({
      id: `story:${key}`,
      kind: sk,
      title,
      summary,
      locationLabel: placeLocation,
      whatChanged: summary,
      whyItMatters,
      affectedSiteCount: affected || (keySiteCount || null),
      eventCount: group.length,
      date: (typeof head.createdAt === "string" ? head.createdAt : head.createdAt.toISOString()).slice(0, 10),
      importance,
      mapHref,
      findHref: nav.findHref,
      sourceHref: head.href && !head.href.startsWith("/map") ? head.href : null,
      sourceLabel: null,
      strategyTags: [profile.strategy],
      eventIds: group.map((g) => g.id),
      evidence: {
        planningChangeAreaId: pca,
        keySiteIds,
        awaitingVerification,
        evidenceSummary,
        evidenceWhyItMatters: awaitingVerification
          ? "Until controls are re-extracted and verified, treat this as a source refresh only — not a confirmed uplift."
          : whyItMatters,
        previousControls: previousFromEvent,
        proposedControls: awaitingVerification ? null : proposedFromEvent,
        status: typeof nv?.status === "string" ? nv.status : null,
        officialTitle: typeof nv?.name === "string" ? nv.name : headTitle,
      },
    });
  }

  stories.sort((a, b) => b.importance - a.importance);
  return stories.slice(0, maxStories);
}
