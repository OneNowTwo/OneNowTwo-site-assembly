import type { BBox, ParcelData, PlanningControls } from "@/lib/types";
import type { Point } from "geojson";

/**
 * Provider interfaces. V1 ships NSW government adapters plus manual-entry providers;
 * licensed data (CoreLogic, PriceFinder, Domain, title search, construction cost feeds)
 * can be added behind the same contracts. Do not scrape commercial sites.
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
  source: "USER_ESTIMATE" | "COMPARABLE_DERIVED" | "LIVE_PROVIDER" | "SYSTEM_ESTIMATE" | "DEMO";
  note?: string;
}

export interface PropertyValuationProvider {
  readonly name: string;
  estimate(input: {
    externalParcelId: string;
    areaSqm: number;
    userValue?: number | null;
    userLandRate?: number | null;
    comparableDerived?: number | null;
  }): ValuationEstimate;
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

export interface ConstructionCostEstimate {
  costPerSqmGfa: number | null;
  source: "USER_ASSUMPTION" | "LIVE_PROVIDER";
  note?: string;
}

export interface ConstructionCostProvider {
  readonly name: string;
  estimate(input: { buildingType: "apartment" | "townhouse"; storeys: number; userRate?: number | null }): ConstructionCostEstimate;
}

export type ComparableCompType = "ACQUISITION" | "EXIT";

export interface ComparableSaleRecord {
  type: ComparableCompType;
  address: string;
  salePrice: number;
  saleDate: string | null;
  propertyType: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  parking: number | null;
  landArea: number | null;
  internalArea: number | null;
  externalArea: number | null;
  saleableArea: number | null;
  pricePerSqm: number | null;
  newBuildStatus: string | null;
  unitType: string | null;
  source: string;
  sourceReference: string | null;
  distanceM: number | null;
  notes: string | null;
}

/**
 * Acquisition comps = existing houses/land being bought.
 * Exit comps = new apartments/product being sold.
 * V1: manual entry only via ManualComparableSalesProvider. Ready for licensed APIs later.
 */
export interface ComparableSalesProvider {
  readonly name: string;
  getAcquisitionComparables(input: { lat: number; lng: number; radiusM: number }): Promise<ComparableSaleRecord[]>;
  getExitComparables(input: { lat: number; lng: number; radiusM: number }): Promise<ComparableSaleRecord[]>;
}

export interface AIAnalysisProvider {
  readonly name: string;
  summarise(input: unknown): Promise<string | null>;
}

/** V1 valuation: whatever the developer entered, else comparable-derived, else labelled system estimate. */
export const manualValuationProvider: PropertyValuationProvider = {
  name: "Manual developer estimate",
  estimate({ areaSqm, userValue, userLandRate, comparableDerived }) {
    if (userValue != null && userValue > 0) return { marketValue: userValue, landValuePerSqm: null, source: "USER_ESTIMATE" };
    if (comparableDerived != null && comparableDerived > 0)
      return { marketValue: comparableDerived, landValuePerSqm: null, source: "COMPARABLE_DERIVED", note: "Median of included acquisition comps" };
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

/** V1: returns the user rate as a labelled assumption — never pretends to be a live cost feed. */
export const manualConstructionCostProvider: ConstructionCostProvider = {
  name: "Manual construction assumption",
  estimate({ userRate }) {
    if (userRate != null && userRate > 0) return { costPerSqmGfa: userRate, source: "USER_ASSUMPTION" };
    return { costPerSqmGfa: null, source: "USER_ASSUMPTION", note: "Enter a base build cost $/sqm GFA" };
  },
};

/** V1: no live sales — licensed providers plug in later. UI uses manual ComparableSale rows. */
export const manualComparableSalesProvider: ComparableSalesProvider = {
  name: "Manual comparable entry",
  async getAcquisitionComparables() {
    return [];
  },
  async getExitComparables() {
    return [];
  },
};
