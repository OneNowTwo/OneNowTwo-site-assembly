/**
 * Read-only helpers for displaying already-persisted NSW registered-sales
 * evidence from OpportunityInputs.lotValuationDetails.
 *
 * Does NOT recompute valuations or invent ComparableSale rows.
 */

import type { OpportunityInputs } from "@/lib/analysis/assumptions";
import { DEFAULT_COMP_SEARCH } from "@/lib/analysis/comparable-valuation";

export type LotValuationDetail = NonNullable<OpportunityInputs["lotValuationDetails"]>[string];

export type RegisteredCompEvidence = NonNullable<LotValuationDetail["comps"]>[number];

/**
 * Re-apply active lookback to persisted comps so stale USED rows outside the window
 * render as EXCLUDED ("Older than lookback") after engine rules change.
 */
export function applyLookbackToPersistedComps(
  comps: RegisteredCompEvidence[],
  opts?: { lookbackMonths?: number; nowMs?: number },
): RegisteredCompEvidence[] {
  const months = opts?.lookbackMonths ?? DEFAULT_COMP_SEARCH.lookbackMonths;
  const now = opts?.nowMs ?? Date.now();
  const cutoff = now - months * 30.4375 * 24 * 3600 * 1000;
  return comps.map((c) => {
    const ms = c.saleDate ? Date.parse(c.saleDate) : NaN;
    if (!Number.isFinite(ms)) {
      if (c.included) {
        return { ...c, included: false, excludeReason: c.excludeReason ?? "Missing sale date" };
      }
      return c;
    }
    if (ms < cutoff && c.included) {
      return { ...c, included: false, excludeReason: "Older than lookback" };
    }
    return c;
  });
}

export type LotLikeForEvidence = {
  id: string;
  label: string;
  address?: string | null;
  externalParcelId: string;
  included?: boolean;
  marketValue?: number | null;
  marketValueLow?: number | null;
  marketValueHigh?: number | null;
  marketValueProvider?: string | null;
  marketValueMethod?: string | null;
  marketValueCheckedAt?: string | null;
  marketValueSource?: string | null;
};

/** True when a stored source string explicitly identifies NSW registered sales. */
export function isNswRegisteredSourceString(raw: string | null | undefined): boolean {
  if (!raw?.trim()) return false;
  const u = raw.trim().toUpperCase();
  if (u === "NSW") return true;
  if (u.includes("NSW") && (u.includes("REGISTERED") || u.includes("SALE") || u.includes("COMP"))) return true;
  return false;
}

/** NSW registered-sales provenance requires actual NSW evidence — not COMPARABLE_DERIVED alone. */
export function detailHasNswRegisteredEvidence(detail: LotValuationDetail | null | undefined): boolean {
  if (!detail) return false;
  if ((detail.provider ?? "").toUpperCase() === "NSW") return true;
  if (isNswRegisteredSourceString(detail.subjectLastSale?.source)) return true;
  for (const c of detail.comps ?? []) {
    if (isNswRegisteredSourceString(c.source)) return true;
  }
  return false;
}

/** Deterministic identity for a registered sale across lots. */
export function registeredSaleEvidenceId(comp: {
  dealing?: string | null;
  id?: string | null;
  address?: string | null;
  saleDate?: string | null;
  salePrice?: number | null;
}): string {
  const dealing = comp.dealing?.trim();
  if (dealing) return `dealing:${dealing.toUpperCase()}`;
  const id = comp.id?.trim();
  if (id && !id.startsWith("manual:")) {
    // Prefer stable dealing-like ids; fall through for synthetic keys that are address-based.
    if (/^[A-Z0-9]{6,}$/i.test(id) || id.includes("dealing") || id.startsWith("nsw:")) {
      return `id:${id.toUpperCase()}`;
    }
  }
  const address = (comp.address ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const saleDate = (comp.saleDate ?? "").trim();
  const salePrice = comp.salePrice != null && Number.isFinite(comp.salePrice) ? String(Math.round(comp.salePrice)) : "";
  return `asp:${address}|${saleDate}|${salePrice}`;
}

export function provenanceLabelsForDetail(
  detail: LotValuationDetail | null | undefined,
  opts?: { demoFinancialData?: boolean; marketValueSource?: string | null },
): {
  sourceLabel: string;
  methodLabel: string;
  estimateKind: string;
  dataQuality: string;
  isNswRegistered: boolean;
} {
  if (opts?.demoFinancialData) {
    return {
      sourceLabel: "Demo data",
      methodLabel: "Demo",
      estimateKind: "DEMO DATA",
      dataQuality: "Manual / demo",
      isNswRegistered: false,
    };
  }
  const source = (detail?.source ?? opts?.marketValueSource ?? "").toUpperCase();
  const label = detail?.valuationLabel ?? "";
  const isNsw = detailHasNswRegisteredEvidence(detail);

  if (isNsw) {
    return {
      sourceLabel: "NSW registered sales",
      methodLabel: label?.trim() || "Registered-sales weighted",
      estimateKind: "SYSTEM CALCULATION · COMPARABLE-DERIVED",
      // Persisted on Opportunity — not refreshed at page load.
      dataQuality: "OFFICIAL NSW DATA · STORED EVIDENCE",
      isNswRegistered: true,
    };
  }
  if (source === "USER_ESTIMATE" || source === "MANUAL") {
    return {
      sourceLabel: "User estimate",
      methodLabel: label?.trim() || "Manual",
      estimateKind: "USER ESTIMATE",
      dataQuality: "Manual",
      isNswRegistered: false,
    };
  }
  if (source.includes("AVM") || source === "LIVE_PROVIDER") {
    return {
      sourceLabel: detail?.provider ?? "AVM",
      methodLabel: label?.trim() || "AVM",
      estimateKind: "LIVE AVM",
      dataQuality: "Live AVM",
      isNswRegistered: false,
    };
  }
  if (source.includes("COMPARABLE")) {
    return {
      sourceLabel: detail?.provider?.trim() || "Comparable-derived",
      methodLabel: label?.trim() || "Comparable-derived",
      estimateKind: "SYSTEM CALCULATION · COMPARABLE-DERIVED",
      dataQuality: "STORED EVIDENCE",
      isNswRegistered: false,
    };
  }
  return {
    sourceLabel: detail?.provider ?? "—",
    methodLabel: label?.trim() || "—",
    estimateKind: source || "—",
    dataQuality: "—",
    isNswRegistered: false,
  };
}

export type LotRegisteredEvidenceCard = {
  lotId: string;
  externalParcelId: string;
  label: string;
  address: string;
  mid: number | null;
  low: number | null;
  high: number | null;
  /** Stored valuation metadata numberOfComps (may differ from displayed rows). */
  numberOfComps: number | null;
  /** Included rows actually present in comps[]. */
  includedCompCount: number;
  excludedCompCount: number;
  /** True when comps[] has at least one row. */
  hasDetailedSaleRows: boolean;
  /**
   * Headline "Registered sales used":
   * - detailed rows → includedCompCount
   * - metadata only → numberOfComps (as "comps reported")
   */
  usedDisplayCount: number | null;
  usedDisplayKind: "included_rows" | "metadata_reported" | "none";
  methodLabel: string;
  sourceLabel: string;
  provider: string | null;
  checkedAt: string | null;
  isNswRegistered: boolean;
  subjectLastSale: LotValuationDetail["subjectLastSale"];
  comps: RegisteredCompEvidence[];
};

export type AssemblyRegisteredSalesEvidence = {
  hasEvidence: boolean;
  /** True when at least one lot has stored comps[] rows. */
  hasDetailedSaleRows: boolean;
  lotCards: LotRegisteredEvidenceCard[];
  /** Unique registered sales across the assembly (included + excluded) from stored rows. */
  uniqueSaleCount: number;
  /** Unique included registered sales across the assembly from stored rows. */
  uniqueIncludedSaleCount: number;
  /** Sum of per-lot numberOfComps metadata (may double-count; not a unique count). */
  reportedCompMentions: number;
  /** Sum of per-lot comps[] length (may double-count). */
  rawCompMentions: number;
  combinedMid: number | null;
  primarySourceLabel: string;
  primaryMethodLabel: string;
  estimateKind: string;
  dataQuality: string;
  isNswRegistered: boolean;
  /** Never "based on 0 sales". */
  summaryLine: string;
  /** Secondary line when metadata exists without sale rows. */
  summaryDetail: string | null;
};

function lotAddress(lot: LotLikeForEvidence): string {
  return (lot.address?.trim() || lot.label || lot.externalParcelId).trim();
}

function buildSummaryCopy(args: {
  hasEvidence: boolean;
  hasDetailedSaleRows: boolean;
  uniqueIncludedSaleCount: number;
  reportedCompMentions: number;
  isNswRegistered: boolean;
}): { summaryLine: string; summaryDetail: string | null } {
  if (!args.hasEvidence) {
    return {
      summaryLine: "No registered-sales evidence stored for this opportunity yet.",
      summaryDetail: null,
    };
  }

  if (args.hasDetailedSaleRows) {
    const n = args.uniqueIncludedSaleCount;
    if (n <= 0) {
      // Rows exist but none marked included — do not say "based on 0".
      return {
        summaryLine: args.isNswRegistered
          ? "NSW registered-sales estimate · sale records stored (none marked included)"
          : "Comparable-derived estimate · sale records stored (none marked included)",
        summaryDetail: null,
      };
    }
    if (args.isNswRegistered) {
      return {
        summaryLine: `Existing value based on ${n} NSW registered sale${n === 1 ? "" : "s"}`,
        summaryDetail: null,
      };
    }
    return {
      summaryLine: `Existing value based on ${n} unique comparable sale${n === 1 ? "" : "s"}`,
      summaryDetail: null,
    };
  }

  // Metadata only — comps[] absent.
  const reported = args.reportedCompMentions;
  if (reported > 0 && args.isNswRegistered) {
    return {
      summaryLine: `NSW registered-sales estimate · ${reported} comps reported`,
      summaryDetail: "Individual sale records not stored",
    };
  }
  if (reported > 0) {
    return {
      summaryLine: `Comparable-derived estimate · ${reported} comps reported`,
      summaryDetail: "Individual sale records not stored",
    };
  }
  return {
    summaryLine: args.isNswRegistered
      ? "NSW registered-sales estimate stored (comp count not recorded)"
      : "Comparable-derived estimate stored (comp count not recorded)",
    summaryDetail: "Individual sale records not stored",
  };
}

/**
 * Summarise persisted lotValuationDetails for UI — pure, no network, no mutation.
 * Existing lot mid values are passed through unchanged.
 */
export function summariseRegisteredSalesEvidence(
  lotValuationDetails: OpportunityInputs["lotValuationDetails"] | null | undefined,
  lots: LotLikeForEvidence[],
  opts?: { demoFinancialData?: boolean; combinedExistingValue?: number | null },
): AssemblyRegisteredSalesEvidence {
  const details = lotValuationDetails ?? {};
  const includedLots = lots.filter((l) => l.included !== false);
  const uniqueAll = new Set<string>();
  const uniqueIncluded = new Set<string>();
  let rawCompMentions = 0;
  let reportedCompMentions = 0;

  const lotCards: LotRegisteredEvidenceCard[] = [];

  for (const lot of includedLots) {
    const detail = details[lot.externalParcelId];
    if (!detail) continue;
    const comps = applyLookbackToPersistedComps(detail.comps ?? []);
    if (!comps.length && detail.mid == null && detail.numberOfComps == null) continue;

    const labels = provenanceLabelsForDetail(detail, {
      demoFinancialData: opts?.demoFinancialData,
      marketValueSource: lot.marketValueSource,
    });

    let includedCompCount = 0;
    let excludedCompCount = 0;
    for (const c of comps) {
      const eid = registeredSaleEvidenceId(c);
      uniqueAll.add(eid);
      rawCompMentions += 1;
      if (c.included) {
        includedCompCount += 1;
        uniqueIncluded.add(eid);
      } else {
        excludedCompCount += 1;
      }
    }

    const hasDetailedSaleRows = comps.length > 0;
    const numberOfComps = detail.numberOfComps ?? null;
    if (numberOfComps != null && numberOfComps > 0) reportedCompMentions += numberOfComps;

    let usedDisplayCount: number | null;
    let usedDisplayKind: LotRegisteredEvidenceCard["usedDisplayKind"];
    if (hasDetailedSaleRows) {
      usedDisplayCount = includedCompCount;
      usedDisplayKind = "included_rows";
    } else if (numberOfComps != null && numberOfComps > 0) {
      usedDisplayCount = numberOfComps;
      usedDisplayKind = "metadata_reported";
    } else {
      usedDisplayCount = null;
      usedDisplayKind = "none";
    }

    const mid = detail.mid ?? lot.marketValue ?? null;
    lotCards.push({
      lotId: lot.id,
      externalParcelId: lot.externalParcelId,
      label: lot.label,
      address: lotAddress(lot),
      mid,
      low: detail.low ?? lot.marketValueLow ?? null,
      high: detail.high ?? lot.marketValueHigh ?? null,
      numberOfComps,
      includedCompCount,
      excludedCompCount,
      hasDetailedSaleRows,
      usedDisplayCount,
      usedDisplayKind,
      methodLabel: labels.methodLabel,
      sourceLabel: labels.sourceLabel,
      provider: detail.provider ?? lot.marketValueProvider ?? null,
      checkedAt: lot.marketValueCheckedAt ?? null,
      isNswRegistered: labels.isNswRegistered,
      subjectLastSale: detail.subjectLastSale ?? null,
      comps,
    });
  }

  const hasEvidence = lotCards.length > 0;
  const hasDetailedSaleRows = lotCards.some((c) => c.hasDetailedSaleRows);
  const firstDetail = lotCards[0] ? details[lotCards[0].externalParcelId] : null;
  const labels = provenanceLabelsForDetail(firstDetail, {
    demoFinancialData: opts?.demoFinancialData,
    marketValueSource: includedLots[0]?.marketValueSource,
  });

  const combinedFromLots = lotCards.every((c) => c.mid != null)
    ? lotCards.reduce((s, c) => s + (c.mid ?? 0), 0)
    : null;
  const combinedMid =
    opts?.combinedExistingValue != null && Number.isFinite(opts.combinedExistingValue)
      ? opts.combinedExistingValue
      : combinedFromLots;

  const uniqueIncludedSaleCount = uniqueIncluded.size;
  const { summaryLine, summaryDetail } = buildSummaryCopy({
    hasEvidence,
    hasDetailedSaleRows,
    uniqueIncludedSaleCount,
    reportedCompMentions,
    isNswRegistered: labels.isNswRegistered,
  });

  return {
    hasEvidence,
    hasDetailedSaleRows,
    lotCards,
    uniqueSaleCount: uniqueAll.size,
    uniqueIncludedSaleCount,
    reportedCompMentions,
    rawCompMentions,
    combinedMid,
    primarySourceLabel: hasEvidence ? labels.sourceLabel : "—",
    primaryMethodLabel: hasEvidence ? labels.methodLabel : "—",
    estimateKind: hasEvidence ? labels.estimateKind : "—",
    dataQuality: hasEvidence ? labels.dataQuality : "—",
    isNswRegistered: labels.isNswRegistered,
    summaryLine,
    summaryDetail,
  };
}

/** Human copy for opening offer vs existing market value. */
export function formatOfferVsMarket(openingPremium: number | null | undefined): string {
  if (openingPremium == null || !Number.isFinite(openingPremium)) return "—";
  const pctPoints = Math.round(Math.abs(openingPremium) * 100);
  if (openingPremium === 0) return "At market";
  if (openingPremium > 0) return `${pctPoints}% above market`;
  return `${pctPoints}% below market`;
}

/** Acquisition offer cells when residual does not support a land price. */
export function unsupportedAcquisitionOfferDisplay(): {
  opening: string;
  maximum: string;
  headroom: string;
  vsMarket: string;
} {
  return {
    opening: "—",
    maximum: "—",
    headroom: "—",
    vsMarket: "—",
  };
}
