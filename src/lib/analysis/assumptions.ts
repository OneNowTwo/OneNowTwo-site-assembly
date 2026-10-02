import { z } from "zod";

const pct = z.number().min(0).max(5);
const money = z.number().min(0);

export const assumptionsSchema = z.object({
  // Profit target
  targetBasis: z.enum(["COST", "REVENUE"]),
  targetMarginOnCost: pct,
  targetMarginOnRevenue: z.number().min(0).max(0.95),
  // Yield
  efficiency: z.number().min(0.3).max(1),
  siteCoverage: z.number().min(0.1).max(1),
  floorToFloorM: z.number().min(2.5).max(6),
  avgDwellingSizeSqm: z.number().min(25).max(400),
  carSpacesPerDwelling: z.number().min(0).max(4),
  // Revenue
  revenueMode: z.enum(["PER_SQM", "PER_DWELLING"]),
  salePricePerSqm: money,
  avgDwellingPrice: money,
  otherRevenue: money,
  // Costs
  constructionCostPerSqm: money,
  demolitionPerLot: money,
  consultantsPct: pct,
  statutoryFeesPerDwelling: money,
  marketingPct: pct,
  sellingCostPct: pct,
  contingencyPct: pct,
  financePct: pct,
  landFinancePct: pct,
  acquisitionCostPct: pct,
  otherCosts: money,
  // Acquisition / discovery
  openingOfferPct: z.number().min(0.1).max(1),
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
  efficiency: 0.8,
  siteCoverage: 0.45,
  floorToFloorM: 3.1,
  avgDwellingSizeSqm: 85,
  carSpacesPerDwelling: 1,
  revenueMode: "PER_SQM",
  salePricePerSqm: 15500,
  avgDwellingPrice: 1_300_000,
  otherRevenue: 0,
  constructionCostPerSqm: 4600,
  demolitionPerLot: 60_000,
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
  minViableSiteAreaSqm: 1500,
  maxAssemblySize: 6,
  fallbackFsr: 0.5,
  existingValuePerSqm: 2600,
};

export const ASSUMPTION_META: Record<keyof Assumptions, { label: string; unit: "pct" | "money" | "sqm" | "m" | "ratio" | "count" | "enum" | "moneyPerSqm"; group: string; help?: string }> = {
  targetBasis: { label: "Profit target basis", unit: "enum", group: "Profit target", help: "Solve the residual on margin on cost or margin on revenue" },
  targetMarginOnCost: { label: "Target margin on cost", unit: "pct", group: "Profit target" },
  targetMarginOnRevenue: { label: "Target margin on revenue", unit: "pct", group: "Profit target" },
  efficiency: { label: "Saleable efficiency (NSA / GFA)", unit: "pct", group: "Yield" },
  siteCoverage: { label: "Site coverage", unit: "pct", group: "Yield" },
  floorToFloorM: { label: "Floor-to-floor height", unit: "m", group: "Yield" },
  avgDwellingSizeSqm: { label: "Average dwelling size", unit: "sqm", group: "Yield" },
  carSpacesPerDwelling: { label: "Car spaces per dwelling", unit: "ratio", group: "Yield" },
  revenueMode: { label: "Revenue basis", unit: "enum", group: "Revenue" },
  salePricePerSqm: { label: "Average sale price ($/sqm saleable)", unit: "moneyPerSqm", group: "Revenue" },
  avgDwellingPrice: { label: "Average dwelling price", unit: "money", group: "Revenue" },
  otherRevenue: { label: "Other revenue", unit: "money", group: "Revenue" },
  constructionCostPerSqm: { label: "Construction cost ($/sqm GFA)", unit: "moneyPerSqm", group: "Costs" },
  demolitionPerLot: { label: "Demolition & site prep (per lot)", unit: "money", group: "Costs" },
  consultantsPct: { label: "Consultants (% construction)", unit: "pct", group: "Costs" },
  statutoryFeesPerDwelling: { label: "Authority / statutory fees (per dwelling)", unit: "money", group: "Costs" },
  marketingPct: { label: "Marketing (% GRV)", unit: "pct", group: "Costs" },
  sellingCostPct: { label: "Selling costs / agency (% GRV)", unit: "pct", group: "Costs" },
  contingencyPct: { label: "Contingency (% construction, demolition, consultants)", unit: "pct", group: "Costs" },
  financePct: { label: "Development finance (% non-land costs)", unit: "pct", group: "Costs" },
  landFinancePct: { label: "Land holding / finance (% purchase price)", unit: "pct", group: "Costs" },
  acquisitionCostPct: { label: "Acquisition costs — duty, legal (% purchase price)", unit: "pct", group: "Costs" },
  otherCosts: { label: "Other costs", unit: "money", group: "Costs" },
  openingOfferPct: { label: "Opening offer (% of maximum allocation)", unit: "pct", group: "Acquisition" },
  minViableSiteAreaSqm: { label: "Minimum viable site area", unit: "sqm", group: "Acquisition" },
  maxAssemblySize: { label: "Max lots in automatic assembly", unit: "count", group: "Acquisition" },
  fallbackFsr: { label: "Fallback FSR where none mapped (system estimate)", unit: "ratio", group: "Discovery" },
  existingValuePerSqm: { label: "Existing value estimate where none entered ($/sqm land)", unit: "moneyPerSqm", group: "Discovery" },
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
  financePctPoints: z.number().min(-0.2).max(0.2),
  targetMarginPctPoints: z.number().min(-0.5).max(0.5),
});
export type ScenarioAdjustment = z.infer<typeof scenarioAdjustmentSchema>;

export const DEFAULT_SCENARIOS: Record<"BASE" | "UPSIDE" | "DOWNSIDE", ScenarioAdjustment> = {
  BASE: { salePricePct: 0, buildCostPct: 0, fsrPct: 0, financePctPoints: 0, targetMarginPctPoints: 0 },
  UPSIDE: { salePricePct: 0.07, buildCostPct: -0.04, fsrPct: 0.05, financePctPoints: -0.01, targetMarginPctPoints: -0.02 },
  DOWNSIDE: { salePricePct: -0.1, buildCostPct: 0.08, fsrPct: -0.1, financePctPoints: 0.015, targetMarginPctPoints: 0.03 },
};

/** Per-opportunity inputs persisted in Opportunity.inputs. */
export const opportunityInputsSchema = z.object({
  overrides: assumptionsSchema.partial().default({}),
  siteAreaOverride: z.number().positive().nullable().default(null),
  fsrOverride: z.number().positive().nullable().default(null),
  heightOverrideM: z.number().positive().nullable().default(null),
  scenarios: z
    .object({ BASE: scenarioAdjustmentSchema, UPSIDE: scenarioAdjustmentSchema, DOWNSIDE: scenarioAdjustmentSchema })
    .default(DEFAULT_SCENARIOS),
  contactDetails: z.string().max(300).default(""),
});
export type OpportunityInputs = z.infer<typeof opportunityInputsSchema>;

export function parseOpportunityInputs(raw: unknown): OpportunityInputs {
  const r = opportunityInputsSchema.safeParse(raw ?? {});
  return r.success ? r.data : opportunityInputsSchema.parse({});
}
