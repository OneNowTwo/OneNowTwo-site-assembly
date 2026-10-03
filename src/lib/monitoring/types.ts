import { z } from "zod";

export const watchFiltersSchema = z.object({
  minSiteAreaSqm: z.number().nonnegative().optional(),
  minHeadroom: z.number().optional(),
  minHeadroomPct: z.number().optional(),
  minScore: z.number().int().min(0).max(100).optional(),
  developmentType: z.string().optional(),
  zoning: z.array(z.string()).optional(),
  minLots: z.number().int().positive().optional(),
  maxLots: z.number().int().positive().optional(),
  pathway: z.enum(["LMR", "TOD", "ANY_STATE", "NONE"]).optional(),
  maxExistingValue: z.number().optional(),
  minMaxPayableUplift: z.number().optional(),
});

export type WatchFilters = z.infer<typeof watchFiltersSchema>;

export const alertCriteriaSchema = z.object({
  suburb: z.string().optional(),
  minScore: z.number().int().optional(),
  minHeadroom: z.number().optional(),
  minHeadroomPct: z.number().optional(),
  becomesViable: z.boolean().optional(),
  pathwayIdentified: z.boolean().optional(),
  minLots: z.number().int().optional(),
  newAssembly: z.boolean().optional(),
  watchItemId: z.string().optional(),
});

export type AlertCriteria = z.infer<typeof alertCriteriaSchema>;

export function opportunityMatchesCriteria(
  opp: {
    suburb?: string | null;
    score?: number | null;
    acquisitionHeadroom?: number | null;
    acquisitionHeadroomPercent?: number | null;
    lotCount?: number;
    pathway?: string | null;
    wasNonViable?: boolean;
    isNew?: boolean;
  },
  criteria: AlertCriteria,
): boolean {
  if (criteria.suburb && (opp.suburb ?? "").toLowerCase() !== criteria.suburb.toLowerCase()) return false;
  if (criteria.minScore != null && (opp.score ?? 0) < criteria.minScore) return false;
  if (criteria.minHeadroom != null && (opp.acquisitionHeadroom ?? Number.NEGATIVE_INFINITY) < criteria.minHeadroom) return false;
  if (criteria.minHeadroomPct != null && (opp.acquisitionHeadroomPercent ?? Number.NEGATIVE_INFINITY) < criteria.minHeadroomPct) return false;
  if (criteria.minLots != null && (opp.lotCount ?? 0) < criteria.minLots) return false;
  if (criteria.pathwayIdentified && !(opp.pathway && opp.pathway.length > 0)) return false;
  if (criteria.becomesViable && !(opp.wasNonViable && (opp.acquisitionHeadroom ?? 0) > 0)) return false;
  if (criteria.newAssembly && !opp.isNew) return false;
  return true;
}

export const bboxSchema = z.object({
  west: z.number(),
  south: z.number(),
  east: z.number(),
  north: z.number(),
});

export type BBoxJson = z.infer<typeof bboxSchema>;

export function matchesWatchFilters(
  row: {
    totalSiteArea?: number | null;
    acquisitionHeadroom?: number | null;
    acquisitionHeadroomPercent?: number | null;
    score?: number | null;
    combinedMarketValue?: number | null;
    maxLandBudget?: number | null;
    lotCount?: number;
    zone?: string | null;
    pathway?: string | null;
  },
  filters: WatchFilters,
): boolean {
  if (filters.minSiteAreaSqm != null && (row.totalSiteArea ?? 0) < filters.minSiteAreaSqm) return false;
  if (filters.minHeadroom != null && (row.acquisitionHeadroom ?? Number.NEGATIVE_INFINITY) < filters.minHeadroom) return false;
  if (filters.minHeadroomPct != null && (row.acquisitionHeadroomPercent ?? Number.NEGATIVE_INFINITY) < filters.minHeadroomPct) return false;
  if (filters.minScore != null && (row.score ?? 0) < filters.minScore) return false;
  if (filters.maxExistingValue != null && (row.combinedMarketValue ?? 0) > filters.maxExistingValue) return false;
  if (filters.minLots != null && (row.lotCount ?? 0) < filters.minLots) return false;
  if (filters.maxLots != null && (row.lotCount ?? 0) > filters.maxLots) return false;
  if (filters.zoning?.length && row.zone && !filters.zoning.some((z) => row.zone!.toUpperCase().includes(z.toUpperCase()))) return false;
  if (filters.pathway && filters.pathway !== "NONE") {
    const p = (row.pathway ?? "").toUpperCase();
    if (filters.pathway === "LMR" && !p.includes("LMR")) return false;
    if (filters.pathway === "TOD" && !p.includes("TOD")) return false;
    if (filters.pathway === "ANY_STATE" && !p) return false;
  }
  if (filters.minMaxPayableUplift != null) {
    const existing = row.combinedMarketValue ?? 0;
    const maxPay = row.maxLandBudget ?? 0;
    if (existing <= 0 || (maxPay - existing) / existing < filters.minMaxPayableUplift) return false;
  }
  return true;
}
