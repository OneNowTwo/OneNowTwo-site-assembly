/**
 * Local apartment exit benchmarks for unit-mix GRV.
 * Prefer bedroom-specific medians when the source provides bedrooms;
 * otherwise fall back to local strata/unit median (no invented new-build premium).
 */

import { DEFAULT_UNIT_MIX_TEMPLATE, type UnitMixRow } from "./unit-mix";

export type ExitPriceSource =
  | "LOCAL_BEDROOM_MEDIAN"
  | "LOCAL_UNIT_MEDIAN"
  | "LOCAL_STRATA_AREA_BAND"
  | "TEMPLATE_DEFAULT"
  | "USER_OVERRIDE";

export interface ExitSaleEvidence {
  salePrice: number;
  bedrooms?: number | null;
  /** Strata unit area when available (not house land area). */
  unitAreaSqm?: number | null;
  strata?: boolean;
}

export interface ExitBenchmarkSet {
  byUnitType: Record<string, { pricePerUnit: number; source: ExitPriceSource; sampleSize: number }>;
  overallMedian: number | null;
  overallSampleSize: number;
  sourceLabel: string;
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
 * (not house land). Labelled LOCAL_STRATA_AREA_BAND — not claimed as bedroom evidence.
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
      byTypeSource.set(areaType, "LOCAL_STRATA_AREA_BAND");
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
        source: byTypeSource.get(row.name) ?? "LOCAL_UNIT_MEDIAN",
        sampleSize: typed!.length,
      };
    } else if (overallMedian != null) {
      // No bedroom evidence: anchor local unit median on 2 Bed, scale other types by
      // template relative prices (structure only — not a new-build premium).
      const scale = anchor.salePricePerUnit > 0 ? row.salePricePerUnit / anchor.salePricePerUnit : 1;
      byUnitType[row.name] = {
        pricePerUnit: Math.round(overallMedian * scale),
        source: "LOCAL_UNIT_MEDIAN",
        sampleSize: prices.length,
      };
    } else {
      byUnitType[row.name] = {
        pricePerUnit: row.salePricePerUnit,
        source: "TEMPLATE_DEFAULT",
        sampleSize: 0,
      };
    }
  }

  const hasBedroom = Object.values(byUnitType).some((v) => v.source === "LOCAL_BEDROOM_MEDIAN");
  const hasArea = Object.values(byUnitType).some((v) => v.source === "LOCAL_STRATA_AREA_BAND");
  const sourceLabel = hasBedroom
    ? "Local apartment sale medians by bedroom (registered / permitted sales)"
    : hasArea
      ? "Local strata sale medians (area-banded; bedrooms not in source) + unit median fallback"
      : overallMedian != null
        ? "Local strata/unit sale median (NSW registered sales) — bedroom detail unavailable"
        : "Template default unit prices (no local strata sample)";

  return {
    byUnitType,
    overallMedian,
    overallSampleSize: prices.length,
    sourceLabel,
  };
}

/** True when a row still carries the stock template sale price (safe to replace with local benchmark). */
export function isTemplateDefaultSalePrice(row: UnitMixRow): boolean {
  const t = DEFAULT_UNIT_MIX_TEMPLATE.find((x) => x.name === row.name);
  return t != null && t.salePricePerUnit === row.salePricePerUnit;
}

/** Apply local benchmarks to rows still on template defaults. User overrides stay. */
export function applyExitBenchmarksToUnitMix(
  rows: UnitMixRow[],
  benchmarks: ExitBenchmarkSet,
): { rows: UnitMixRow[]; applied: boolean; sources: Record<string, ExitPriceSource> } {
  const sources: Record<string, ExitPriceSource> = {};
  let applied = false;
  const next = rows.map((r) => {
    if (!isTemplateDefaultSalePrice(r) && r.count > 0) {
      sources[r.name] = "USER_OVERRIDE";
      return r;
    }
    if (!isTemplateDefaultSalePrice(r) && r.count === 0) {
      sources[r.name] = "USER_OVERRIDE";
      return r;
    }
    const b = benchmarks.byUnitType[r.name];
    if (!b || b.source === "TEMPLATE_DEFAULT") {
      sources[r.name] = "TEMPLATE_DEFAULT";
      return r;
    }
    applied = true;
    sources[r.name] = b.source;
    return { ...r, salePricePerUnit: b.pricePerUnit };
  });
  return { rows: next, applied, sources };
}
