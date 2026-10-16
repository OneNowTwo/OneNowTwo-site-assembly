/**
 * Planning-update detail evidence for Today cards.
 * Card list copy may stay generic; detail must use stored evidence only —
 * never invent control changes from titles or site counts.
 */

import { extractAreaLabel, extractLocationFromTitle } from "./today-agent-copy";

export type PlanningControlSnapshot = {
  zone?: string | null;
  fsr?: number | null;
  heightM?: number | null;
  affordableHousingContributionPct?: number | null;
  notes?: string | null;
};

export type ScreeningSampleEvidence = {
  lng: number;
  lat: number;
  zone?: string | null;
  fsr?: number | null;
  heightM?: number | null;
  mixedAcrossKeySite: boolean;
  distinctZones?: string[];
  distinctFsrs?: number[];
  distinctHeights?: number[];
  scope: "INTERIOR_POINT_SAMPLE";
};

export type PlanningUpdateEvidence = {
  /** Official / source document title when known. */
  officialTitle: string | null;
  locationLabel: string | null;
  areaLabel: string | null;
  status: string | null;
  /** True when we only know a source document refreshed — not a confirmed control change. */
  awaitingVerification: boolean;
  plainSummary: string | null;
  previousControls: PlanningControlSnapshot | null;
  proposedControls: PlanningControlSnapshot | null;
  /** Interior-point screening sample — limited scope; not parcel-level evidence. */
  screeningSample: ScreeningSampleEvidence | null;
  /** Official publication / exhibition / effective date (ISO), not detection time. */
  officialDate: string | null;
  officialDateLabel: string | null;
  /** When Site Assembly detected / last updated the story (ISO). */
  detectedAt: string | null;
  whyItMatters: string | null;
  sourceName: string | null;
  documentTitle: string | null;
  documentSection: string | null;
  sourceUrl: string | null;
  webpageUrl: string | null;
  planningChangeAreaId: string | null;
  keySiteIds: string[];
  affectedCandidateIds: string[];
  affectedParcelIds: string[];
};

export type PlanningUpdateDetailView = PlanningUpdateEvidence & {
  id: string;
  cardTitle: string;
  cardExplanation: string;
  typeLabel: string;
  affectedSites: number | null;
  mapHref: string | null;
  findHref: string | null;
};

const AREA_AS_PLACE_RE = /^key\s*site\b/i;
const ENGINEERING_RE =
  /SOURCE_DOCUMENT_CHANGED|NEEDS_RE_EXTRACTION|SOURCE_REFRESHED|content hash|parser|snapshot|fixture|structured map-pack|canonical sync|bodyHash|documentHash/i;

export function isPlaceLikeLocation(label: string | null | undefined): boolean {
  if (!label?.trim()) return false;
  const t = label.trim();
  if (AREA_AS_PLACE_RE.test(t)) return false;
  if (/^Area\s+[A-Z0-9]+$/i.test(t)) return false;
  if (/^sydney$/i.test(t)) return false;
  return t.length >= 2 && t.length < 60;
}

/** Reject area labels (Area L / Key site Area M) being used as LGA filters. */
export function isValidLgaFilter(label: string | null | undefined): boolean {
  return isPlaceLikeLocation(label) && !/\bArea\s+[A-Z0-9]+\b/i.test(label ?? "");
}

export function cleanEvidenceText(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(ENGINEERING_RE, "").replace(/\s{2,}/g, " ").trim();
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function numOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** True when a control snapshot has zone / FSR / height / AH — notes alone are not enough. */
export function hasStructuredControls(c: PlanningControlSnapshot | null | undefined): boolean {
  if (!c) return false;
  return c.zone != null || c.fsr != null || c.heightM != null || c.affordableHousingContributionPct != null;
}

export function controlsFromUnknown(v: unknown): PlanningControlSnapshot | null {
  const r = asRecord(v);
  if (!r) return null;
  const nested = asRecord(r.proposedControls) ?? asRecord(r.incentiveControls) ?? r;
  const zone = typeof nested.zone === "string" ? nested.zone : typeof nested.proposedZone === "string" ? nested.proposedZone : null;
  const fsr =
    numOrNull(nested.fsr) ??
    numOrNull(nested.incentiveFsr) ??
    numOrNull(nested.proposedFsr);
  const heightM =
    numOrNull(nested.heightM) ??
    numOrNull(nested.incentiveHeightM) ??
    numOrNull(nested.proposedHeight);
  const ah = numOrNull(nested.affordableHousingContributionPct);
  const notes = typeof nested.notes === "string" ? nested.notes : null;
  // Notes-only is not structured evidence — callers treat as awaiting verification.
  if (zone == null && fsr == null && heightM == null && ah == null) return null;
  return { zone, fsr, heightM, affordableHousingContributionPct: ah, notes };
}

export function screeningSampleFromUnknown(v: unknown): ScreeningSampleEvidence | null {
  const r = asRecord(v);
  if (!r) return null;
  const nested = asRecord(r.proposedControls) ?? r;
  const sample = asRecord(nested.screeningSample);
  if (!sample) return null;
  const lng = numOrNull(sample.lng);
  const lat = numOrNull(sample.lat);
  if (lng == null || lat == null) return null;
  return {
    lng,
    lat,
    zone: typeof sample.zone === "string" ? sample.zone : null,
    fsr: numOrNull(sample.fsr),
    heightM: numOrNull(sample.heightM),
    mixedAcrossKeySite: sample.mixedAcrossKeySite === true,
    distinctZones: Array.isArray(sample.distinctZones) ? sample.distinctZones.map(String) : [],
    distinctFsrs: Array.isArray(sample.distinctFsrs)
      ? sample.distinctFsrs.map((n) => Number(n)).filter((n) => Number.isFinite(n))
      : [],
    distinctHeights: Array.isArray(sample.distinctHeights)
      ? sample.distinctHeights.map((n) => Number(n)).filter((n) => Number.isFinite(n))
      : [],
    scope: "INTERIOR_POINT_SAMPLE",
  };
}

export function isDocumentOnlyChange(kind: string, title: string, summary: string | null): boolean {
  if (/SOURCE_DOCUMENT_CHANGED|SOURCE_REFRESHED/i.test(kind)) return true;
  if (/SOURCE_DOCUMENT_CHANGED|NEEDS_RE_EXTRACTION/i.test(title)) return true;
  if (summary && /NEEDS_RE_EXTRACTION|document hash|portal page changed/i.test(summary)) return true;
  return false;
}

export function resolveStoryLocation(input: {
  locationLabel?: string | null;
  title?: string | null;
  summary?: string | null;
  pcaLgas?: string[] | null;
}): string | null {
  const fromPca = input.pcaLgas?.find((l) => isPlaceLikeLocation(l));
  if (fromPca) {
    // Title-case LGA tokens from PCA (e.g. "INNER WEST" → "Inner West").
    return fromPca
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  if (isPlaceLikeLocation(input.locationLabel)) return input.locationLabel!.trim();
  return (
    extractLocationFromTitle(input.title) ||
    extractLocationFromTitle(input.summary) ||
    null
  );
}

export function buildStoryNavHrefs(input: {
  strategy: string;
  planningChangeAreaId?: string | null;
  keySiteId?: string | null;
  keySiteIds?: string[];
  locationLabel?: string | null;
  affectedCandidateIds?: string[];
}): { mapHref: string | null; findHref: string } {
  const findParams = new URLSearchParams();
  findParams.set("strategy", input.strategy);

  const pca = input.planningChangeAreaId?.trim() || null;
  const keySite =
    input.keySiteId?.trim() ||
    (input.keySiteIds?.length === 1 ? input.keySiteIds[0]! : null) ||
    null;
  const candidates = (input.affectedCandidateIds ?? []).filter(Boolean);

  if (pca) {
    findParams.set("pca", pca);
    findParams.set("insidePlanningChangeArea", "1");
  }
  if (keySite) findParams.set("keySite", keySite);
  if (input.keySiteIds && input.keySiteIds.length > 1) {
    findParams.set("keySites", input.keySiteIds.slice(0, 40).join(","));
  }
  if (candidates.length) {
    findParams.set("candidateIds", candidates.slice(0, 50).join(","));
  }
  if (isValidLgaFilter(input.locationLabel)) {
    findParams.set("lga", input.locationLabel!);
  }

  const mapParams = new URLSearchParams();
  if (pca) mapParams.set("pca", pca);
  if (keySite) mapParams.set("keySite", keySite);
  const mapHref = mapParams.toString() ? `/map?${mapParams.toString()}` : null;

  return { mapHref, findHref: `/find?${findParams.toString()}` };
}

/**
 * Build evidence for a Today planning update from persisted payload + linked PCA/key-site facts.
 * Does not invent FSR/zone/height from titles.
 */
export function buildPlanningUpdateEvidence(input: {
  storyTitle: string;
  storySummary?: string | null;
  locationLabel?: string | null;
  detectedAt?: string | null;
  payload?: Record<string, unknown> | null;
  eventKinds?: string[];
  eventTitles?: string[];
  eventSummaries?: string[];
  oldControls?: unknown;
  newControls?: unknown;
  pca?: {
    id: string;
    title: string;
    status: string;
    lgas?: string[];
    sourceUrl?: string | null;
    exhibitionEnd?: string | Date | null;
    proposedControls?: unknown;
  } | null;
  keySites?: Array<{
    externalKeySiteId: string;
    name: string;
    proposedControls?: unknown;
    currentControls?: unknown;
    sourceUrl?: string | null;
  }>;
  sourceName?: string | null;
  sourceUrl?: string | null;
  affectedCandidateIds?: string[];
  affectedParcelIds?: string[];
}): PlanningUpdateEvidence {
  const payload = input.payload ?? {};
  const areaFromKeySite = input.keySites?.[0]?.externalKeySiteId?.match(/^Area\s+/i)
    ? input.keySites[0]!.externalKeySiteId
    : extractAreaLabel(input.keySites?.[0]?.name ?? "");
  const areaLabel =
    extractAreaLabel(input.storyTitle) ||
    extractAreaLabel(String(payload.areaLabel ?? "")) ||
    areaFromKeySite ||
    null;

  const locationLabel = resolveStoryLocation({
    locationLabel: (typeof payload.locationLabel === "string" ? payload.locationLabel : null) ?? input.locationLabel,
    title: input.storyTitle,
    summary: input.storySummary,
    pcaLgas: input.pca?.lgas,
  });

  const kinds = input.eventKinds ?? [];
  const titles = input.eventTitles ?? [input.storyTitle];
  const summaries = input.eventSummaries ?? [input.storySummary ?? ""];

  const previousControls =
    controlsFromUnknown(payload.previousControls) ??
    controlsFromUnknown(input.oldControls) ??
    controlsFromUnknown(input.keySites?.[0]?.currentControls);

  const screeningSample =
    screeningSampleFromUnknown(payload.proposedControls) ??
    screeningSampleFromUnknown(input.keySites?.[0]?.proposedControls) ??
    screeningSampleFromUnknown(input.newControls);

  const proposedFromEvidence =
    controlsFromUnknown(payload.proposedControls) ??
    controlsFromUnknown(input.newControls) ??
    controlsFromUnknown(input.keySites?.[0]?.proposedControls) ??
    controlsFromUnknown(input.pca?.proposedControls);

  const documentOnly =
    (typeof payload.awaitingVerification === "boolean" && payload.awaitingVerification) ||
    kinds.some((k, i) => isDocumentOnlyChange(k, titles[i] ?? "", summaries[i] ?? null)) ||
    (/SOURCE_DOCUMENT|NEEDS_RE_EXTRACTION/i.test(input.storyTitle) && !hasStructuredControls(proposedFromEvidence));

  // Mixed key-site controls / missing structured controls = not a confirmed uniform change.
  const mixedKeySite = screeningSample?.mixedAcrossKeySite === true;
  const awaitingVerification =
    documentOnly || mixedKeySite || !hasStructuredControls(proposedFromEvidence);

  // Never present mixed point samples as uniform proposed controls.
  const proposedControls =
    awaitingVerification && !mixedKeySite ? null : mixedKeySite ? null : proposedFromEvidence;

  const officialTitle =
    (typeof payload.officialTitle === "string" ? payload.officialTitle : null) ||
    input.pca?.title ||
    input.keySites?.[0]?.name ||
    cleanEvidenceText(input.storyTitle) ||
    null;

  const status =
    (typeof payload.status === "string" ? payload.status : null) ||
    input.pca?.status ||
    null;

  let plainSummary: string | null =
    (typeof payload.evidenceSummary === "string" ? cleanEvidenceText(payload.evidenceSummary) : null) ||
    null;
  if (!plainSummary) {
    if (mixedKeySite && screeningSample) {
      const sampleBits = [
        screeningSample.zone ? `zone ${screeningSample.zone}` : null,
        screeningSample.fsr != null ? `FSR ${screeningSample.fsr}` : null,
        screeningSample.heightM != null ? `height ${screeningSample.heightM} m` : null,
      ].filter(Boolean);
      plainSummary = `Mixed proposed controls across ${areaLabel ?? "this key site"} (not uniform). Interior-point screening sample only (${sampleBits.join(", ") || "no hit"}) — not parcel-level evidence and not an area-wide control change.`;
    } else if (awaitingVerification) {
      plainSummary = documentOnly
        ? "Source updated — change details awaiting verification. A monitored planning source document changed; this is not confirmed as a zoning, FSR or height control change."
        : "Source updated — change details awaiting verification. Structured proposed controls have not been confirmed for this area yet.";
    } else if (proposedControls && hasStructuredControls(proposedControls)) {
      const bits: string[] = [];
      if (previousControls?.fsr != null || proposedControls.fsr != null) {
        bits.push(
          `FSR ${previousControls?.fsr != null ? previousControls.fsr : "not recorded"} → ${proposedControls.fsr != null ? proposedControls.fsr : "not recorded"}`,
        );
      }
      if (previousControls?.heightM != null || proposedControls.heightM != null) {
        bits.push(
          `height ${previousControls?.heightM != null ? `${previousControls.heightM} m` : "not recorded"} → ${proposedControls.heightM != null ? `${proposedControls.heightM} m` : "not recorded"}`,
        );
      }
      if (previousControls?.zone || proposedControls.zone) {
        bits.push(
          `zoning ${previousControls?.zone ?? "not recorded"} → ${proposedControls.zone ?? "not recorded"}`,
        );
      }
      const where = [locationLabel, areaLabel].filter(Boolean).join(" · ");
      const scopeNote = screeningSample
        ? " Interior-point screening sample verified uniform across intersecting control polygons — not parcel-level evidence."
        : "";
      plainSummary = bits.length
        ? `Proposed controls for ${where || "this area"}: ${bits.join("; ")}. These are proposed controls from the official planning program — not current LEP law.${scopeNote}`
        : cleanEvidenceText(input.storySummary) || null;
    } else {
      const raw = cleanEvidenceText(input.storySummary);
      plainSummary =
        raw && !/key-site signals|change cluster|indexed assemblies/i.test(raw)
          ? raw
          : officialTitle
            ? `${officialTitle}${status ? ` (${status.replaceAll("_", " ").toLowerCase()})` : ""}.`
            : null;
    }
  }

  const exhibition =
    input.pca?.exhibitionEnd != null
      ? typeof input.pca.exhibitionEnd === "string"
        ? input.pca.exhibitionEnd
        : input.pca.exhibitionEnd.toISOString()
      : typeof payload.officialDate === "string"
        ? payload.officialDate
        : null;

  const keySiteIds = [
    ...new Set(
      [
        ...(Array.isArray(payload.keySiteIds) ? payload.keySiteIds.map(String) : []),
        ...(input.keySites?.map((k) => k.externalKeySiteId) ?? []),
      ].filter(Boolean),
    ),
  ];

  const whyStored = typeof payload.evidenceWhyItMatters === "string" ? cleanEvidenceText(payload.evidenceWhyItMatters) : null;

  return {
    officialTitle,
    locationLabel,
    areaLabel,
    status,
    awaitingVerification,
    plainSummary,
    previousControls,
    proposedControls,
    screeningSample,
    officialDate: exhibition,
    officialDateLabel: exhibition ? "Exhibition / official date" : null,
    detectedAt: input.detectedAt ?? (typeof payload.detectedAt === "string" ? payload.detectedAt : null),
    whyItMatters:
      whyStored ||
      (mixedKeySite
        ? `${areaLabel ?? "This key site"} has mixed proposed control polygons — do not assume a single FSR/zone/height across the area. Use the interior-point screening sample for screening only.`
        : awaitingVerification
          ? "Until proposed controls are verified from the official source, treat this as a source refresh only — not a confirmed uplift."
          : proposedControls && hasStructuredControls(proposedControls)
            ? [
                areaLabel ? `${areaLabel} is a monitored key site` : "This is a monitored planning change area",
                locationLabel ? `in ${locationLabel}` : null,
                proposedControls.fsr != null ? `with proposed FSR ${proposedControls.fsr}` : null,
                proposedControls.heightM != null ? `and height ${proposedControls.heightM} m` : null,
                proposedControls.zone ? `(zone ${proposedControls.zone})` : null,
                screeningSample ? "— interior-point sample, proposed only until gazetted." : "— proposed only until gazetted.",
              ]
                .filter(Boolean)
                .join(" ")
                .replace(/\s+/g, " ")
                .trim()
            : null),
    sourceName: input.sourceName ?? (typeof payload.sourceLabel === "string" ? payload.sourceLabel : null),
    documentTitle: officialTitle,
    documentSection: typeof payload.documentSection === "string" ? payload.documentSection : null,
    sourceUrl: input.sourceUrl ?? input.pca?.sourceUrl ?? input.keySites?.[0]?.sourceUrl ?? null,
    webpageUrl: input.sourceUrl ?? input.pca?.sourceUrl ?? null,
    planningChangeAreaId: input.pca?.id ?? (typeof payload.planningChangeAreaId === "string" ? payload.planningChangeAreaId : null),
    keySiteIds,
    affectedCandidateIds: input.affectedCandidateIds ?? (Array.isArray(payload.affectedCandidateIds) ? payload.affectedCandidateIds.map(String) : []),
    affectedParcelIds: input.affectedParcelIds ?? (Array.isArray(payload.affectedParcelIds) ? payload.affectedParcelIds.map(String) : []),
  };
}
