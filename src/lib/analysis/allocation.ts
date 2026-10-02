export interface AllocationLotInput {
  id: string;
  marketValue: number | null;
  areaSqm: number;
  maxOverride?: number | null;
  openingOverride?: number | null;
}

export interface AllocationLot {
  id: string;
  marketValue: number | null;
  /** Value used for weighting: entered market value, else area × fallback $/sqm. */
  weightBasis: number;
  weightEstimated: boolean;
  weight: number;
  maximumOffer: number;
  maximumOverridden: boolean;
  openingOffer: number;
  openingOverridden: boolean;
  /** (opening offer ÷ market value) − 1 */
  openingPremium: number | null;
  /** (maximum offer ÷ market value) − 1 */
  maximumPremium: number | null;
}

export interface AllocationResult {
  budget: number;
  lots: AllocationLot[];
  totalMarketValue: number;
  totalMaximum: number;
  totalOpening: number;
  unallocated: number;
  warnings: string[];
}

/**
 * Splits the maximum acquisition budget across lots in proportion to market value (default model).
 * Manual maximum overrides are honoured first; the remainder is shared by the other lots pro rata.
 * Opening offer = maximum × openingOfferPct unless overridden. Indicative only — not a valuation.
 */
export function allocateOffers(
  budget: number,
  lots: AllocationLotInput[],
  openingOfferPct: number,
  fallbackValuePerSqm: number,
): AllocationResult {
  const warnings: string[] = [];
  const basis = lots.map((l) => {
    const est = !(l.marketValue && l.marketValue > 0);
    return { l, est, v: est ? l.areaSqm * fallbackValuePerSqm : l.marketValue! };
  });
  const overriddenTotal = lots.reduce((s, l) => s + (l.maxOverride != null ? l.maxOverride : 0), 0);
  let remaining = budget - overriddenTotal;
  if (remaining < 0) {
    warnings.push("Manual maximum allocations exceed the acquisition budget.");
    remaining = 0;
  }
  const freeWeightTotal = basis.filter((b) => b.l.maxOverride == null).reduce((s, b) => s + b.v, 0);
  if (basis.some((b) => b.est)) warnings.push("Some lots have no market value entered; their weighting uses the fallback $/sqm estimate.");

  const out: AllocationLot[] = basis.map(({ l, est, v }) => {
    const maximumOffer = l.maxOverride != null ? l.maxOverride : freeWeightTotal > 0 ? (remaining * v) / freeWeightTotal : 0;
    const openingOffer = l.openingOverride != null ? l.openingOverride : maximumOffer * openingOfferPct;
    const mv = l.marketValue && l.marketValue > 0 ? l.marketValue : null;
    return {
      id: l.id,
      marketValue: mv,
      weightBasis: v,
      weightEstimated: est,
      weight: budget > 0 ? maximumOffer / budget : 0,
      maximumOffer,
      maximumOverridden: l.maxOverride != null,
      openingOffer,
      openingOverridden: l.openingOverride != null,
      openingPremium: mv ? openingOffer / mv - 1 : null,
      maximumPremium: mv ? maximumOffer / mv - 1 : null,
    };
  });
  const totalMaximum = out.reduce((s, l) => s + l.maximumOffer, 0);
  for (const l of out) if (l.openingOffer > l.maximumOffer + 0.5) warnings.push(`Opening offer exceeds the maximum modelled offer for one lot.`);
  return {
    budget,
    lots: out,
    totalMarketValue: out.reduce((s, l) => s + (l.marketValue ?? 0), 0),
    totalMaximum,
    totalOpening: out.reduce((s, l) => s + l.openingOffer, 0),
    unallocated: budget - totalMaximum,
    warnings: [...new Set(warnings)],
  };
}
