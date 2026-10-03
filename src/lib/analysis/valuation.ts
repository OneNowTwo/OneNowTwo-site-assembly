/**
 * Existing-property valuation quality model.
 * Trusted statuses may drive acquisition headroom; suburb/system fallbacks must not.
 */

export const TRUSTED_VALUATION_STATUSES = ["LIVE_AVM", "COMPARABLE_DERIVED", "USER_ESTIMATE"] as const;
export type TrustedValuationStatus = (typeof TRUSTED_VALUATION_STATUSES)[number];

export type ValuationStatus = TrustedValuationStatus | "SUBURB_FALLBACK" | "NO_VALUE";

export type ValuationConfidence = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

export type AcquisitionViability = "LIKELY_VIABLE" | "MARGINAL" | "UNLIKELY" | "INSUFFICIENT_VALUATION_DATA";

export interface PropertyValuation {
  mid: number | null;
  low: number | null;
  high: number | null;
  status: ValuationStatus;
  confidence: ValuationConfidence;
  source: string;
  provider: "DOMAIN" | "PROPTRACK" | "CORELOGIC" | "MANUAL" | "COMPS" | "SYSTEM" | null;
  method: string | null;
  checkedAt: string | null;
  note?: string | null;
}

export interface LotValuationInput {
  id: string;
  areaSqm: number;
  marketValue?: number | null;
  marketValueLow?: number | null;
  marketValueHigh?: number | null;
  marketValueSource?: string | null;
  marketValueConfidence?: string | null;
  marketValueProvider?: string | null;
  marketValueMethod?: string | null;
  marketValueCheckedAt?: string | null;
  landValuePerSqm?: number | null;
}

/** Map persisted DB / provider source strings onto quality statuses. */
export function resolveValuationStatus(source: string | null | undefined, mid: number | null | undefined): ValuationStatus {
  if (mid == null || !(mid > 0)) return "NO_VALUE";
  switch (source) {
    case "USER_ESTIMATE":
      return "USER_ESTIMATE";
    case "COMPARABLE_DERIVED":
      return "COMPARABLE_DERIVED";
    case "LIVE_AVM":
    case "LIVE_PROVIDER":
      return "LIVE_AVM";
    case "DEMO":
      return "USER_ESTIMATE";
    case "SUBURB_FALLBACK":
    case "SYSTEM_ESTIMATE":
      return "SUBURB_FALLBACK";
    default:
      // Legacy rows with a value but no source — treat as user estimate so edits still work.
      return source ? "SUBURB_FALLBACK" : "USER_ESTIMATE";
  }
}

export function isTrustedValuationStatus(status: ValuationStatus): boolean {
  return (TRUSTED_VALUATION_STATUSES as readonly string[]).includes(status);
}

export function parseConfidence(raw: string | null | undefined): ValuationConfidence {
  if (!raw) return "UNKNOWN";
  const u = raw.toUpperCase();
  if (u.includes("HIGH")) return "HIGH";
  if (u.includes("MED")) return "MEDIUM";
  if (u.includes("LOW")) return "LOW";
  return "UNKNOWN";
}

export function lotToPropertyValuation(lot: LotValuationInput): PropertyValuation {
  const mid = lot.marketValue != null && lot.marketValue > 0 ? lot.marketValue : null;
  const status = resolveValuationStatus(lot.marketValueSource, mid);
  return {
    mid: isTrustedValuationStatus(status) ? mid : mid != null && status === "SUBURB_FALLBACK" ? mid : null,
    low: lot.marketValueLow ?? null,
    high: lot.marketValueHigh ?? null,
    status,
    confidence: parseConfidence(lot.marketValueConfidence),
    source: lot.marketValueSource ?? (mid ? "USER_ESTIMATE" : "NO_VALUE"),
    provider: (lot.marketValueProvider as PropertyValuation["provider"]) ?? null,
    method: lot.marketValueMethod ?? null,
    checkedAt: lot.marketValueCheckedAt ?? null,
  };
}

/** Rough screening only — never use for acquisition decisions. */
export function suburbFallbackEstimate(areaSqm: number, ratePerSqm: number): PropertyValuation {
  const mid = areaSqm * ratePerSqm;
  return {
    mid,
    low: mid * 0.85,
    high: mid * 1.15,
    status: "SUBURB_FALLBACK",
    confidence: "LOW",
    source: "SUBURB_FALLBACK",
    provider: "SYSTEM",
    method: "land_area_x_generic_rate",
    checkedAt: new Date().toISOString(),
    note: "ROUGH SCREENING ESTIMATE — DO NOT USE FOR ACQUISITION DECISION",
  };
}

export interface AssemblyValuationSummary {
  mid: number | null;
  low: number | null;
  high: number | null;
  complete: boolean;
  trustedLotCount: number;
  missingLotCount: number;
  lotStatuses: ValuationStatus[];
  /** Optional rough screening total (labelled — not for decisions). */
  screeningMid: number | null;
  headroomMid: number | null;
  headroomLow: number | null;
  headroomHigh: number | null;
  viability: AcquisitionViability;
}

export function summariseAssemblyValuation(
  lots: LotValuationInput[],
  maxPayable: number,
  screeningRatePerSqm: number,
): AssemblyValuationSummary {
  const vals = lots.map(lotToPropertyValuation);
  const trusted = vals.filter((v) => isTrustedValuationStatus(v.status) && v.mid != null && v.mid > 0);
  const complete = trusted.length === lots.length && lots.length > 0;

  const mid = complete ? trusted.reduce((s, v) => s + (v.mid ?? 0), 0) : null;
  const low = complete
    ? trusted.reduce((s, v) => s + (v.low != null && v.low > 0 ? v.low : (v.mid as number) * 0.9), 0)
    : null;
  const high = complete
    ? trusted.reduce((s, v) => s + (v.high != null && v.high > 0 ? v.high : (v.mid as number) * 1.1), 0)
    : null;

  const screeningMid = lots.reduce((s, l) => {
    const v = lotToPropertyValuation(l);
    if (v.mid != null && v.mid > 0 && isTrustedValuationStatus(v.status)) return s + v.mid;
    return s + l.areaSqm * screeningRatePerSqm;
  }, 0);

  const headroomMid = mid != null ? maxPayable - mid : null;
  const headroomLow = high != null ? maxPayable - high : null; // high existing → lowest headroom
  const headroomHigh = low != null ? maxPayable - low : null; // low existing → highest headroom

  let viability: AcquisitionViability = "INSUFFICIENT_VALUATION_DATA";
  if (complete && headroomMid != null && mid != null) {
    const pct = mid > 0 ? headroomMid / mid : 0;
    if (headroomMid < 0) viability = "UNLIKELY";
    else if (pct < 0.15) viability = "MARGINAL";
    else viability = "LIKELY_VIABLE";
  }

  return {
    mid,
    low,
    high,
    complete,
    trustedLotCount: trusted.length,
    missingLotCount: lots.length - trusted.length,
    lotStatuses: vals.map((v) => v.status),
    screeningMid: lots.length ? screeningMid : null,
    headroomMid,
    headroomLow,
    headroomHigh,
    viability,
  };
}

export function valuationSourceBadge(status: ValuationStatus, provider?: string | null): string {
  if (status === "LIVE_AVM") {
    if (provider === "DOMAIN") return "Domain Price Estimate";
    if (provider === "PROPTRACK") return "PropTrack AVM";
    return "LIVE AVM";
  }
  if (status === "COMPARABLE_DERIVED") return "COMPS";
  if (status === "USER_ESTIMATE") return "USER";
  if (status === "SUBURB_FALLBACK") return "ROUGH ESTIMATE";
  return "VALUE REQUIRED";
}

export function viabilityLabel(v: AcquisitionViability): string {
  switch (v) {
    case "LIKELY_VIABLE":
      return "LIKELY VIABLE";
    case "MARGINAL":
      return "MARGINAL";
    case "UNLIKELY":
      return "UNLIKELY AT CURRENT ASSUMPTIONS";
    default:
      return "INSUFFICIENT VALUATION DATA";
  }
}
