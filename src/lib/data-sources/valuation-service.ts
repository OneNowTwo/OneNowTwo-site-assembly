import type { ParcelData, ParcelValuationData } from "@/lib/types";
import type { PropertyValuationResult } from "./providers";
import { domainValuationConfigured, domainValuationProvider, domainCredentialStatus } from "./domain-valuation";
import { propTrackValuationConfigured, propTrackValuationProvider } from "./proptrack-valuation";
import { manualValuationProvider } from "./providers";
import { getCachedValuation, setCachedValuation } from "./valuation-cache";

export type ValuationProviderName = "domain" | "proptrack" | "auto";

/**
 * Provider waterfall:
 * 1. LIVE DOMAIN
 * 2. LIVE PROPTRACK (when licensed)
 * 3. COMPARABLE_DERIVED (caller-supplied)
 * 4. USER ESTIMATE (caller-supplied override)
 * 5. NO_VALUE
 *
 * Manual is last-resort / override — not the default path.
 */
export async function valueProperty(input: {
  externalParcelId: string;
  address?: string | null;
  suburb?: string | null;
  areaSqm: number;
  /** Force provider; default auto waterfall. */
  prefer?: ValuationProviderName;
  userValue?: number | null;
  userLow?: number | null;
  userHigh?: number | null;
  comparableDerived?: number | null;
  domainPropertyId?: string | null;
  /**
   * When true, honour an explicit USER override immediately (manual edit path).
   * Automatic scan/value flow leaves this false so live AVMs run first.
   */
  preferUserOverride?: boolean;
  /** When true, skip live AVM and honour user/comps only. */
  manualOnly?: boolean;
}): Promise<PropertyValuationResult> {
  // Explicit manual override (user edited a lot) wins immediately.
  if (input.preferUserOverride && input.userValue != null && input.userValue > 0) {
    return manualValuationProvider.estimate(input);
  }
  if (input.manualOnly) {
    return manualValuationProvider.estimate(input);
  }

  const prefer = input.prefer ?? (process.env.VALUATION_PROVIDER as ValuationProviderName | undefined) ?? "auto";
  const order: Array<"domain" | "proptrack"> =
    prefer === "proptrack" ? ["proptrack", "domain"] : prefer === "domain" ? ["domain"] : ["domain", "proptrack"];

  let last: PropertyValuationResult | null = null;
  for (const name of order) {
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

  // 3) Comparable-derived from an approved/licensed source (caller-supplied).
  if (input.comparableDerived != null && input.comparableDerived > 0) {
    return manualValuationProvider.estimate({ ...input, userValue: null });
  }

  // 4) User estimate as last-resort fallback (not the default workflow).
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
      note: "VALUE REQUIRED — no live AVM available",
    }
  );
}

export function toParcelValuation(result: PropertyValuationResult): ParcelValuationData {
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
  };
}

/** Value unique parcels (concurrency-limited). Attaches `.valuation` on each parcel. */
export async function valueParcels(
  parcels: ParcelData[],
  opts?: { concurrency?: number; prefer?: ValuationProviderName },
): Promise<{ parcels: ParcelData[]; valued: number; failed: number; messages: string[] }> {
  const concurrency = opts?.concurrency ?? 3;
  let valued = 0;
  let failed = 0;
  const messages: string[] = [];
  const out = [...parcels];
  const byId = new Map(out.map((p, i) => [p.externalParcelId, i]));

  const creds = domainCredentialStatus();
  if (!creds.configured && !propTrackValuationConfigured()) {
    messages.push(`DOMAIN VALUATION NOT CONNECTED — missing ${creds.missing.join(", ")}. Assemblies keep planning ranking until credentials are set.`);
  }

  for (let i = 0; i < out.length; i += concurrency) {
    const batch = out.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (p) => {
        const result = await valueProperty({
          externalParcelId: p.externalParcelId,
          address: p.address,
          suburb: p.suburb,
          areaSqm: p.areaSqm,
          prefer: opts?.prefer,
        });
        return { id: p.externalParcelId, result };
      }),
    );
    for (const { id, result } of results) {
      const idx = byId.get(id);
      if (idx == null) continue;
      const valuation = toParcelValuation(result);
      out[idx] = { ...out[idx]!, valuation };
      if (result.mid != null && result.status === "LIVE_AVM") valued++;
      else failed++;
    }
  }

  if (valued > 0) messages.push(`Automatic valuations: ${valued} live AVM · ${failed} without estimate`);
  else if (creds.configured) messages.push(`Automatic valuations: 0 live AVM of ${out.length} (check Price Estimation package / address match)`);

  return { parcels: out, valued, failed, messages };
}

export function valuationProviderStatus() {
  return {
    waterfall: ["DOMAIN", "PROPTRACK", "COMPARABLE_DERIVED", "USER_ESTIMATE", "NO_VALUE"] as const,
    domain: domainCredentialStatus(),
    proptrack: {
      configured: propTrackValuationConfigured(),
      notes: ["Set PROPTRACK_API_KEY and PROPTRACK_ENABLED=true when licensed. Do not scrape realestate.com.au."],
    },
    prefer: process.env.VALUATION_PROVIDER ?? "auto",
  };
}
