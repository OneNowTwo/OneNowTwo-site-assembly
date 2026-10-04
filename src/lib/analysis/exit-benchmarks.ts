/**
 * Local apartment exit benchmarks for unit-mix GRV.
 * Prefer bedroom-specific medians when available; otherwise NSW registered
 * strata / overall unit median. Template prices are last resort only.
 *
 * Used by both Area Scan (final ranking) and Analyse — same evidence → same prices.
 */

import { DEFAULT_UNIT_MIX_TEMPLATE, type UnitMixRow } from "./unit-mix";

export type ExitPriceSource =
  | "LOCAL_BEDROOM_MEDIAN"
  | "LOCAL_STRATA_BENCHMARK"
  | "LOCAL_STRATA_AREA_BAND" // legacy alias of LOCAL_STRATA_BENCHMARK
  | "LOCAL_UNIT_MEDIAN"
  | "TEMPLATE_DEFAULT"
  | "TEMPLATE_FALLBACK"
  | "USER_OVERRIDE";

/** Higher rank wins when merging / upgrading unit prices. */
export const EXIT_SOURCE_RANK: Record<ExitPriceSource, number> = {
  USER_OVERRIDE: 100,
  LOCAL_BEDROOM_MEDIAN: 80,
  LOCAL_STRATA_BENCHMARK: 60,
  LOCAL_STRATA_AREA_BAND: 60,
  LOCAL_UNIT_MEDIAN: 40,
  TEMPLATE_DEFAULT: 10,
  TEMPLATE_FALLBACK: 10,
};

export function normalizeExitPriceSource(source: string | null | undefined): ExitPriceSource {
  if (!source) return "TEMPLATE_FALLBACK";
  if (source === "LOCAL_STRATA_AREA_BAND") return "LOCAL_STRATA_BENCHMARK";
  if (source === "TEMPLATE_DEFAULT") return "TEMPLATE_FALLBACK";
  if (source in EXIT_SOURCE_RANK) return source as ExitPriceSource;
  return "TEMPLATE_FALLBACK";
}

export function exitPriceSourceLabel(source: ExitPriceSource | string | null | undefined): string {
  switch (normalizeExitPriceSource(source)) {
    case "USER_OVERRIDE":
      return "USER OVERRIDE";
    case "LOCAL_BEDROOM_MEDIAN":
      return "LOCAL BEDROOM MEDIAN";
    case "LOCAL_STRATA_BENCHMARK":
      return "LOCAL STRATA BENCHMARK";
    case "LOCAL_UNIT_MEDIAN":
      return "LOCAL UNIT MEDIAN";
    default:
      return "TEMPLATE FALLBACK";
  }
}

export interface ExitSaleEvidence {
  salePrice: number;
  bedrooms?: number | null;
  /** Strata unit area when available (not house land area). */
  unitAreaSqm?: number | null;
  strata?: boolean;
}

/** Minimal sale shape shared by NSW registered sales + other permitted sources. */
export interface NswLikeSaleForExit {
  salePrice: number;
  strata: boolean;
  landAreaSqm?: number | null;
  bedrooms?: number | null;
}

/**
 * Convert registered/permitted sales into exit evidence.
 * Prefer strata; if the strata sample is tiny, allow small non-strata unit-sized sales
 * as a weak fallback (same rule as Analyse enrichment).
 */
export function exitEvidenceFromNswLikeSales(sales: NswLikeSaleForExit[]): ExitSaleEvidence[] {
  const evidence: ExitSaleEvidence[] = sales
    .filter((s) => s.strata)
    .map((s) => ({
      salePrice: s.salePrice,
      bedrooms: s.bedrooms ?? null,
      unitAreaSqm: s.landAreaSqm != null && s.landAreaSqm > 0 && s.landAreaSqm <= 280 ? s.landAreaSqm : null,
      strata: true,
    }));
  if (evidence.length < 4) {
    for (const s of sales) {
      if (s.strata) continue;
      if (s.landAreaSqm != null && s.landAreaSqm > 0 && s.landAreaSqm <= 200) {
        evidence.push({
          salePrice: s.salePrice,
          bedrooms: s.bedrooms ?? null,
          unitAreaSqm: s.landAreaSqm,
          strata: true,
        });
      }
    }
  }
  return evidence;
}

export interface ExitBenchmarkSet {
  byUnitType: Record<
    string,
    { pricePerUnit: number; source: ExitPriceSource; sampleSize: number; providerLabel?: string }
  >;
  overallMedian: number | null;
  overallSampleSize: number;
  sourceLabel: string;
  suburb?: string | null;
  checkedAt?: string | null;
}

/** Build local exit benchmarks from a prefetched NSW (or NSW-like) sales pool. */
export function buildLocalExitBenchmarksFromNswSales(sales: NswLikeSaleForExit[]): ExitBenchmarkSet {
  return buildLocalExitBenchmarks(exitEvidenceFromNswLikeSales(sales));
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

/** Map bedrooms → unit mix row name. */
export function unitTypeFromBedrooms(bedrooms: number | null | undefined): string | null {
  if (bedrooms == null || !Number.isFinite(bedrooms)) return null;
  if (bedrooms <= 0) return "Studio";
  if (bedrooms === 1) return "1 Bed";
  if (bedrooms === 2) return "2 Bed";
  if (bedrooms === 3) return "3 Bed";
  if (bedrooms >= 4) return "4 Bed";
  return null;
}

/**
 * Soft area banding only when bedrooms are absent and area looks like a strata unit
 * (not house land). Labelled LOCAL_STRATA_BENCHMARK — not claimed as bedroom evidence.
 */
export function unitTypeFromStrataArea(areaSqm: number | null | undefined): string | null {
  if (areaSqm == null || !(areaSqm > 0) || areaSqm > 280) return null;
  if (areaSqm < 50) return "Studio";
  if (areaSqm < 70) return "1 Bed";
  if (areaSqm < 105) return "2 Bed";
  if (areaSqm < 145) return "3 Bed";
  return "4 Bed";
}

export function buildLocalExitBenchmarks(sales: ExitSaleEvidence[]): ExitBenchmarkSet {
  const strataOrUnit = sales.filter((s) => s.strata !== false && s.salePrice > 100_000 && s.salePrice < 15_000_000);
  const prices = strataOrUnit.map((s) => s.salePrice);
  const overallMedian = median(prices);
  const byTypePrices = new Map<string, number[]>();
  const byTypeSource = new Map<string, ExitPriceSource>();

  for (const s of strataOrUnit) {
    const bedType = unitTypeFromBedrooms(s.bedrooms ?? null);
    if (bedType) {
      const arr = byTypePrices.get(bedType) ?? [];
      arr.push(s.salePrice);
      byTypePrices.set(bedType, arr);
      byTypeSource.set(bedType, "LOCAL_BEDROOM_MEDIAN");
      continue;
    }
    const areaType = unitTypeFromStrataArea(s.unitAreaSqm ?? null);
    if (areaType) {
      // Only seed area-band buckets when bedroom evidence for that type is absent.
      if (byTypeSource.get(areaType) === "LOCAL_BEDROOM_MEDIAN") continue;
      const arr = byTypePrices.get(areaType) ?? [];
      arr.push(s.salePrice);
      byTypePrices.set(areaType, arr);
      byTypeSource.set(areaType, "LOCAL_STRATA_BENCHMARK");
    }
  }

  const byUnitType: ExitBenchmarkSet["byUnitType"] = {};
  const anchor = DEFAULT_UNIT_MIX_TEMPLATE.find((r) => r.name === "2 Bed") ?? DEFAULT_UNIT_MIX_TEMPLATE[2]!;
  for (const row of DEFAULT_UNIT_MIX_TEMPLATE) {
    const typed = byTypePrices.get(row.name);
    const typedMed = typed && typed.length >= 2 ? median(typed) : null;
    if (typedMed != null) {
      byUnitType[row.name] = {
        pricePerUnit: typedMed,
        source: normalizeExitPriceSource(byTypeSource.get(row.name) ?? "LOCAL_UNIT_MEDIAN"),
        sampleSize: typed!.length,
        providerLabel: "NSW registered sales",
      };
    } else if (overallMedian != null) {
      // No bedroom evidence: anchor local unit median on 2 Bed, scale other types by
      // template relative prices (structure only — not a new-build premium).
      const scale = anchor.salePricePerUnit > 0 ? row.salePricePerUnit / anchor.salePricePerUnit : 1;
      byUnitType[row.name] = {
        pricePerUnit: Math.round(overallMedian * scale),
        source: "LOCAL_UNIT_MEDIAN",
        sampleSize: prices.length,
        providerLabel: "NSW registered sales",
      };
    } else {
      byUnitType[row.name] = {
        pricePerUnit: row.salePricePerUnit,
        source: "TEMPLATE_FALLBACK",
        sampleSize: 0,
      };
    }
  }

  const hasBedroom = Object.values(byUnitType).some((v) => v.source === "LOCAL_BEDROOM_MEDIAN");
  const hasStrata = Object.values(byUnitType).some((v) => v.source === "LOCAL_STRATA_BENCHMARK");
  const sourceLabel = hasBedroom
    ? "Local apartment sale medians by bedroom (registered / permitted sales)"
    : hasStrata
      ? "Local strata sale medians (area-banded; bedrooms not in source) + unit median fallback"
      : overallMedian != null
        ? "Local strata/unit sale median (NSW registered sales) — bedroom detail unavailable"
        : "Template default unit prices (no local strata sample)";

  return {
    byUnitType,
    overallMedian,
    overallSampleSize: prices.length,
    sourceLabel,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Merge benchmarks: for each unit type, keep the higher-precedence source.
 * `preferred` values win ties / higher rank over `base`.
 */
export function mergeExitBenchmarkSets(base: ExitBenchmarkSet, preferred: ExitBenchmarkSet): ExitBenchmarkSet {
  const names = new Set([...Object.keys(base.byUnitType), ...Object.keys(preferred.byUnitType), ...DEFAULT_UNIT_MIX_TEMPLATE.map((r) => r.name)]);
  const byUnitType: ExitBenchmarkSet["byUnitType"] = {};
  for (const name of names) {
    const a = base.byUnitType[name];
    const b = preferred.byUnitType[name];
    if (!a && !b) continue;
    if (!a) {
      byUnitType[name] = b!;
      continue;
    }
    if (!b) {
      byUnitType[name] = a;
      continue;
    }
    const rankA = EXIT_SOURCE_RANK[normalizeExitPriceSource(a.source)] ?? 0;
    const rankB = EXIT_SOURCE_RANK[normalizeExitPriceSource(b.source)] ?? 0;
    byUnitType[name] = rankB >= rankA ? b : a;
  }
  const hasBedroom = Object.values(byUnitType).some((v) => normalizeExitPriceSource(v.source) === "LOCAL_BEDROOM_MEDIAN");
  return {
    byUnitType,
    overallMedian: preferred.overallMedian ?? base.overallMedian,
    overallSampleSize: Math.max(preferred.overallSampleSize, base.overallSampleSize),
    sourceLabel: hasBedroom
      ? preferred.sourceLabel || base.sourceLabel
      : base.sourceLabel || preferred.sourceLabel,
    suburb: preferred.suburb ?? base.suburb,
    checkedAt: preferred.checkedAt ?? base.checkedAt ?? new Date().toISOString(),
  };
}

/** True when a row still carries the stock template sale price (safe to replace with local benchmark). */
export function isTemplateDefaultSalePrice(row: UnitMixRow): boolean {
  const t = DEFAULT_UNIT_MIX_TEMPLATE.find((x) => x.name === row.name);
  return t != null && t.salePricePerUnit === row.salePricePerUnit;
}

/**
 * Apply local benchmarks to unit mix rows.
 * Explicit USER_OVERRIDE stays. Weaker persisted local/template sources upgrade
 * when a stronger benchmark is available (e.g. bedroom median over unit-median scale).
 */
export function applyExitBenchmarksToUnitMix(
  rows: UnitMixRow[],
  benchmarks: ExitBenchmarkSet,
  currentSources?: Record<string, string>,
): { rows: UnitMixRow[]; applied: boolean; sources: Record<string, ExitPriceSource> } {
  const sources: Record<string, ExitPriceSource> = {};
  let applied = false;
  const next = rows.map((r) => {
    const rawExisting = currentSources?.[r.name];
    const existing = rawExisting ? normalizeExitPriceSource(rawExisting) : null;
    const isTemplate = isTemplateDefaultSalePrice(r);

    // Only an explicit USER_OVERRIDE tag blocks upgrades.
    if (existing === "USER_OVERRIDE") {
      sources[r.name] = "USER_OVERRIDE";
      return r;
    }

    const b = benchmarks.byUnitType[r.name];
    if (!b) {
      sources[r.name] = existing ?? (isTemplate ? "TEMPLATE_FALLBACK" : "USER_OVERRIDE");
      return r;
    }
    const nextSource = normalizeExitPriceSource(b.source);
    if (nextSource === "TEMPLATE_FALLBACK" || nextSource === "TEMPLATE_DEFAULT") {
      sources[r.name] = existing ?? (isTemplate ? "TEMPLATE_FALLBACK" : "USER_OVERRIDE");
      return r;
    }

    const currentRank = isTemplate
      ? EXIT_SOURCE_RANK.TEMPLATE_FALLBACK
      : existing
        ? (EXIT_SOURCE_RANK[existing] ?? EXIT_SOURCE_RANK.LOCAL_UNIT_MEDIAN)
        : EXIT_SOURCE_RANK.LOCAL_UNIT_MEDIAN;
    const nextRank = EXIT_SOURCE_RANK[nextSource] ?? 0;
    if (nextRank < currentRank) {
      sources[r.name] = existing ?? "LOCAL_UNIT_MEDIAN";
      return r;
    }
    if (nextRank === currentRank && r.salePricePerUnit === b.pricePerUnit) {
      sources[r.name] = nextSource;
      return r;
    }

    applied = true;
    sources[r.name] = nextSource;
    return { ...r, salePricePerUnit: b.pricePerUnit };
  });
  return { rows: next, applied, sources };
}
