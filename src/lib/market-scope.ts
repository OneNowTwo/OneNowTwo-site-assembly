/**
 * Selected market scope — header label is market scope, not app identity.
 * Prepare for later Newcastle / Wollongong / Melbourne without renaming the product.
 */

export type MarketScopeId = "sydney-metro" | "newcastle" | "wollongong" | "melbourne";

export type MarketScope = {
  id: MarketScopeId;
  label: string;
  shortLabel: string;
  /** Header chip e.g. "NSW · Sydney metro" */
  headerLabel: string;
  defaultMap: { lat: number; lng: number; zoom: number };
};

export const MARKET_SCOPES: Record<MarketScopeId, MarketScope> = {
  "sydney-metro": {
    id: "sydney-metro",
    label: "Greater Sydney",
    shortLabel: "Sydney metro",
    headerLabel: "NSW · Sydney metro",
    defaultMap: { lat: -33.8688, lng: 151.2093, zoom: 11 },
  },
  newcastle: {
    id: "newcastle",
    label: "Newcastle",
    shortLabel: "Newcastle",
    headerLabel: "NSW · Newcastle",
    defaultMap: { lat: -32.9283, lng: 151.7817, zoom: 12 },
  },
  wollongong: {
    id: "wollongong",
    label: "Wollongong",
    shortLabel: "Wollongong",
    headerLabel: "NSW · Wollongong",
    defaultMap: { lat: -34.4278, lng: 150.8931, zoom: 12 },
  },
  melbourne: {
    id: "melbourne",
    label: "Melbourne",
    shortLabel: "Melbourne",
    headerLabel: "VIC · Melbourne",
    defaultMap: { lat: -37.8136, lng: 144.9631, zoom: 11 },
  },
};

/** Current product default — Sydney first. */
export const DEFAULT_MARKET_SCOPE: MarketScopeId = "sydney-metro";

export function getMarketScope(id?: string | null): MarketScope {
  if (id && id in MARKET_SCOPES) return MARKET_SCOPES[id as MarketScopeId];
  return MARKET_SCOPES[DEFAULT_MARKET_SCOPE];
}
