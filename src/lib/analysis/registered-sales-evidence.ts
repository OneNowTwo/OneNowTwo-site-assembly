/**
 * Read-only helpers for displaying already-persisted NSW registered-sales
 * evidence from OpportunityInputs.lotValuationDetails.
 *
 * Does NOT recompute valuations or invent ComparableSale rows.
 */

import type { OpportunityInputs } from "@/lib/analysis/assumptions";

export type LotValuationDetail = NonNullable<OpportunityInputs["lotValuationDetails"]>[string];

export type RegisteredCompEvidence = NonNullable<LotValuationDetail["comps"]>[number];

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
} {
  if (opts?.demoFinancialData) {
    return {
      sourceLabel: "Demo data",
      methodLabel: "Demo",
      estimateKind: "DEMO DATA",
      dataQuality: "Manual / demo",
    };
  }
  const provider = (detail?.provider ?? "").toUpperCase();
  const source = (detail?.source ?? opts?.marketValueSource ?? "").toUpperCase();
  const label = detail?.valuationLabel ?? "";
  const isNsw =
    provider === "NSW" ||
    source.includes("COMPARABLE") ||
    /NSW|REGISTERED/i.test(label) ||
    (detail?.numberOfComps != null && detail.numberOfComps > 0) ||
    !!detail?.comps?.length;

  if (isNsw) {
    return {
      sourceLabel: "NSW registered sales",
      methodLabel: label?.trim() || "Registered-sales weighted",
      estimateKind: "SYSTEM CALCULATION · COMPARABLE-DERIVED",
      dataQuality: "OFFICIAL / LIVE NSW DATA",
    };
  }
  if (source === "USER_ESTIMATE" || source === "MANUAL") {
    return {
      sourceLabel: "User estimate",
      methodLabel: label?.trim() || "Manual",
      estimateKind: "USER ESTIMATE",
      dataQuality: "Manual",
    };
  }
  if (source.includes("AVM") || source === "LIVE_PROVIDER") {
    return {
      sourceLabel: detail?.provider ?? "AVM",
      methodLabel: label?.trim() || "AVM",
      estimateKind: "LIVE AVM",
      dataQuality: "Live AVM",
    };
  }
  return {
    sourceLabel: detail?.provider ?? "—",
    methodLabel: label?.trim() || "—",
    estimateKind: source || "—",
    dataQuality: "—",
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
  numberOfComps: number | null;
  includedCompCount: number;
  excludedCompCount: number;
  methodLabel: string;
  sourceLabel: string;
  provider: string | null;
  checkedAt: string | null;
  subjectLastSale: LotValuationDetail["subjectLastSale"];
  comps: RegisteredCompEvidence[];
};

export type AssemblyRegisteredSalesEvidence = {
  hasEvidence: boolean;
  lotCards: LotRegisteredEvidenceCard[];
  /** Unique registered sales across the assembly (included + excluded). */
  uniqueSaleCount: number;
  /** Unique included registered sales across the assembly. */
  uniqueIncludedSaleCount: number;
  /** Sum of per-lot numberOfComps (may double-count shared sales). */
  rawCompMentions: number;
  combinedMid: number | null;
  primarySourceLabel: string;
  primaryMethodLabel: string;
  estimateKind: string;
  dataQuality: string;
  summaryLine: string;
};

function lotAddress(lot: LotLikeForEvidence): string {
  return (lot.address?.trim() || lot.label || lot.externalParcelId).trim();
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

  const lotCards: LotRegisteredEvidenceCard[] = [];

  for (const lot of includedLots) {
    const detail = details[lot.externalParcelId];
    if (!detail) continue;
    const comps = detail.comps ?? [];
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

    const mid = detail.mid ?? lot.marketValue ?? null;
    lotCards.push({
      lotId: lot.id,
      externalParcelId: lot.externalParcelId,
      label: lot.label,
      address: lotAddress(lot),
      mid,
      low: detail.low ?? lot.marketValueLow ?? null,
      high: detail.high ?? lot.marketValueHigh ?? null,
      numberOfComps: detail.numberOfComps ?? (includedCompCount || null),
      includedCompCount,
      excludedCompCount,
      methodLabel: labels.methodLabel,
      sourceLabel: labels.sourceLabel,
      provider: detail.provider ?? lot.marketValueProvider ?? null,
      checkedAt: lot.marketValueCheckedAt ?? null,
      subjectLastSale: detail.subjectLastSale ?? null,
      comps,
    });
  }

  const hasEvidence = lotCards.length > 0;
  const firstDetail = lotCards[0]
    ? details[lotCards[0].externalParcelId]
    : null;
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
  const summaryLine = hasEvidence
    ? `Existing value based on ${uniqueIncludedSaleCount} NSW registered sale${uniqueIncludedSaleCount === 1 ? "" : "s"}`
    : "No registered-sales evidence stored for this opportunity yet.";

  return {
    hasEvidence,
    lotCards,
    uniqueSaleCount: uniqueAll.size,
    uniqueIncludedSaleCount,
    rawCompMentions,
    combinedMid,
    primarySourceLabel: hasEvidence ? labels.sourceLabel : "—",
    primaryMethodLabel: hasEvidence ? labels.methodLabel : "—",
    estimateKind: hasEvidence ? labels.estimateKind : "—",
    dataQuality: hasEvidence ? labels.dataQuality : "—",
    summaryLine,
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
