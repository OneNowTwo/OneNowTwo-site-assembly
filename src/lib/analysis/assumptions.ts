import { z } from "zod";
import { DEFAULT_UNIT_MIX_TEMPLATE, type UnitMixRow } from "./unit-mix";

const pct = z.number().min(0).max(5);
const money = z.number().min(0);

export const unitMixRowSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(40),
  count: z.number().int().min(0).max(500),
  avgInternalArea: money,
  avgExternalArea: money,
  avgSaleableArea: money,
  salePricePerUnit: money,
});

export const assumptionsSchema = z.object({
  // Profit target
  targetBasis: z.enum(["COST", "REVENUE"]),
  targetMarginOnCost: pct,
  targetMarginOnRevenue: z.number().min(0).max(0.95),
  // Yield — theoretical vs achievable
  efficiency: z.number().min(0.3).max(1),
  siteCoverage: z.number().min(0.1).max(1),
  floorToFloorM: z.number().min(2.5).max(6),
  avgDwellingSizeSqm: z.number().min(25).max(400),
  carSpacesPerDwelling: z.number().min(0).max(4),
  /** Planning / site efficiency adjustment applied to theoretical GFA (e.g. 0.9 = 90%). */
  planningAdjustment: z.number().min(0.3).max(1),
  // Revenue — UNIT_MIX is recommended for residential
  revenueMode: z.enum(["UNIT_MIX", "PER_SQM", "PER_DWELLING"]),
  salePricePerSqm: money,
  avgDwellingPrice: money,
  otherRevenue: money,
  // Construction — base rate is a USER ASSUMPTION unless a cost provider is connected
  constructionCostPerSqm: money,
  basementParkingCost: money,
  demolitionPerLot: money,
  siteWorksCost: money,
  remediationCost: money,
  difficultExcavationCost: money,
  premiumFacadeCost: money,
  liftsCost: money,
  publicDomainWorksCost: money,
  landscapingCost: money,
  otherFixedConstructionCost: money,
  consultantsPct: pct,
  statutoryFeesPerDwelling: money,
  marketingPct: pct,
  sellingCostPct: pct,
  contingencyPct: pct,
  /** Development finance on non-land development costs (not land holding). */
  financePct: pct,
  /** Land holding / acquisition finance as % of purchase price. */
  landFinancePct: pct,
  acquisitionCostPct: pct,
  otherCosts: money,
  // Acquisition / discovery
  openingOfferPct: z.number().min(0.1).max(1),
  /** Relative weights for offer allocation (normalised at runtime). */
  marketValueWeight: z.number().min(0).max(10),
  criticalityWeight: z.number().min(0).max(10),
  connectivityWeight: z.number().min(0).max(10),
  minViableSiteAreaSqm: money,
  maxAssemblySize: z.number().int().min(2).max(8),
  fallbackFsr: z.number().min(0).max(20),
  existingValuePerSqm: money,
});

export type Assumptions = z.infer<typeof assumptionsSchema>;

/** Indicative Sydney metro residential defaults (Oct 2026). Every value is an editable assumption, not market advice. */
export const DEFAULT_ASSUMPTIONS: Assumptions = {
  targetBasis: "COST",
  targetMarginOnCost: 0.2,
  targetMarginOnRevenue: 0.17,
  efficiency: 0.82,
  siteCoverage: 0.45,
  floorToFloorM: 3.1,
  avgDwellingSizeSqm: 85,
  carSpacesPerDwelling: 1,
  planningAdjustment: 0.9,
  revenueMode: "UNIT_MIX",
  salePricePerSqm: 15500,
  avgDwellingPrice: 1_300_000,
  otherRevenue: 0,
  constructionCostPerSqm: 4600,
  basementParkingCost: 0,
  demolitionPerLot: 60_000,
  siteWorksCost: 0,
  remediationCost: 0,
  difficultExcavationCost: 0,
  premiumFacadeCost: 0,
  liftsCost: 0,
  publicDomainWorksCost: 0,
  landscapingCost: 0,
  otherFixedConstructionCost: 0,
  consultantsPct: 0.08,
  statutoryFeesPerDwelling: 25_000,
  marketingPct: 0.015,
  sellingCostPct: 0.025,
  contingencyPct: 0.05,
  financePct: 0.065,
  landFinancePct: 0.07,
  acquisitionCostPct: 0.055,
  otherCosts: 0,
  openingOfferPct: 0.85,
  marketValueWeight: 1,
  criticalityWeight: 0.35,
  connectivityWeight: 0.15,
  minViableSiteAreaSqm: 1500,
  maxAssemblySize: 6,
  fallbackFsr: 0.5,
  existingValuePerSqm: 2600,
};

export const ASSUMPTION_META: Record<
  keyof Assumptions,
  { label: string; unit: "pct" | "money" | "sqm" | "m" | "ratio" | "count" | "enum" | "moneyPerSqm"; group: string; help?: string }
> = {
  targetBasis: { label: "Profit target basis", unit: "enum", group: "Profit target", help: "Solve the residual on margin on cost or margin on revenue" },
  targetMarginOnCost: { label: "Target margin on cost (MOC)", unit: "pct", group: "Profit target", help: "Profit ÷ total development cost. 20% MOC = $0.20 profit per $1.00 of cost." },
  targetMarginOnRevenue: { label: "Target margin on revenue", unit: "pct", group: "Profit target" },
  efficiency: { label: "Saleable efficiency (NSA / GFA)", unit: "pct", group: "Yield" },
  siteCoverage: { label: "Site coverage", unit: "pct", group: "Yield" },
  floorToFloorM: { label: "Floor-to-floor height", unit: "m", group: "Yield" },
  avgDwellingSizeSqm: { label: "Average dwelling size (fallback)", unit: "sqm", group: "Yield" },
  carSpacesPerDwelling: { label: "Car spaces per dwelling", unit: "ratio", group: "Yield" },
  planningAdjustment: { label: "Planning / site efficiency adjustment", unit: "pct", group: "Yield", help: "Applied to theoretical GFA to estimate achievable GFA (not an architect test-fit)." },
  revenueMode: { label: "Revenue method", unit: "enum", group: "Revenue", help: "UNIT_MIX recommended for residential; $/sqm useful for early-stage cross-check." },
  salePricePerSqm: { label: "Average sale price ($/sqm saleable)", unit: "moneyPerSqm", group: "Revenue" },
  avgDwellingPrice: { label: "Average dwelling price", unit: "money", group: "Revenue" },
  otherRevenue: { label: "Other project revenue", unit: "money", group: "Revenue" },
  constructionCostPerSqm: { label: "Base build cost ($/sqm GFA)", unit: "moneyPerSqm", group: "Costs", help: "USER ASSUMPTION unless a construction cost provider is connected." },
  basementParkingCost: { label: "Basement parking (fixed)", unit: "money", group: "Costs" },
  demolitionPerLot: { label: "Demolition & site prep (per lot)", unit: "money", group: "Costs" },
  siteWorksCost: { label: "Site works (fixed)", unit: "money", group: "Costs" },
  remediationCost: { label: "Remediation (fixed)", unit: "money", group: "Costs" },
  difficultExcavationCost: { label: "Difficult excavation (fixed)", unit: "money", group: "Costs" },
  premiumFacadeCost: { label: "Premium façade (fixed)", unit: "money", group: "Costs" },
  liftsCost: { label: "Lifts (fixed)", unit: "money", group: "Costs" },
  publicDomainWorksCost: { label: "Public domain works (fixed)", unit: "money", group: "Costs" },
  landscapingCost: { label: "Landscaping (fixed)", unit: "money", group: "Costs" },
  otherFixedConstructionCost: { label: "Other fixed construction", unit: "money", group: "Costs" },
  consultantsPct: { label: "Consultants (% construction)", unit: "pct", group: "Costs" },
  statutoryFeesPerDwelling: { label: "Authority / statutory fees (per dwelling)", unit: "money", group: "Costs" },
  marketingPct: { label: "Marketing (% GRV)", unit: "pct", group: "Costs" },
  sellingCostPct: { label: "Selling costs / agency (% GRV)", unit: "pct", group: "Costs" },
  contingencyPct: { label: "Contingency (% construction, demolition, consultants)", unit: "pct", group: "Costs" },
  financePct: { label: "Development finance (% non-land costs)", unit: "pct", group: "Costs", help: "Construction/development finance — separate from land holding." },
  landFinancePct: { label: "Land holding / acquisition finance (% purchase price)", unit: "pct", group: "Costs" },
  acquisitionCostPct: { label: "Acquisition costs — duty, legal (% purchase price)", unit: "pct", group: "Costs" },
  otherCosts: { label: "Other costs", unit: "money", group: "Costs" },
  openingOfferPct: { label: "Opening offer (% of maximum allocation)", unit: "pct", group: "Acquisition" },
  marketValueWeight: { label: "Market value weight (offer allocation)", unit: "ratio", group: "Acquisition" },
  criticalityWeight: { label: "Criticality weight (offer allocation)", unit: "ratio", group: "Acquisition" },
  connectivityWeight: { label: "Connectivity weight (offer allocation)", unit: "ratio", group: "Acquisition" },
  minViableSiteAreaSqm: { label: "Minimum viable site area", unit: "sqm", group: "Acquisition" },
  maxAssemblySize: { label: "Max lots in automatic assembly", unit: "count", group: "Acquisition" },
  fallbackFsr: { label: "Discovery-only FSR assumption where none mapped (never shown as official)", unit: "ratio", group: "Discovery", help: "Used only if allowAssumption is explicitly enabled for ranking. Official yield never silently uses this." },
  existingValuePerSqm: {
    label: "Rough screening $/sqm (NOT for acquisition decisions)",
    unit: "moneyPerSqm",
    group: "Discovery",
    help: "Suburb fallback only. Never drives trusted headroom — enter USER / AVM / comps values per lot.",
  },
};

export function mergeAssumptions(global: unknown, overrides?: unknown): Assumptions {
  const g = assumptionsSchema.partial().safeParse(global ?? {});
  const o = assumptionsSchema.partial().safeParse(overrides ?? {});
  return { ...DEFAULT_ASSUMPTIONS, ...(g.success ? g.data : {}), ...(o.success ? o.data : {}) };
}

export const scenarioAdjustmentSchema = z.object({
  salePricePct: z.number().min(-0.9).max(2),
  buildCostPct: z.number().min(-0.9).max(2),
  fsrPct: z.number().min(-0.9).max(2),
  /** Existing property / acquisition market value adjustment. */
  existingValuePct: z.number().min(-0.9).max(2).default(0),
  financePctPoints: z.number().min(-0.2).max(0.2),
  targetMarginPctPoints: z.number().min(-0.5).max(0.5),
});
export type ScenarioAdjustment = z.infer<typeof scenarioAdjustmentSchema>;

export const DEFAULT_SCENARIOS: Record<"BASE" | "UPSIDE" | "DOWNSIDE", ScenarioAdjustment> = {
  BASE: { salePricePct: 0, buildCostPct: 0, fsrPct: 0, existingValuePct: 0, financePctPoints: 0, targetMarginPctPoints: 0 },
  UPSIDE: { salePricePct: 0.07, buildCostPct: -0.04, fsrPct: 0.05, existingValuePct: -0.03, financePctPoints: -0.01, targetMarginPctPoints: -0.02 },
  DOWNSIDE: { salePricePct: -0.075, buildCostPct: 0.08, fsrPct: -0.05, existingValuePct: 0.05, financePctPoints: 0.015, targetMarginPctPoints: 0.03 },
};

export const scanProvenanceSchema = z.object({
  originType: z.literal("AREA_SCAN"),
  scanSessionId: z.string(),
  assemblyFamilyId: z.string().nullable().optional(),
  assemblyKey: z.string(),
  scanRank: z.number().int().positive().nullable().optional(),
  scanCalculatedAt: z.string(),
  calculationVersion: z.string(),
  /** Exact financial/planning snapshot from the scan card at Analyse time. */
  scanCalculationSnapshot: z.record(z.string(), z.unknown()),
  mapRestore: z
    .object({
      lat: z.number(),
      lng: z.number(),
      zoom: z.number(),
      query: z.string().optional(),
      scanQuery: z.string().optional(),
    })
    .optional(),
});
export type ScanProvenance = z.infer<typeof scanProvenanceSchema>;

/** Per-opportunity inputs persisted in Opportunity.inputs. */
export const opportunityInputsSchema = z.object({
  overrides: assumptionsSchema.partial().default({}),
  siteAreaOverride: z.number().positive().nullable().default(null),
  fsrOverride: z.number().positive().nullable().default(null),
  /** Why fsrOverride was set — SCAN_MODELLED keeps provisional LMR; USER is manual. */
  fsrOverrideKind: z.enum(["SCAN_MODELLED", "USER", "NONE"]).default("NONE"),
  fsrOverrideCertainty: z.string().nullable().default(null),
  /** Persisted LEP vs State pathway split for consistent Analyse / Yield / Planning display. */
  pathwaySnapshot: z
    .object({
      lepFsr: z.number().nullable(),
      statePathwayFsr: z.number().nullable(),
      statePathwayName: z.string().nullable(),
      modelledFsr: z.number().nullable(),
      certainty: z.string(),
      lmrCentre: z.string().nullable(),
      nearestDistanceM: z.number().nullable(),
      furthestDistanceM: z.number().nullable(),
      proximityScreen: z.enum(["PASS", "FAIL", "MIXED", "NONE"]),
      proximityLabel: z.string().nullable(),
    })
    .nullable()
    .default(null),
  heightOverrideM: z.number().positive().nullable().default(null),
  /** Manual override of indicative achievable GFA (null = system estimate). */
  achievableGfaOverride: z.number().positive().nullable().default(null),
  unitMix: z.array(unitMixRowSchema).default([]),
  mixShares: z.record(z.string(), z.number()).optional(),
  scenarios: z
    .object({ BASE: scenarioAdjustmentSchema, UPSIDE: scenarioAdjustmentSchema, DOWNSIDE: scenarioAdjustmentSchema })
    .default(DEFAULT_SCENARIOS),
  contactDetails: z.string().max(300).default(""),
  scanProvenance: scanProvenanceSchema.nullable().default(null),
  /** Transparent NSW comps / valuation detail keyed by externalParcelId. */
  lotValuationDetails: z
    .record(
      z.string(),
      z.object({
        mid: z.number().nullable().optional(),
        low: z.number().nullable().optional(),
        high: z.number().nullable().optional(),
        confidence: z.string().optional(),
        source: z.string().optional(),
        provider: z.string().nullable().optional(),
        numberOfComps: z.number().nullable().optional(),
        valuationLabel: z.string().nullable().optional(),
        subjectLastSale: z
          .object({
            address: z.string(),
            salePrice: z.number(),
            saleDate: z.string().nullable(),
            landAreaSqm: z.number().nullable(),
            source: z.string(),
          })
          .nullable()
          .optional(),
        comps: z
          .array(
            z.object({
              id: z.string(),
              address: z.string(),
              salePrice: z.number(),
              saleDate: z.string().nullable(),
              landAreaSqm: z.number().nullable(),
              distanceM: z.number(),
              similarity: z.number(),
              included: z.boolean(),
              excludeReason: z.string().nullable().optional(),
              source: z.string(),
              dealing: z.string().nullable().optional(),
            }),
          )
          .optional(),
      }),
    )
    .default({}),
});
export type OpportunityInputs = z.infer<typeof opportunityInputsSchema>;

export function parseOpportunityInputs(raw: unknown): OpportunityInputs {
  const r = opportunityInputsSchema.safeParse(raw ?? {});
  if (r.success) {
    // Back-compat: older scenarios omit existingValuePct
    const scenarios = { ...r.data.scenarios };
    for (const k of ["BASE", "UPSIDE", "DOWNSIDE"] as const) {
      scenarios[k] = { ...DEFAULT_SCENARIOS[k], ...scenarios[k], existingValuePct: scenarios[k].existingValuePct ?? 0 };
    }
    return { ...r.data, scenarios };
  }
  return opportunityInputsSchema.parse({});
}

export function defaultUnitMix(): UnitMixRow[] {
  return DEFAULT_UNIT_MIX_TEMPLATE.map((r) => ({ ...r }));
}
