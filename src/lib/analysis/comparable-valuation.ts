/**
 * Transparent comparable-derived screening valuation from registered sales.
 * Not a certified valuation / not a black-box AVM.
 */

export interface CompSaleInput {
  id: string;
  address: string;
  salePrice: number;
  saleDate: string | null;
  saleDateMs: number | null;
  landAreaSqm: number | null;
  distanceM: number;
  strata: boolean;
  suburb: string | null;
  zone?: string | null;
  source: string;
  dealing?: string | null;
  propid?: number | null;
}

export interface CompScoreWeights {
  distance: number;
  landArea: number;
  recency: number;
  zoning: number;
  other: number;
}

export const DEFAULT_COMP_WEIGHTS: CompScoreWeights = {
  distance: 0.3,
  landArea: 0.3,
  recency: 0.25,
  zoning: 0.1,
  other: 0.05,
};

export interface ScoredComparable extends CompSaleInput {
  similarity: number;
  areaAdjustedPrice: number;
  included: boolean;
  excludeReason?: string | null;
}

export interface ComparableValuationResult {
  mid: number | null;
  low: number | null;
  high: number | null;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  numberOfComps: number;
  comps: ScoredComparable[];
  method: string;
  note: string;
  label: "COMPARABLE-DERIVED SCREENING ESTIMATE";
}

export interface CompSearchDefaults {
  radiusM: number;
  lookbackMonths: number;
  landAreaTolerance: number;
  minComps: number;
  targetComps: number;
  maxComps: number;
}

export const DEFAULT_COMP_SEARCH: CompSearchDefaults = {
  radiusM: 1000,
  lookbackMonths: 24,
  landAreaTolerance: 0.35,
  minComps: 3,
  targetComps: 7,
  maxComps: 10,
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function percentile(nums: number[], p: number): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const idx = clamp01(p) * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return s[lo]!;
  return s[lo]! * (hi - idx) + s[hi]! * (idx - lo);
}

export function scoreComparable(
  sale: CompSaleInput,
  subject: { areaSqm: number; suburb?: string | null; zone?: string | null; isStrata: boolean },
  opts?: { weights?: CompScoreWeights; radiusM?: number; lookbackMonths?: number; nowMs?: number },
): { similarity: number; areaAdjustedPrice: number } {
  const w = opts?.weights ?? DEFAULT_COMP_WEIGHTS;
  const radiusM = opts?.radiusM ?? DEFAULT_COMP_SEARCH.radiusM;
  const lookbackMs = (opts?.lookbackMonths ?? DEFAULT_COMP_SEARCH.lookbackMonths) * 30.4375 * 24 * 3600 * 1000;
  const now = opts?.nowMs ?? Date.now();

  const distScore = clamp01(1 - sale.distanceM / radiusM);
  const area = sale.landAreaSqm && sale.landAreaSqm > 0 ? sale.landAreaSqm : subject.areaSqm;
  const areaDiff = subject.areaSqm > 0 ? Math.abs(area - subject.areaSqm) / subject.areaSqm : 1;
  const areaScore = clamp01(1 - areaDiff / Math.max(0.05, DEFAULT_COMP_SEARCH.landAreaTolerance * 1.2));
  const ageMs = sale.saleDateMs != null ? Math.max(0, now - sale.saleDateMs) : lookbackMs;
  const recencyScore = clamp01(1 - ageMs / lookbackMs);
  const sameSuburb = subject.suburb && sale.suburb && subject.suburb.toLowerCase() === sale.suburb.toLowerCase();
  const zoneScore = sale.zone && subject.zone ? (sale.zone === subject.zone ? 1 : 0.4) : sameSuburb ? 0.7 : 0.4;
  const other =
    (sale.strata === subject.isStrata ? 0.6 : 0) +
    (sameSuburb ? 0.4 : 0);

  const similarity =
    w.distance * distScore + w.landArea * areaScore + w.recency * recencyScore + w.zoning * zoneScore + w.other * other;

  const areaAdjustedPrice = area > 0 ? sale.salePrice * (subject.areaSqm / area) : sale.salePrice;
  return { similarity, areaAdjustedPrice };
}

/**
 * Filter → score → drop price outliers → pick top comps → weighted mid + percentile range.
 */
export function buildComparableValuation(
  sales: CompSaleInput[],
  subject: { areaSqm: number; suburb?: string | null; zone?: string | null; isStrata: boolean },
  opts?: {
    weights?: CompScoreWeights;
    search?: Partial<CompSearchDefaults>;
    excludedIds?: Set<string>;
    nowMs?: number;
  },
): ComparableValuationResult {
  const search = { ...DEFAULT_COMP_SEARCH, ...opts?.search };
  const now = opts?.nowMs ?? Date.now();
  const lookbackMs = search.lookbackMonths * 30.4375 * 24 * 3600 * 1000;
  const cutoff = now - lookbackMs;
  const excluded = opts?.excludedIds ?? new Set<string>();

  const scored: ScoredComparable[] = [];
  for (const sale of sales) {
    let excludeReason: string | null = null;
    if (excluded.has(sale.id)) excludeReason = "Excluded by user";
    else if (sale.strata !== subject.isStrata) excludeReason = subject.isStrata ? "Strata mismatch" : "Not a house (strata)";
    else if (sale.saleDateMs != null && sale.saleDateMs < cutoff) excludeReason = "Older than lookback";
    else if (sale.distanceM > search.radiusM) excludeReason = "Outside radius";
    else if (sale.landAreaSqm != null && subject.areaSqm > 0) {
      const diff = Math.abs(sale.landAreaSqm - subject.areaSqm) / subject.areaSqm;
      if (diff > search.landAreaTolerance * 1.5) excludeReason = "Land area too dissimilar";
    } else if (sale.salePrice < 100_000) excludeReason = "Price too low";

    const { similarity, areaAdjustedPrice } = scoreComparable(sale, subject, {
      weights: opts?.weights,
      radiusM: search.radiusM,
      lookbackMonths: search.lookbackMonths,
      nowMs: now,
    });

    scored.push({
      ...sale,
      similarity,
      areaAdjustedPrice,
      included: !excludeReason,
      excludeReason,
    });
  }

  // Soft land-area preference before outlier trim.
  const eligible = scored
    .filter((c) => c.included)
    .filter((c) => {
      if (c.landAreaSqm == null || !(subject.areaSqm > 0)) return true;
      return Math.abs(c.landAreaSqm - subject.areaSqm) / subject.areaSqm <= search.landAreaTolerance;
    })
    .sort((a, b) => b.similarity - a.similarity || a.distanceM - b.distanceM);

  // Outlier removal on area-adjusted prices (median band).
  const med = median(eligible.map((c) => c.areaAdjustedPrice));
  const withoutOutliers = eligible.filter((c) => {
    if (!(med > 0)) return true;
    const ratio = c.areaAdjustedPrice / med;
    return ratio >= 0.65 && ratio <= 1.4;
  });
  for (const c of eligible) {
    if (!withoutOutliers.includes(c)) {
      c.included = false;
      c.excludeReason = "Price outlier vs peer comps";
    }
  }

  const picked = withoutOutliers.slice(0, search.maxComps);
  // Mark non-picked eligible as not included in estimate (still shown).
  const pickedIds = new Set(picked.map((c) => c.id));
  for (const c of scored) {
    if (c.included && !pickedIds.has(c.id) && withoutOutliers.includes(c)) {
      c.included = false;
      c.excludeReason = "Not in top similarity set";
    }
  }

  if (picked.length < search.minComps) {
    return {
      mid: null,
      low: null,
      high: null,
      confidence: "LOW",
      numberOfComps: picked.length,
      comps: scored.sort((a, b) => b.similarity - a.similarity),
      method: "nsw_registered_comps_weighted",
      note: `INSUFFICIENT COMPARABLES — ${picked.length} usable sale(s) within ${search.radiusM}m / ${search.lookbackMonths} months`,
      label: "COMPARABLE-DERIVED SCREENING ESTIMATE",
    };
  }

  let wSum = 0;
  let pSum = 0;
  const adj: number[] = [];
  for (const c of picked) {
    const w = Math.max(0.05, c.similarity);
    wSum += w;
    pSum += c.areaAdjustedPrice * w;
    adj.push(c.areaAdjustedPrice);
  }
  const mid = Math.round(pSum / wSum);
  const low = Math.round(percentile(adj, 0.2));
  const high = Math.round(percentile(adj, 0.8));

  const verySimilar = picked.filter((c) => c.similarity >= 0.75 && c.distanceM <= 600).length;
  let confidence: ComparableValuationResult["confidence"] = "LOW";
  if (picked.length >= 5 && verySimilar >= 4) confidence = "HIGH";
  else if (picked.length >= 3) confidence = "MEDIUM";

  return {
    mid,
    low: Math.min(low, mid),
    high: Math.max(high, mid),
    confidence,
    numberOfComps: picked.length,
    comps: scored.sort((a, b) => Number(b.included) - Number(a.included) || b.similarity - a.similarity),
    method: "nsw_registered_comps_weighted",
    note: `COMPARABLE-DERIVED SCREENING ESTIMATE — based on ${picked.length} NSW registered sales (not a certified valuation)`,
    label: "COMPARABLE-DERIVED SCREENING ESTIMATE",
  };
}
