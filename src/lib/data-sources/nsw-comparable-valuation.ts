import {
  buildComparableValuation,
  type CompSaleInput,
  type ComparableValuationResult,
  type ScoredComparable,
} from "@/lib/analysis/comparable-valuation";
import type { PropertyValuationProvider, PropertyValuationResult } from "./providers";
import {
  filterSalesNearPoint,
  haversineM,
  parseAddressParts,
  queryNswSubjectSales,
  queryNswUrbanSalesNear,
  type NswRegisteredSale,
  NSW_SALES_PROVIDER,
  NSW_SALES_SOURCE_LABEL,
} from "./nsw-property-sales";
import { getCachedValuation, setCachedValuation } from "./valuation-cache";

export interface SubjectLastSale {
  address: string;
  salePrice: number;
  saleDate: string | null;
  landAreaSqm: number | null;
  source: string;
  dealing: string | null;
  propid: number | null;
}

export interface NswCompValuationResult extends PropertyValuationResult {
  numberOfComps?: number;
  comps?: ScoredComparable[];
  subjectLastSale?: SubjectLastSale | null;
  valuationLabel?: string;
}

function toCompInput(sale: NswRegisteredSale, subjectLng: number, subjectLat: number): CompSaleInput {
  return {
    id: sale.dealing ?? `propid:${sale.propid ?? `${sale.lng},${sale.lat},${sale.saleDate}`}`,
    address: sale.address,
    salePrice: sale.salePrice,
    saleDate: sale.saleDate,
    saleDateMs: sale.saleDateMs,
    landAreaSqm: sale.landAreaSqm,
    distanceM: Math.round(haversineM(subjectLng, subjectLat, sale.lng, sale.lat)),
    strata: sale.strata,
    suburb: sale.suburb,
    source: NSW_SALES_SOURCE_LABEL,
    dealing: sale.dealing,
    propid: sale.propid,
  };
}

function isSubjectSale(sale: NswRegisteredSale, houseNo: string | null, street: string | null): boolean {
  if (!houseNo || !street) return false;
  const sn = (sale.houseNo ?? "").toUpperCase();
  const st = (sale.street ?? "").toUpperCase();
  const house = houseNo.toUpperCase();
  const streetU = street.toUpperCase();
  if (!sn.startsWith(house.replace(/[^0-9A-Z]/g, ""))) return false;
  // Compare first token of street name (RESERVE vs RESERVE STREET).
  const saleTok = st.split(/\s+/)[0] ?? "";
  const subTok = streetU.split(/\s+/)[0] ?? "";
  return !!saleTok && saleTok === subTok;
}

export async function estimateFromNswComps(input: {
  externalParcelId: string;
  address?: string | null;
  suburb?: string | null;
  areaSqm: number;
  lng: number;
  lat: number;
  isStrata?: boolean;
  zone?: string | null;
  excludedIds?: string[];
  radiusM?: number;
  lookbackMonths?: number;
  /**
   * Optional prefetched sales pool for the scan area.
   * When provided, filters locally to radius — avoids per-parcel ArcGIS round-trips.
   * Scoring/filtering uses the same buildComparableValuation path.
   */
  prefetchedSales?: NswRegisteredSale[];
}): Promise<NswCompValuationResult> {
  const checkedAt = new Date().toISOString();
  const cacheKey = `nsw-comps:${input.lng.toFixed(5)},${input.lat.toFixed(5)}:${Math.round(input.areaSqm)}:${input.isStrata ? "S" : "H"}`;
  const excluded = new Set(input.excludedIds ?? []);
  if (!excluded.size) {
    const hit = getCachedValuation(cacheKey) as NswCompValuationResult | null;
    if (hit?.mid != null && hit.status === "COMPARABLE_DERIVED") return hit;
  }

  const { houseNo, street } = parseAddressParts(input.address);
  const radiusM = input.radiusM ?? 1000;
  let sales: NswRegisteredSale[] = [];
  try {
    if (input.prefetchedSales) {
      sales = filterSalesNearPoint(input.prefetchedSales, input.lng, input.lat, radiusM);
    } else {
      sales = await queryNswUrbanSalesNear({
        lng: input.lng,
        lat: input.lat,
        radiusM,
        suburb: input.suburb,
      });
    }
  } catch (err) {
    return {
      mid: null,
      low: null,
      high: null,
      status: "NO_VALUE",
      confidence: "UNKNOWN",
      source: "NO_VALUE",
      provider: "NSW",
      method: "nsw_registered_comps_weighted",
      checkedAt,
      note: err instanceof Error ? err.message : "NSW property sales query failed",
      cacheable: false,
      numberOfComps: 0,
      comps: [],
      subjectLastSale: null,
    };
  }

  // Subject historic sale (supporting info only — does not affect mid/low/high comps math).
  let subjectLastSale: SubjectLastSale | null = null;
  const subjectHits = sales.filter((s) => isSubjectSale(s, houseNo, street));
  let remoteSubject: NswRegisteredSale[] = [];
  // When using a shared scan-area sales pool, skip per-parcel subject network lookups
  // (they do not change valuation maths and re-introduce N+1 latency).
  if (!subjectHits.length && houseNo && street && !input.prefetchedSales) {
    remoteSubject = await queryNswSubjectSales({
      houseNo,
      street,
      suburb: input.suburb,
      lng: input.lng,
      lat: input.lat,
    });
  }
  const subjectPool = [...subjectHits, ...remoteSubject].sort((a, b) => (b.saleDateMs ?? 0) - (a.saleDateMs ?? 0));
  if (subjectPool[0]) {
    const s = subjectPool[0];
    subjectLastSale = {
      address: s.address,
      salePrice: s.salePrice,
      saleDate: s.saleDate,
      landAreaSqm: s.landAreaSqm,
      source: NSW_SALES_SOURCE_LABEL,
      dealing: s.dealing,
      propid: s.propid,
    };
  }

  const peerSales = sales.filter((s) => !isSubjectSale(s, houseNo, street));
  const compsIn = peerSales.map((s) => toCompInput(s, input.lng, input.lat));
  const built: ComparableValuationResult = buildComparableValuation(
    compsIn,
    {
      areaSqm: input.areaSqm,
      suburb: input.suburb,
      zone: input.zone,
      isStrata: !!input.isStrata,
    },
    {
      excludedIds: excluded,
      search: { radiusM: input.radiusM, lookbackMonths: input.lookbackMonths },
    },
  );

  const result: NswCompValuationResult = {
    mid: built.mid,
    low: built.low,
    high: built.high,
    status: built.mid != null ? "COMPARABLE_DERIVED" : "NO_VALUE",
    confidence: built.confidence,
    source: built.mid != null ? "COMPARABLE_DERIVED" : "NO_VALUE",
    provider: "NSW",
    method: built.method,
    checkedAt,
    note: built.note,
    cacheKey,
    cacheable: built.mid != null && excluded.size === 0,
    numberOfComps: built.numberOfComps,
    comps: built.comps,
    subjectLastSale,
    valuationLabel: built.label,
  };

  if (result.cacheable && result.cacheKey) setCachedValuation(result.cacheKey, result);
  return result;
}

export class NSWComparableSalesProvider implements PropertyValuationProvider {
  readonly name = "NSW registered comparable sales";

  async estimate(input: {
    externalParcelId: string;
    address?: string | null;
    suburb?: string | null;
    areaSqm: number;
    lng?: number | null;
    lat?: number | null;
    isStrata?: boolean;
    zone?: string | null;
    excludedIds?: string[];
    userValue?: number | null;
    userLow?: number | null;
    userHigh?: number | null;
    comparableDerived?: number | null;
    prefetchedSales?: NswRegisteredSale[];
  }): Promise<NswCompValuationResult> {
    if (input.lng == null || input.lat == null) {
      return {
        mid: null,
        low: null,
        high: null,
        status: "NO_VALUE",
        confidence: "UNKNOWN",
        source: "NO_VALUE",
        provider: "NSW",
        method: "nsw_registered_comps_weighted",
        checkedAt: new Date().toISOString(),
        note: "No coordinates for NSW comps query",
        numberOfComps: 0,
        comps: [],
        subjectLastSale: null,
      };
    }
    return estimateFromNswComps({
      externalParcelId: input.externalParcelId,
      address: input.address,
      suburb: input.suburb,
      areaSqm: input.areaSqm,
      lng: input.lng,
      lat: input.lat,
      isStrata: input.isStrata,
      zone: input.zone,
      excludedIds: input.excludedIds,
      prefetchedSales: input.prefetchedSales,
    });
  }
}

export const nswComparableSalesProvider = new NSWComparableSalesProvider();

export function nswCompsConfigured(): boolean {
  // Official public MapServer — always available unless explicitly disabled.
  return process.env.NSW_COMPS_ENABLED !== "false";
}

export { NSW_SALES_PROVIDER, NSW_SALES_SOURCE_LABEL };
