/**
 * Whole-property market estimate for multi-lot / shared-address holdings.
 * Prefer registered-sale comps on combined land area; when the subject is large
 * and peer lots of similar size are scarce, use local house land-rate × area.
 */
import {
  buildComparableValuation,
  type CompSaleInput,
  type ComparableValuationResult,
  DEFAULT_COMP_SEARCH,
} from "./comparable-valuation";

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export interface PropertyLevelValuationInput {
  areaSqm: number;
  suburb?: string | null;
  zone?: string | null;
  isStrata?: boolean;
  sales: CompSaleInput[];
  /** Typical local dwelling land-area band used for $/sqm rate fallback. */
  rateBandSqm?: { min: number; max: number };
}

/**
 * Estimate one property value for the combined site.
 * Never maxes or sums separate lot house AVMs.
 */
export function estimatePropertyLevelValue(input: PropertyLevelValuationInput): ComparableValuationResult & {
  methodDetail: "COMBINED_AREA_COMPS" | "LOCAL_LAND_RATE" | "INSUFFICIENT";
  landRatePerSqm: number | null;
} {
  const areaSqm = input.areaSqm;
  const subject = {
    areaSqm,
    suburb: input.suburb ?? null,
    zone: input.zone ?? null,
    isStrata: input.isStrata ?? false,
  };

  // Large dual-lot holdings rarely have same-size peers — widen land-area tolerance.
  const tol = areaSqm >= 1000 ? 0.55 : DEFAULT_COMP_SEARCH.landAreaTolerance;
  const direct = buildComparableValuation(input.sales, subject, {
    search: { landAreaTolerance: tol, lookbackMonths: 36, radiusM: 1200 },
  });

  const band = input.rateBandSqm ?? { min: 300, max: 1000 };
  const rateSales = input.sales.filter((s) => {
    if (s.strata) return false;
    if (s.landAreaSqm == null || s.landAreaSqm < band.min || s.landAreaSqm > band.max) return false;
    if (s.salePrice < 200_000) return false;
    if (s.distanceM > 1200) return false;
    return true;
  });
  const rates = rateSales.map((s) => s.salePrice / (s.landAreaSqm as number));
  const medRate = median(rates);
  // Trim rate outliers then re-median.
  let landRatePerSqm = medRate;
  if (medRate != null && rates.length >= 5) {
    const trimmed = rates.filter((r) => r >= medRate * 0.65 && r <= medRate * 1.4);
    landRatePerSqm = median(trimmed) ?? medRate;
  }
  const rateMid = landRatePerSqm != null && areaSqm > 0 ? Math.round(landRatePerSqm * areaSqm) : null;

  const strongRate = rateMid != null && landRatePerSqm != null && rateSales.length >= 5;
  // Large dual-lot holdings: area-adjusting small house comps often overstates.
  // Prefer local land-rate × combined area when rate evidence is strong and the
  // direct comps mid diverges by more than ~20%, or when the site is ≥1,000 sqm.
  const directInflated = strongRate && direct.mid != null && direct.mid > rateMid! * 1.2;
  const directUndercount = strongRate && direct.mid != null && direct.mid < rateMid! * 0.75;
  const preferRateForLargeSite = strongRate && areaSqm >= 1000;

  if (strongRate && (preferRateForLargeSite || directInflated || directUndercount || direct.mid == null)) {
    const low = Math.round(rateMid! * 0.9);
    const high = Math.round(rateMid! * 1.1);
    return {
      mid: rateMid!,
      low,
      high,
      confidence: rateSales.length >= 12 ? "MEDIUM" : "LOW",
      numberOfComps: rateSales.length,
      comps: direct.comps,
      method: "nsw_property_level_land_rate",
      note: `PROPERTY-LEVEL SCREENING ESTIMATE — local house land rate $${Math.round(landRatePerSqm!).toLocaleString("en-AU")}/sqm × ${Math.round(areaSqm)} sqm (${rateSales.length} sales)`,
      label: "COMPARABLE-DERIVED SCREENING ESTIMATE",
      methodDetail: "LOCAL_LAND_RATE",
      landRatePerSqm,
    };
  }

  if (direct.mid != null) {
    return {
      ...direct,
      methodDetail: "COMBINED_AREA_COMPS",
      landRatePerSqm,
      note: `${direct.note} · combined site ${Math.round(areaSqm)} sqm`,
      method: "nsw_property_level_comps",
    };
  }

  return {
    mid: null,
    low: null,
    high: null,
    confidence: "LOW",
    numberOfComps: 0,
    comps: direct.comps,
    method: "nsw_property_level",
    note: "INSUFFICIENT COMPARABLES for property-level estimate",
    label: "COMPARABLE-DERIVED SCREENING ESTIMATE",
    methodDetail: "INSUFFICIENT",
    landRatePerSqm,
  };
}
