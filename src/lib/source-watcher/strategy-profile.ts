/**
 * Development strategy profiles used across TODAY + FIND.
 * Architecture allows more strategies later. Default works with no config.
 */

export type DevelopmentStrategy = "APARTMENTS" | "CO_LIVING" | "TOWNHOUSES" | "GENERAL_RESIDENTIAL";

export interface StrategyProfile {
  id: string;
  name: string;
  strategy: DevelopmentStrategy;
  targetLgas: string[];
  targetSuburbs: string[];
  minSiteAreaSqm: number | null;
  maxProperties: number | null;
  preferredZones: string[];
  minCurrentFsr: number | null;
  minProposedFsr: number | null;
  maxStationDistanceM: number | null;
  excludeStrata: boolean;
  excludeExistingApartmentBlocks: boolean;
  requirePositiveHeadroom: boolean;
  planningChangeInterest: boolean;
  developmentActivityInterest: boolean;
}

export const STRATEGY_LABELS: Record<DevelopmentStrategy, string> = {
  APARTMENTS: "Apartments",
  CO_LIVING: "Co-living",
  TOWNHOUSES: "Townhouses",
  GENERAL_RESIDENTIAL: "General residential",
};

export const DEFAULT_STRATEGY_PROFILE: StrategyProfile = {
  id: "default",
  name: "Default profile",
  strategy: "GENERAL_RESIDENTIAL",
  targetLgas: [],
  targetSuburbs: [],
  minSiteAreaSqm: null,
  maxProperties: null,
  preferredZones: [],
  minCurrentFsr: null,
  minProposedFsr: null,
  maxStationDistanceM: null,
  excludeStrata: false,
  excludeExistingApartmentBlocks: false,
  requirePositiveHeadroom: false,
  planningChangeInterest: true,
  developmentActivityInterest: true,
};

export const STRATEGY_PRESETS: Record<DevelopmentStrategy, Partial<StrategyProfile>> = {
  APARTMENTS: {
    strategy: "APARTMENTS",
    name: "Apartments",
    preferredZones: ["R3", "R4", "B4", "MU1", "E1"],
    minSiteAreaSqm: 450,
    maxProperties: 6,
    // Prefer / rank proposed density uplift — do NOT hard-require proposed FSR.
    // Ordinary NSW suburbs without a PlanningChangeArea must remain searchable.
    minProposedFsr: null,
    excludeStrata: true,
    excludeExistingApartmentBlocks: true,
    requirePositiveHeadroom: true,
    planningChangeInterest: true,
    developmentActivityInterest: true,
  },
  CO_LIVING: {
    strategy: "CO_LIVING",
    name: "Co-living",
    preferredZones: ["R3", "R4", "B4", "MU1"],
    minSiteAreaSqm: 300,
    maxProperties: 4,
    maxStationDistanceM: 800,
    excludeStrata: true,
    planningChangeInterest: true,
    developmentActivityInterest: true,
  },
  TOWNHOUSES: {
    strategy: "TOWNHOUSES",
    name: "Townhouses",
    preferredZones: ["R2", "R3"],
    minSiteAreaSqm: 500,
    maxProperties: 3,
    excludeStrata: true,
    excludeExistingApartmentBlocks: true,
    planningChangeInterest: true,
  },
  GENERAL_RESIDENTIAL: {
    strategy: "GENERAL_RESIDENTIAL",
    name: "General residential",
    planningChangeInterest: true,
    developmentActivityInterest: true,
  },
};

export function profileForStrategy(strategy: DevelopmentStrategy): StrategyProfile {
  return {
    ...DEFAULT_STRATEGY_PROFILE,
    ...STRATEGY_PRESETS[strategy],
    id: strategy.toLowerCase(),
    strategy,
  };
}

export function parseStrategyProfile(raw: unknown): StrategyProfile {
  if (!raw || typeof raw !== "object") return DEFAULT_STRATEGY_PROFILE;
  const o = raw as Partial<StrategyProfile>;
  const strategy = (o.strategy as DevelopmentStrategy) || "GENERAL_RESIDENTIAL";
  const base = profileForStrategy(strategy);
  return {
    ...base,
    ...o,
    strategy,
    targetLgas: Array.isArray(o.targetLgas) ? o.targetLgas.map(String) : base.targetLgas,
    targetSuburbs: Array.isArray(o.targetSuburbs) ? o.targetSuburbs.map(String) : base.targetSuburbs,
    preferredZones: Array.isArray(o.preferredZones) ? o.preferredZones.map(String) : base.preferredZones,
  };
}
