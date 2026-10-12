/**
 * Material-change rules — engineering/source churn is NOT developer intelligence.
 * Today only surfaces developer-relevant control / activity changes.
 */

import type { IntelChangeKind } from "@/generated/prisma/client";

/** Kinds that can appear on Today when material=true and lifecycle=ACTIVE. */
export const DEVELOPER_MATERIAL_KINDS = new Set<IntelChangeKind | string>([
  "PLANNING_PROPOSAL_CREATED",
  "PLANNING_STATUS_CHANGED",
  "ZONE_PROPOSED_CHANGE",
  "FSR_PROPOSED_CHANGE",
  "HEIGHT_PROPOSED_CHANGE",
  "KEY_SITE_CREATED",
  "KEY_SITE_CHANGED",
  "ASSEMBLY_REQUIREMENT_CHANGED",
  "AFFORDABLE_HOUSING_RATE_CHANGED",
  "DCP_CHANGED",
  "HDA_RECORD_PUBLISHED",
  "HDA_RECOMMENDATION_CHANGED",
  "SSD_DECLARED",
  "SSD_STATUS_CHANGED",
  "DA_LODGED",
  "DA_APPROVED",
  "PCC_ISSUED",
  "COUNCIL_RESOLUTION",
  "ENVIRONMENTAL_LAYER_CHANGED",
]);

/** Engineering / diagnostics-only kinds — never Today for normal users. */
export const DIAGNOSTICS_ONLY_KINDS = new Set<IntelChangeKind | string>([
  "SOURCE_DOCUMENT_CHANGED",
  "SOURCE_REFRESHED",
]);

const ENGINEERING_TITLE_RE =
  /NEEDS_RE_EXTRACTION|content hash|parser|snapshot|canonical sync|fixture|SOURCE_DOCUMENT_CHANGED|portal HTML|bodyHash|documentHash/i;

export type MaterialEventInput = {
  kind: string;
  title?: string | null;
  summary?: string | null;
  material?: boolean | null;
  lifecycleStatus?: string | null;
  runPurpose?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  changeKey?: string | null;
  sourceId?: string | null;
};

/** True when extracted developer-relevant controls actually differ. */
export function hasMaterialControlDiff(oldValue: unknown, newValue: unknown): boolean {
  const o = asRecord(oldValue);
  const n = asRecord(newValue);
  if (!o && !n) return false;
  const keys = [
    "fsr",
    "incentiveFsr",
    "heightM",
    "incentiveHeightM",
    "zone",
    "proposedZone",
    "status",
    "affordableHousingRate",
    "requiredCount",
    "requirements",
    "recommendation",
    "dwellings",
    "stage",
  ] as const;
  for (const k of keys) {
    const a = pickDeep(o, k);
    const b = pickDeep(n, k);
    if (a !== undefined || b !== undefined) {
      if (JSON.stringify(a) !== JSON.stringify(b)) return true;
    }
  }
  // Full key-site / area objects: if JSON equal → not material
  if (o && n && JSON.stringify(o) !== JSON.stringify(n)) {
    // Prefer explicit control fields; bare metadata-only diffs are not material
    const metaOnly = onlyMetaKeys(o) && onlyMetaKeys(n);
    if (!metaOnly) return true;
  }
  return false;
}

function onlyMetaKeys(r: Record<string, unknown>): boolean {
  const meta = new Set([
    "documentHash",
    "portalBodyHash",
    "bodyHash",
    "structuredDataStatus",
    "needsReExtraction",
    "parserVersion",
    "provenance",
    "geometrySource",
  ]);
  return Object.keys(r).every((k) => meta.has(k));
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function pickDeep(r: Record<string, unknown> | null, key: string): unknown {
  if (!r) return undefined;
  if (key in r) return r[key];
  for (const nest of ["proposedControls", "incentiveControls", "currentControls", "newValue", "oldValue"]) {
    const inner = asRecord(r[nest]);
    if (inner && key in inner) return inner[key];
  }
  return undefined;
}

/**
 * Decide whether an intel event belongs on Today (vs diagnostics).
 * Respects persisted `material` / lifecycle when set; otherwise derives from kind + values.
 */
export function isMaterialForToday(event: MaterialEventInput): boolean {
  const lifecycle = event.lifecycleStatus ?? "ACTIVE";
  if (lifecycle === "ARCHIVED" || lifecycle === "TEST" || lifecycle === "FIXTURE" || lifecycle === "SUPERSEDED") {
    return false;
  }
  if (event.runPurpose === "BASELINE") return false;
  if (event.material === false) return false;

  if (DIAGNOSTICS_ONLY_KINDS.has(event.kind)) {
    // SOURCE_DOCUMENT_CHANGED only if structured controls also changed
    if (event.kind === "SOURCE_DOCUMENT_CHANGED") {
      return hasMaterialControlDiff(event.oldValue, event.newValue);
    }
    return false;
  }

  if (ENGINEERING_TITLE_RE.test(`${event.title ?? ""} ${event.summary ?? ""}`)) {
    if (!DEVELOPER_MATERIAL_KINDS.has(event.kind)) return false;
  }

  if (event.sourceId?.startsWith("fixture-") || event.changeKey?.startsWith("fixture-")) {
    return false;
  }

  if (event.material === true) return DEVELOPER_MATERIAL_KINDS.has(event.kind) || event.kind === "OTHER";

  return DEVELOPER_MATERIAL_KINDS.has(event.kind);
}

/** Classify a freshly produced DiffEvent before persist. */
export function classifyDiffMateriality(event: {
  kind: string;
  title?: string;
  summary?: string;
  oldValue?: unknown;
  newValue?: unknown;
  changeKey?: string;
}): { material: boolean; runPurposeHint?: "BASELINE" | "CHANGE" | "REFRESH" } {
  if (event.changeKey?.includes(":bootstrap:") || event.kind === "SOURCE_REFRESHED") {
    return { material: false, runPurposeHint: "BASELINE" };
  }
  if (event.kind === "SOURCE_DOCUMENT_CHANGED") {
    const material = hasMaterialControlDiff(event.oldValue, event.newValue);
    return { material, runPurposeHint: material ? "CHANGE" : "REFRESH" };
  }
  if (DEVELOPER_MATERIAL_KINDS.has(event.kind)) {
    return { material: true, runPurposeHint: "CHANGE" };
  }
  return { material: false, runPurposeHint: "REFRESH" };
}

/** Story / event dedupe fingerprint within a time window. */
export function eventDedupeFingerprint(event: {
  sourceId?: string | null;
  kind: string;
  title?: string | null;
  newValue?: unknown;
}): string {
  const materialSlice = extractMaterialSlice(event.newValue);
  return [event.sourceId ?? "", event.kind, materialSlice].join("|");
}

function extractMaterialSlice(v: unknown): string {
  const r = asRecord(v);
  if (!r) return "";
  const slice = {
    fsr: pickDeep(r, "fsr"),
    incentiveFsr: pickDeep(r, "incentiveFsr"),
    heightM: pickDeep(r, "heightM"),
    zone: pickDeep(r, "zone") ?? pickDeep(r, "proposedZone"),
    status: pickDeep(r, "status"),
    id: r.id ?? r.externalKeySiteId ?? null,
  };
  return JSON.stringify(slice);
}
