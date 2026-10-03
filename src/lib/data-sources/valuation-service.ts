import type { ParcelData, ParcelValuationData } from "@/lib/types";
import type { PropertyValuationResult } from "./providers";
import { domainValuationConfigured, domainValuationProvider, domainCredentialStatus } from "./domain-valuation";
import { propTrackValuationConfigured, propTrackValuationProvider } from "./proptrack-valuation";
import {
  nswComparableSalesProvider,
  nswCompsConfigured,
  estimateFromNswComps,
  type NswCompValuationResult,
} from "./nsw-comparable-valuation";
import { manualValuationProvider } from "./providers";
import { getCachedValuation, setCachedValuation } from "./valuation-cache";
import { publicWebComparableProvider } from "./public-web-comparable";
import { prefetchNswSalesForParcels, type NswRegisteredSale } from "./nsw-property-sales";

export type ValuationProviderName = "nsw" | "domain" | "proptrack" | "auto";

/**
 * Provider waterfall (MVP):
 * 1. NSW registered comparable sales (primary — no Domain fee)
 * 2. LIVE DOMAIN (optional, when credentials present)
 * 3. LIVE PROPTRACK (when licensed)
 * 4. Caller-supplied comparableDerived
 * 5. USER ESTIMATE (override / last resort)
 * 6. NO_VALUE
 *
 * Manual is last-resort / override — not the default path.
 */
export async function valueProperty(input: {
  externalParcelId: string;
  address?: string | null;
  suburb?: string | null;
  areaSqm: number;
  lng?: number | null;
  lat?: number | null;
  isStrata?: boolean;
  zone?: string | null;
  excludedIds?: string[];
  /** Force provider; default auto waterfall. */
  prefer?: ValuationProviderName;
  userValue?: number | null;
  userLow?: number | null;
  userHigh?: number | null;
  comparableDerived?: number | null;
  domainPropertyId?: string | null;
  /**
   * When true, honour an explicit USER override immediately (manual edit path).
   * Automatic scan/value flow leaves this false so live sources run first.
   */
  preferUserOverride?: boolean;
  /** When true, skip live sources and honour user/comps only. */
  manualOnly?: boolean;
  /** Shared sales pool from a scan-area prefetch (avoids per-parcel ArcGIS calls). */
  prefetchedSales?: NswRegisteredSale[];
}): Promise<NswCompValuationResult> {
  if (input.preferUserOverride && input.userValue != null && input.userValue > 0) {
    return manualValuationProvider.estimate(input);
  }
  if (input.manualOnly) {
    return manualValuationProvider.estimate(input);
  }

  const prefer = input.prefer ?? (process.env.VALUATION_PROVIDER as ValuationProviderName | undefined) ?? "auto";
  let last: NswCompValuationResult | null = null;

  const tryNsw = prefer === "auto" || prefer === "nsw";
  if (tryNsw && nswCompsConfigured() && input.lng != null && input.lat != null) {
    const result = input.prefetchedSales
      ? await estimateFromNswComps({
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
        })
      : await nswComparableSalesProvider.estimate(input);
    if (result.status === "COMPARABLE_DERIVED" && result.mid != null) return result;
    last = result;
  }

  const liveOrder: Array<"domain" | "proptrack"> =
    prefer === "proptrack" ? ["proptrack", "domain"] : prefer === "domain" ? ["domain"] : prefer === "nsw" ? [] : ["domain", "proptrack"];

  for (const name of liveOrder) {
    if (name === "domain") {
      if (!domainValuationConfigured()) {
        last = await domainValuationProvider.estimate(input);
        continue;
      }
      const cacheKey = input.domainPropertyId
        ? `domain:${input.domainPropertyId}`
        : input.address
          ? `domain:addr:${input.address}|${input.suburb ?? ""}`
          : null;
      if (cacheKey) {
        const hit = getCachedValuation(cacheKey);
        if (hit?.mid != null && hit.status === "LIVE_AVM") return hit;
      }
      const result = await domainValuationProvider.estimate(input);
      if (result.cacheKey && result.status === "LIVE_AVM") setCachedValuation(result.cacheKey, result);
      if (result.status === "LIVE_AVM" && result.mid != null) return result;
      last = result;
      continue;
    }
    if (name === "proptrack") {
      if (!propTrackValuationConfigured()) continue;
      const result = await propTrackValuationProvider.estimate(input);
      if (result.status === "LIVE_AVM" && result.mid != null) return result;
      last = result;
    }
  }

  if (input.comparableDerived != null && input.comparableDerived > 0) {
    return manualValuationProvider.estimate({ ...input, userValue: null });
  }

  if (input.userValue != null && input.userValue > 0) {
    return manualValuationProvider.estimate(input);
  }

  return (
    last ?? {
      mid: null,
      low: null,
      high: null,
      status: "NO_VALUE",
      confidence: "UNKNOWN",
      source: "NO_VALUE",
      provider: null,
      method: null,
      checkedAt: new Date().toISOString(),
      note: "VALUE REQUIRED — no NSW comps or live AVM available",
      numberOfComps: 0,
      comps: [],
      subjectLastSale: null,
    }
  );
}

export function toParcelValuation(result: PropertyValuationResult | NswCompValuationResult): ParcelValuationData {
  const nsw = result as NswCompValuationResult;
  return {
    mid: result.mid,
    low: result.low,
    high: result.high,
    status: result.status,
    confidence: result.confidence,
    source: result.source,
    provider: result.provider,
    method: result.method,
    checkedAt: result.checkedAt,
    externalId: result.externalId ?? null,
    note: result.note ?? null,
    numberOfComps: nsw.numberOfComps ?? null,
    comps: nsw.comps
      ? nsw.comps.slice(0, 12).map((c) => ({
          id: c.id,
          address: c.address,
          salePrice: c.salePrice,
          saleDate: c.saleDate,
          landAreaSqm: c.landAreaSqm,
          distanceM: c.distanceM,
          similarity: Math.round(c.similarity * 1000) / 1000,
          included: c.included,
          excludeReason: c.excludeReason ?? null,
          source: c.source,
          dealing: c.dealing ?? null,
        }))
      : null,
    subjectLastSale: nsw.subjectLastSale
      ? {
          address: nsw.subjectLastSale.address,
          salePrice: nsw.subjectLastSale.salePrice,
          saleDate: nsw.subjectLastSale.saleDate,
          landAreaSqm: nsw.subjectLastSale.landAreaSqm,
          source: nsw.subjectLastSale.source,
        }
      : null,
    valuationLabel: nsw.valuationLabel ?? null,
  };
}

function isTrustedAutoValue(result: PropertyValuationResult): boolean {
  return result.mid != null && (result.status === "LIVE_AVM" || result.status === "COMPARABLE_DERIVED");
}

/** Value unique parcels (concurrency-limited). Attaches `.valuation` on each parcel. */
export async function valueParcels(
  parcels: ParcelData[],
  opts?: {
    concurrency?: number;
    prefer?: ValuationProviderName;
    /** Prefetch NSW sales once for the batch (default true when NSW comps enabled and batch ≥ 3). */
    shareNswSales?: boolean;
  },
): Promise<{
  parcels: ParcelData[];
  valued: number;
  failed: number;
  messages: string[];
  timings?: { salesPrefetchMs: number; valuationMs: number; salesFetches: number; salesPoolSize: number };
}> {
  const concurrency = opts?.concurrency ?? 12;
  let valued = 0;
  let failed = 0;
  const messages: string[] = [];
  const out = [...parcels];
  const byId = new Map(out.map((p, i) => [p.externalParcelId, i]));

  if (nswCompsConfigured()) {
    messages.push("Valuing top assemblies via NSW registered comparable sales (MVP/research PSI — commercial licence required before product sale).");
  }
  // Touch stub so the optional enrichment path stays imported/available.
  void publicWebComparableProvider.name;

  let prefetchedSales: NswRegisteredSale[] | undefined;
  let salesPrefetchMs = 0;
  let salesFetches = 0;
  let salesPoolSize = 0;
  const share = opts?.shareNswSales ?? (nswCompsConfigured() && out.length >= 3 && (opts?.prefer ?? "auto") !== "domain");
  if (share && nswCompsConfigured()) {
    const t0 = performance.now();
    const pref = await prefetchNswSalesForParcels(
      out.map((p) => ({ lng: p.centroid[0], lat: p.centroid[1], suburb: p.suburb })),
      1000,
    );
    prefetchedSales = pref.pool;
    salesFetches = pref.fetchCount;
    salesPoolSize = pref.pool.length;
    salesPrefetchMs = performance.now() - t0;
    messages.push(`NSW sales prefetch: ${salesFetches} request(s) · ${salesPoolSize} sales reused across ${out.length} parcels`);
  }

  const tVal0 = performance.now();
  for (let i = 0; i < out.length; i += concurrency) {
    const batch = out.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (p) => {
        const result = await valueProperty({
          externalParcelId: p.externalParcelId,
          address: p.address,
          suburb: p.suburb,
          areaSqm: p.areaSqm,
          lng: p.centroid[0],
          lat: p.centroid[1],
          isStrata: p.isStrata,
          zone: p.planning?.zone ?? null,
          prefer: opts?.prefer,
          prefetchedSales,
        });
        return { id: p.externalParcelId, result };
      }),
    );
    for (const { id, result } of results) {
      const idx = byId.get(id);
      if (idx == null) continue;
      const valuation = toParcelValuation(result);
      out[idx] = { ...out[idx]!, valuation };
      if (isTrustedAutoValue(result)) valued++;
      else failed++;
    }
  }
  const valuationMs = performance.now() - tVal0;

  if (valued > 0) messages.push(`Automatic valuations: ${valued} comparable-derived/AVM · ${failed} without estimate`);
  else messages.push(`Automatic valuations: 0 of ${out.length} — check NSW sales coverage or Domain credentials`);

  return {
    parcels: out,
    valued,
    failed,
    messages,
    timings: { salesPrefetchMs, valuationMs, salesFetches, salesPoolSize },
  };
}

export function valuationProviderStatus() {
  return {
    waterfall: ["NSW_REGISTERED_COMPS", "DOMAIN", "PROPTRACK", "COMPARABLE_DERIVED", "USER_ESTIMATE", "NO_VALUE"] as const,
    nsw: {
      configured: nswCompsConfigured(),
      service: process.env.NSW_PROPERTY_SALES_URL ?? "https://maps.six.nsw.gov.au/arcgis/rest/services/public/Valuation/MapServer",
      notes: [
        "MVP/research use of NSW Property Sales Information.",
        "Obtain a commercial PSI licence from Valuation NSW before commercial release.",
      ],
    },
    domain: domainCredentialStatus(),
    proptrack: {
      configured: propTrackValuationConfigured(),
      notes: ["Set PROPTRACK_API_KEY and PROPTRACK_ENABLED=true when licensed. Do not scrape realestate.com.au."],
    },
    publicWebEnrichment: {
      enabled: false,
      notes: ["Stub only — never scrape REA/Domain without authorisation."],
    },
    prefer: process.env.VALUATION_PROVIDER ?? "auto",
  };
}
