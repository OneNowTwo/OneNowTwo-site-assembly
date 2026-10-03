import type { BBox, ParcelData, PlanningControls } from "@/lib/types";
import type { MultiPolygon, Point, Polygon } from "geojson";

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
  /**
   * Planning controls for each cadastral parcel (keyed by caller id).
   * FSR must be resolved by intersecting the REAL parcel geometry against the
   * official NSW EPI Floor Space Ratio layer — not a silent generic assumption.
   * Must reject with UpstreamError if the service is down.
   */
  getControlsForParcels(bbox: BBox, parcels: { id: string; geometry: Polygon | MultiPolygon }[]): Promise<Map<string, PlanningControls>>;
  /** Legacy point lookup — prefer getControlsForParcels. */
  getControlsForPoints?(bbox: BBox, points: { id: string; point: Point }[]): Promise<Map<string, PlanningControls>>;
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
  source: "USER_ESTIMATE" | "COMPARABLE_DERIVED" | "LIVE_PROVIDER" | "LIVE_AVM" | "SYSTEM_ESTIMATE" | "SUBURB_FALLBACK" | "DEMO" | "NO_VALUE";
  note?: string;
}

/** Full AVM / manual valuation result used by Domain, PropTrack, comps, and overrides. */
export interface PropertyValuationResult {
  mid: number | null;
  low: number | null;
  high: number | null;
  status: "LIVE_AVM" | "COMPARABLE_DERIVED" | "USER_ESTIMATE" | "SUBURB_FALLBACK" | "NO_VALUE";
  confidence: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  source: string;
  provider: "DOMAIN" | "PROPTRACK" | "CORELOGIC" | "MANUAL" | "COMPS" | "NSW" | "SYSTEM" | null;
  method: string | null;
  checkedAt: string;
  note?: string | null;
  cacheKey?: string;
  cacheable?: boolean;
  /** Provider property id (e.g. Domain propertyId). */
  externalId?: string | null;
}

export interface PropertyValuationProvider {
  readonly name: string;
  estimate(input: {
    externalParcelId: string;
    address?: string | null;
    suburb?: string | null;
    areaSqm: number;
    domainPropertyId?: string | null;
    userValue?: number | null;
    userLow?: number | null;
    userHigh?: number | null;
    userLandRate?: number | null;
    comparableDerived?: number | null;
    lng?: number | null;
    lat?: number | null;
    isStrata?: boolean;
    zone?: string | null;
    excludedIds?: string[];
  }): PropertyValuationResult | Promise<PropertyValuationResult>;
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

/** Manual / comps valuation — never invents a suburb $/sqm as a trusted market value. */
export const manualValuationProvider: PropertyValuationProvider = {
  name: "Manual developer estimate",
  estimate({ areaSqm, userValue, userLow, userHigh, userLandRate, comparableDerived }) {
    const checkedAt = new Date().toISOString();
    if (userValue != null && userValue > 0) {
      return {
        mid: userValue,
        low: userLow ?? null,
        high: userHigh ?? null,
        status: "USER_ESTIMATE",
        confidence: "UNKNOWN",
        source: "USER_ESTIMATE",
        provider: "MANUAL",
        method: "manual_override",
        checkedAt,
        note: "USER ENTERED EXTERNAL ESTIMATE",
      };
    }
    if (comparableDerived != null && comparableDerived > 0) {
      return {
        mid: comparableDerived,
        low: null,
        high: null,
        status: "COMPARABLE_DERIVED",
        confidence: "MEDIUM",
        source: "COMPARABLE_DERIVED",
        provider: "COMPS",
        method: "comparable_sales",
        checkedAt,
        note: "Median of included acquisition comps",
      };
    }
    if (userLandRate != null && userLandRate > 0) {
      return {
        mid: userLandRate * areaSqm,
        low: null,
        high: null,
        status: "USER_ESTIMATE",
        confidence: "LOW",
        source: "USER_ESTIMATE",
        provider: "MANUAL",
        method: "user_land_rate",
        checkedAt,
        note: "From entered $/sqm land rate",
      };
    }
    return {
      mid: null,
      low: null,
      high: null,
      status: "NO_VALUE",
      confidence: "UNKNOWN",
      source: "NO_VALUE",
      provider: "MANUAL",
      method: null,
      checkedAt,
      note: "VALUE REQUIRED — enter a market estimate or connect an AVM",
    };
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
