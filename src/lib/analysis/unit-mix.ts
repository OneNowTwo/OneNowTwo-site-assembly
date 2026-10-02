/**
 * Residential unit mix — primary GRV method for apartments.
 * Unit revenue = count × sale price per unit; GRV = sum of unit revenues (+ other project revenue).
 */

export interface UnitMixRow {
  id?: string;
  name: string;
  count: number;
  avgInternalArea: number;
  avgExternalArea: number;
  avgSaleableArea: number;
  salePricePerUnit: number;
}

export interface UnitMixTotals {
  totalUnits: number;
  totalSaleableArea: number;
  totalRevenue: number;
  averageSalePrice: number | null;
  /** Blended $/sqm = total revenue ÷ total saleable area (sanity check vs comps). */
  blendedPricePerSqm: number | null;
  rows: Array<
    UnitMixRow & {
      pricePerSqm: number | null;
      revenue: number;
    }
  >;
}

export const DEFAULT_UNIT_MIX_TEMPLATE: UnitMixRow[] = [
  { name: "Studio", count: 0, avgInternalArea: 40, avgExternalArea: 4, avgSaleableArea: 44, salePricePerUnit: 750_000 },
  { name: "1 Bed", count: 0, avgInternalArea: 55, avgExternalArea: 8, avgSaleableArea: 58, salePricePerUnit: 1_100_000 },
  { name: "2 Bed", count: 0, avgInternalArea: 80, avgExternalArea: 12, avgSaleableArea: 88, salePricePerUnit: 1_650_000 },
  { name: "3 Bed", count: 0, avgInternalArea: 110, avgExternalArea: 15, avgSaleableArea: 125, salePricePerUnit: 2_450_000 },
  { name: "4 Bed", count: 0, avgInternalArea: 140, avgExternalArea: 20, avgSaleableArea: 160, salePricePerUnit: 3_200_000 },
  { name: "Penthouse", count: 0, avgInternalArea: 160, avgExternalArea: 40, avgSaleableArea: 180, salePricePerUnit: 4_200_000 },
];

/** Default mix shares used by auto-generate (user-editable). */
export const DEFAULT_MIX_SHARES: Record<string, number> = {
  Studio: 0,
  "1 Bed": 0.2,
  "2 Bed": 0.5,
  "3 Bed": 0.25,
  "4 Bed": 0,
  Penthouse: 0.05,
};

export function computeUnitMix(rows: UnitMixRow[]): UnitMixTotals {
  const computed = rows.map((r) => {
    const saleable = r.avgSaleableArea > 0 ? r.avgSaleableArea : r.avgInternalArea + r.avgExternalArea;
    const revenue = Math.max(0, r.count) * Math.max(0, r.salePricePerUnit);
    const pricePerSqm = saleable > 0 && r.salePricePerUnit > 0 ? r.salePricePerUnit / saleable : null;
    return { ...r, avgSaleableArea: saleable, pricePerSqm, revenue };
  });
  const totalUnits = computed.reduce((s, r) => s + r.count, 0);
  const totalSaleableArea = computed.reduce((s, r) => s + r.count * r.avgSaleableArea, 0);
  const totalRevenue = computed.reduce((s, r) => s + r.revenue, 0);
  return {
    totalUnits,
    totalSaleableArea,
    totalRevenue,
    averageSalePrice: totalUnits > 0 ? totalRevenue / totalUnits : null,
    blendedPricePerSqm: totalSaleableArea > 0 ? totalRevenue / totalSaleableArea : null,
    rows: computed,
  };
}

/**
 * Allocate an indicative mix across available saleable area using share percentages.
 * Counts are integers; residual area is absorbed by rounding — user must edit afterwards.
 */
export function autoGenerateUnitMix(
  saleableAreaSqm: number,
  template: UnitMixRow[] = DEFAULT_UNIT_MIX_TEMPLATE,
  shares: Record<string, number> = DEFAULT_MIX_SHARES,
): UnitMixRow[] {
  const active = template.map((t) => ({ ...t, share: shares[t.name] ?? 0 })).filter((t) => t.share > 0 && t.avgSaleableArea > 0);
  const shareSum = active.reduce((s, t) => s + t.share, 0) || 1;
  const rows = template.map((t) => {
    const share = (shares[t.name] ?? 0) / shareSum;
    if (share <= 0 || t.avgSaleableArea <= 0) return { ...t, count: 0 };
    const targetArea = saleableAreaSqm * share;
    return { ...t, count: Math.max(0, Math.round(targetArea / t.avgSaleableArea)) };
  });
  // Nudge the largest share type so total saleable ≈ target (within one unit).
  const totals = computeUnitMix(rows);
  const delta = saleableAreaSqm - totals.totalSaleableArea;
  const primary = rows.reduce((best, r, i) => ((shares[r.name] ?? 0) > (shares[rows[best].name] ?? 0) ? i : best), 0);
  if (rows[primary]?.avgSaleableArea > 0 && Math.abs(delta) > rows[primary].avgSaleableArea * 0.4) {
    rows[primary] = {
      ...rows[primary],
      count: Math.max(0, rows[primary].count + Math.round(delta / rows[primary].avgSaleableArea)),
    };
  }
  return rows;
}

/** Typical exit-comp summary by unit type name (included comps only). */
export function summariseExitCompsByType(
  comps: { unitType: string | null; bedrooms: number | null; salePrice: number; saleableArea: number | null; included: boolean }[],
): Record<string, { count: number; typicalSale: number; typicalSize: number | null; indicativePerSqm: number | null }> {
  const buckets = new Map<string, { prices: number[]; sizes: number[] }>();
  for (const c of comps.filter((x) => x.included)) {
    const key =
      c.unitType?.trim() ||
      (c.bedrooms == null ? "Other" : c.bedrooms === 0 ? "Studio" : c.bedrooms >= 4 ? "Penthouse" : `${c.bedrooms} Bed`);
    const b = buckets.get(key) ?? { prices: [], sizes: [] };
    b.prices.push(c.salePrice);
    if (c.saleableArea && c.saleableArea > 0) b.sizes.push(c.saleableArea);
    buckets.set(key, b);
  }
  const out: Record<string, { count: number; typicalSale: number; typicalSize: number | null; indicativePerSqm: number | null }> = {};
  for (const [k, b] of buckets) {
    const typicalSale = b.prices.reduce((s, n) => s + n, 0) / b.prices.length;
    const typicalSize = b.sizes.length ? b.sizes.reduce((s, n) => s + n, 0) / b.sizes.length : null;
    out[k] = {
      count: b.prices.length,
      typicalSale,
      typicalSize,
      indicativePerSqm: typicalSize && typicalSize > 0 ? typicalSale / typicalSize : null,
    };
  }
  return out;
}

/** Suggested acquisition market value from included acquisition comps (median). */
export function suggestedMarketValueFromComps(prices: number[]): number | null {
  if (!prices.length) return null;
  const sorted = [...prices].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
