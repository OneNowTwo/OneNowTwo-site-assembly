/**
 * Map thematic layer colours for loaded parcels.
 * Current LEP / EPI controls only — never proposed or state-pathway values.
 */

export type ParcelTheme = "zoning" | "fsr" | "height" | "heritage" | "strata" | "none";

/** Exclusive parcel-colour themes (Proposed planning / activity / stations remain independent). */
export type ParcelThemeId = Exclude<ParcelTheme, "none">;

export interface ParcelThemeFlags {
  zoning: boolean;
  zoningWms: boolean;
  fsr: boolean;
  height: boolean;
  heritage: boolean;
  strata: boolean;
}

/** One active parcel-colour theme — enabling one clears the others (including zoning WMS). */
export function applyParcelTheme(theme: ParcelThemeId | "none"): ParcelThemeFlags {
  return {
    zoning: theme === "zoning",
    zoningWms: theme === "zoning",
    fsr: theme === "fsr",
    height: theme === "height",
    heritage: theme === "heritage",
    strata: theme === "strata",
  };
}

/** Resolve which parcel theme is active from exclusive flags. */
export function resolveParcelTheme(flags: {
  zoning: boolean;
  fsr: boolean;
  height: boolean;
  heritage: boolean;
  strata: boolean;
}): ParcelTheme {
  if (flags.strata) return "strata";
  if (flags.heritage) return "heritage";
  if (flags.fsr) return "fsr";
  if (flags.height) return "height";
  if (flags.zoning) return "zoning";
  return "none";
}

export type FsrBucket = "not_loaded" | "not_mapped" | "le_0_5" | "0_5_1" | "1_1_5" | "1_5_2" | "gt_2";
export type HeightBucket = "not_loaded" | "not_mapped" | "le_9" | "9_12" | "12_18" | "gt_18";
export type HeritageKind = "item" | "conservation" | "none" | "unknown";

export const FSR_BUCKET_COLOURS: Record<FsrBucket, string> = {
  not_loaded: "#fbbf24",
  not_mapped: "#d1d5db",
  le_0_5: "#dbeafe",
  "0_5_1": "#93c5fd",
  "1_1_5": "#3b82f6",
  "1_5_2": "#1d4ed8",
  gt_2: "#1e3a8a",
};

export const FSR_LEGEND: { key: FsrBucket; label: string }[] = [
  { key: "not_loaded", label: "Not loaded" },
  { key: "not_mapped", label: "Not mapped" },
  { key: "le_0_5", label: "≤ 0.5" },
  { key: "0_5_1", label: "0.5 – 1.0" },
  { key: "1_1_5", label: "1.0 – 1.5" },
  { key: "1_5_2", label: "1.5 – 2.0" },
  { key: "gt_2", label: "2.0+" },
];

export const HEIGHT_BUCKET_COLOURS: Record<HeightBucket, string> = {
  not_loaded: "#fbbf24",
  not_mapped: "#d1d5db",
  le_9: "#dcfce7",
  "9_12": "#86efac",
  "12_18": "#22c55e",
  gt_18: "#15803d",
};

export const HEIGHT_LEGEND: { key: HeightBucket; label: string }[] = [
  { key: "not_loaded", label: "Not loaded" },
  { key: "not_mapped", label: "Not mapped" },
  { key: "le_9", label: "≤ 9 m" },
  { key: "9_12", label: "9 – 12 m" },
  { key: "12_18", label: "12 – 18 m" },
  { key: "gt_18", label: "18 m+" },
];

export const HERITAGE_COLOURS = {
  item: "#7c3aed",
  conservation: "#a78bfa",
  none: "#e5e7eb",
  unknown: "#d1d5db",
} as const;

export const STRATA_COLOUR = "#db2777";

/**
 * Resolve FSR bucket from current mapped LEP FSR only.
 * UNAVAILABLE / not-loaded (service down) ≠ NO_MAPPED (EPI has no control).
 * Never treat missing as 0.
 */
export function fsrBucket(
  fsr: number | null | undefined,
  fsrStatus?: string | null,
  planningStatus?: string | null,
): FsrBucket {
  if (fsrStatus === "UNAVAILABLE" || planningStatus === "unavailable") return "not_loaded";
  if (fsrStatus === "NO_MAPPED" || fsr == null || !Number.isFinite(fsr)) return "not_mapped";
  if (fsr <= 0.5) return "le_0_5";
  if (fsr <= 1) return "0_5_1";
  if (fsr <= 1.5) return "1_1_5";
  if (fsr <= 2) return "1_5_2";
  return "gt_2";
}

export function fsrColour(
  fsr: number | null | undefined,
  fsrStatus?: string | null,
  planningStatus?: string | null,
): string {
  return FSR_BUCKET_COLOURS[fsrBucket(fsr, fsrStatus, planningStatus)];
}

/** Current statutory / LEP height only. Missing stays not_mapped; service-down is not_loaded. */
export function heightBucket(
  heightM: number | null | undefined,
  planningStatus?: string | null,
): HeightBucket {
  if (planningStatus === "unavailable") return "not_loaded";
  if (heightM == null || !Number.isFinite(heightM)) return "not_mapped";
  if (heightM <= 9) return "le_9";
  if (heightM <= 12) return "9_12";
  if (heightM <= 18) return "12_18";
  return "gt_18";
}

export function heightColour(heightM: number | null | undefined, planningStatus?: string | null): string {
  return HEIGHT_BUCKET_COLOURS[heightBucket(heightM, planningStatus)];
}

/**
 * Classify heritage from parcel planning field.
 * null → unknown (layer unavailable). "None mapped" → none. Else item/conservation.
 * Never infer "no heritage" from missing data.
 */
export function heritageKind(heritage: string | null | undefined): HeritageKind {
  if (heritage == null) return "unknown";
  const h = heritage.trim();
  if (!h) return "unknown";
  if (/^none mapped$/i.test(h)) return "none";
  if (/conservation|hca|heritage conservation/i.test(h)) return "conservation";
  return "item";
}

export function heritageColour(heritage: string | null | undefined): string {
  return HERITAGE_COLOURS[heritageKind(heritage)];
}

export function isHeritageMapped(heritage: string | null | undefined): boolean {
  const k = heritageKind(heritage);
  return k === "item" || k === "conservation";
}
