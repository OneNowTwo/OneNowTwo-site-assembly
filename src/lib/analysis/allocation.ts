export interface AllocationLotInput {
  id: string;
  marketValue: number | null;
  areaSqm: number;
  maxOverride?: number | null;
  openingOverride?: number | null;
  /** 0–1 criticality score (1 = critical connector). */
  criticalityScore?: number;
  /** Graph degree within the assembly (connectivity). */
  connectivityScore?: number;
  /** Manual strategic weight multiplier (default 1). */
  strategicWeight?: number | null;
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
  /** Maximum modelled offer − opening offer. */
  negotiationHeadroom: number;
  /** Opening offer − market value ($). */
  ownerPremiumAmount: number | null;
  /** (opening offer ÷ market value) − 1 */
  openingPremium: number | null;
  /** (maximum offer ÷ market value) − 1 */
  maximumPremium: number | null;
  /** Alias of openingPremium for product copy. */
  ownerPremiumPercent: number | null;
}

export interface AllocationResult {
  budget: number;
  lots: AllocationLot[];
  totalMarketValue: number;
  totalMaximum: number;
  totalOpening: number;
  totalNegotiationHeadroom: number;
  averagePremiumToMarket: number | null;
  unallocated: number;
  warnings: string[];
}

export interface AllocationWeights {
  marketValueWeight: number;
  criticalityWeight: number;
  connectivityWeight: number;
}

/**
 * Splits the maximum acquisition budget across lots with optional strategic weighting.
 * Default: proportional to existing market value, with optional criticality / connectivity / manual weights.
 * Opening offer = maximum × openingOfferPct unless overridden.
 * Negotiation headroom = maximum − opening.
 */
export function allocateOffers(
  budget: number,
  lots: AllocationLotInput[],
  openingOfferPct: number,
  fallbackValuePerSqm: number,
  weights: AllocationWeights = { marketValueWeight: 1, criticalityWeight: 0, connectivityWeight: 0 },
): AllocationResult {
  const warnings: string[] = [];
  const wMv = Math.max(0, weights.marketValueWeight);
  const wCrit = Math.max(0, weights.criticalityWeight);
  const wConn = Math.max(0, weights.connectivityWeight);
  const maxDegree = Math.max(1, ...lots.map((l) => l.connectivityScore ?? 0));

  const basis = lots.map((l) => {
    const est = !(l.marketValue && l.marketValue > 0);
    const mv = est ? l.areaSqm * fallbackValuePerSqm : l.marketValue!;
    const crit = Math.max(0, Math.min(1, l.criticalityScore ?? 0));
    const conn = (l.connectivityScore ?? 0) / maxDegree;
    const strategic = l.strategicWeight != null && l.strategicWeight > 0 ? l.strategicWeight : 1;
    const composite = (wMv * mv + wCrit * mv * crit + wConn * mv * conn) * strategic;
    return { l, est, v: mv, composite: Math.max(composite, 0) };
  });

  const overriddenTotal = lots.reduce((s, l) => s + (l.maxOverride != null ? l.maxOverride : 0), 0);
  let remaining = budget - overriddenTotal;
  if (remaining < 0) {
    warnings.push("Manual maximum allocations exceed the acquisition budget.");
    remaining = 0;
  }
  const freeWeightTotal = basis.filter((b) => b.l.maxOverride == null).reduce((s, b) => s + b.composite, 0);
  if (basis.some((b) => b.est)) warnings.push("Some lots have no market value entered; their weighting uses the fallback $/sqm estimate.");
  if (wCrit > 0 || wConn > 0) warnings.push("Offer allocation uses strategic weighting (market value + criticality + connectivity).");

  const out: AllocationLot[] = basis.map(({ l, est, v, composite }) => {
    const maximumOffer = l.maxOverride != null ? l.maxOverride : freeWeightTotal > 0 ? (remaining * composite) / freeWeightTotal : 0;
    const openingOffer = l.openingOverride != null ? l.openingOverride : maximumOffer * openingOfferPct;
    const mv = l.marketValue && l.marketValue > 0 ? l.marketValue : null;
    const openingPremium = mv ? openingOffer / mv - 1 : null;
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
      negotiationHeadroom: maximumOffer - openingOffer,
      ownerPremiumAmount: mv != null ? openingOffer - mv : null,
      openingPremium,
      maximumPremium: mv ? maximumOffer / mv - 1 : null,
      ownerPremiumPercent: openingPremium,
    };
  });
  const totalMaximum = out.reduce((s, l) => s + l.maximumOffer, 0);
  const totalOpening = out.reduce((s, l) => s + l.openingOffer, 0);
  const totalMarketValue = out.reduce((s, l) => s + (l.marketValue ?? 0), 0);
  for (const l of out) if (l.openingOffer > l.maximumOffer + 0.5) warnings.push(`Opening offer exceeds the maximum modelled offer for one lot.`);
  return {
    budget,
    lots: out,
    totalMarketValue,
    totalMaximum,
    totalOpening,
    totalNegotiationHeadroom: out.reduce((s, l) => s + l.negotiationHeadroom, 0),
    averagePremiumToMarket: totalMarketValue > 0 ? totalOpening / totalMarketValue - 1 : null,
    unallocated: budget - totalMaximum,
    warnings: [...new Set(warnings)],
  };
}
