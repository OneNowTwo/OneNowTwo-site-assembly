import type { BBox, ParcelData, PlanningControls } from "@/lib/types";
import type { Point } from "geojson";

/**
 * Provider interfaces. V1 ships NSW government adapters plus manual-entry providers;
 * licensed data (CoreLogic, PriceFinder, Domain, title search) can be added behind the same contracts.
 */

export interface CadastreProvider {
  readonly name: string;
  /** Lots intersecting a bounding box, with address where available. Planning is not attached. */
  getParcelsInBBox(bbox: BBox): Promise<Omit<ParcelData, "planning" | "planningStatus">[]>;
}

export interface PlanningDataProvider {
  readonly name: string;
  /** Planning controls for each point (keyed by caller id). Must reject with UpstreamError if the service is down. */
  getControlsForPoints(bbox: BBox, points: { id: string; point: Point }[]): Promise<Map<string, PlanningControls>>;
}

export interface GeocodeResult {
  label: string;
  lat: number;
  lng: number;
  bbox?: BBox;
  kind: "suburb" | "address" | "place";
  source: string;
}

export interface GeocoderProvider {
  readonly name: string;
  search(query: string): Promise<GeocodeResult[]>;
}

export interface ValuationEstimate {
  marketValue: number | null;
  landValuePerSqm: number | null;
  source: "USER_ESTIMATE" | "SYSTEM_ESTIMATE" | "LICENSED";
  note?: string;
}

export interface PropertyValuationProvider {
  readonly name: string;
  estimate(input: { externalParcelId: string; areaSqm: number; userValue?: number | null; userLandRate?: number | null }): ValuationEstimate;
}

export interface OwnerRecord {
  name: string | null;
  ownerType: string | null;
  mailingAddress: string | null;
  source: string;
}

/** Placeholder for licensed title / owner data. V1 has no automated owner lookup. */
export interface OwnerDataProvider {
  readonly name: string;
  lookup(externalParcelId: string): Promise<OwnerRecord | null>;
}

export interface ConstructionCostProvider {
  readonly name: string;
  costPerSqmGfa(input: { buildingType: "apartment" | "townhouse"; storeys: number }): number | null;
}

export interface ComparableSalesProvider {
  readonly name: string;
  comparables(input: { lat: number; lng: number; radiusM: number }): Promise<{ address: string; price: number; date: string }[]>;
}

export interface AIAnalysisProvider {
  readonly name: string;
  summarise(input: unknown): Promise<string | null>;
}

/** V1 valuation: whatever the developer entered, else an explicitly-labelled $/sqm system estimate. */
export const manualValuationProvider: PropertyValuationProvider = {
  name: "Manual developer estimate",
  estimate({ areaSqm, userValue, userLandRate }) {
    if (userValue != null && userValue > 0) return { marketValue: userValue, landValuePerSqm: null, source: "USER_ESTIMATE" };
    if (userLandRate != null && userLandRate > 0)
      return { marketValue: userLandRate * areaSqm, landValuePerSqm: userLandRate, source: "USER_ESTIMATE", note: "From entered $/sqm land rate" };
    return { marketValue: null, landValuePerSqm: null, source: "SYSTEM_ESTIMATE", note: "No value entered" };
  },
};

export const noOwnerDataProvider: OwnerDataProvider = {
  name: "None (manual entry only)",
  async lookup() {
    return null;
  },
};
