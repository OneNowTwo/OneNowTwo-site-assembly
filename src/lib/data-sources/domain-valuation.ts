import { buildUrl, fetchJson, UpstreamError } from "./http";
import type { PropertyValuationResult, PropertyValuationProvider } from "./providers";

/**
 * Domain Price Estimate API adapter.
 * Auth: OAuth client credentials → Bearer token.
 * Env: DOMAIN_CLIENT_ID, DOMAIN_CLIENT_SECRET, optional DOMAIN_API_BASE / DOMAIN_AUTH_URL.
 *
 * Does not invent estimates when credentials or property match are missing.
 */
const DOMAIN_AUTH_URL = process.env.DOMAIN_AUTH_URL ?? "https://auth.domain.com.au/v1/connect/token";
const DOMAIN_API_BASE = process.env.DOMAIN_API_BASE ?? "https://api.domain.com.au";

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

export function domainValuationConfigured(): boolean {
  return !!(process.env.DOMAIN_CLIENT_ID && process.env.DOMAIN_CLIENT_SECRET);
}

async function getAccessToken(): Promise<string | null> {
  if (!domainValuationConfigured()) return null;
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.accessToken;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: process.env.DOMAIN_CLIENT_ID!,
    client_secret: process.env.DOMAIN_CLIENT_SECRET!,
    scope: "api_properties_read api_listings_read",
  });
  try {
    const res = await fetch(DOMAIN_AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) return null;
    cachedToken = {
      accessToken: json.access_token,
      expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    };
    return cachedToken.accessToken;
  } catch {
    return null;
  }
}

interface DomainPriceEstimate {
  mid?: number;
  lowerPrice?: number;
  upperPrice?: number;
  confidence?: string | number;
  dateUpdated?: string;
  estimateDate?: string;
}

export class DomainValuationProvider implements PropertyValuationProvider {
  readonly name = "Domain Price Estimate API";

  async estimate(input: {
    externalParcelId: string;
    address?: string | null;
    suburb?: string | null;
    areaSqm: number;
    domainPropertyId?: string | null;
    userValue?: number | null;
    userLow?: number | null;
    userHigh?: number | null;
    comparableDerived?: number | null;
  }): Promise<PropertyValuationResult> {
    const checkedAt = new Date().toISOString();

    // Manual / comps take precedence when supplied by the caller.
    if (input.userValue != null && input.userValue > 0) {
      return {
        mid: input.userValue,
        low: input.userLow ?? null,
        high: input.userHigh ?? null,
        status: "USER_ESTIMATE",
        confidence: "UNKNOWN",
        source: "USER_ESTIMATE",
        provider: "MANUAL",
        method: "manual_override",
        checkedAt,
        note: "USER ENTERED EXTERNAL ESTIMATE",
      };
    }
    if (input.comparableDerived != null && input.comparableDerived > 0) {
      return {
        mid: input.comparableDerived,
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

    if (!domainValuationConfigured()) {
      return {
        mid: null,
        low: null,
        high: null,
        status: "NO_VALUE",
        confidence: "UNKNOWN",
        source: "NO_VALUE",
        provider: "DOMAIN",
        method: null,
        checkedAt,
        note: "DOMAIN VALUATION NOT CONNECTED — set DOMAIN_CLIENT_ID and DOMAIN_CLIENT_SECRET",
        cacheable: false,
      };
    }

    const token = await getAccessToken();
    if (!token) {
      return {
        mid: null,
        low: null,
        high: null,
        status: "NO_VALUE",
        confidence: "UNKNOWN",
        source: "NO_VALUE",
        provider: "DOMAIN",
        method: null,
        checkedAt,
        note: "DOMAIN VALUATION NOT CONNECTED — authentication failed",
        cacheable: false,
      };
    }

    let propertyId = input.domainPropertyId ?? null;
    if (!propertyId && input.address) {
      try {
        const suggestUrl = buildUrl(`${DOMAIN_API_BASE}/v1/properties/_suggest`, {
          terms: input.address,
          pageSize: "1",
        });
        const suggestions = await fetchJson<{ id?: string; propertyId?: string }[]>(suggestUrl, {
          service: "Domain property suggest",
          timeoutMs: 12000,
          headers: { Authorization: `Bearer ${token}` },
        });
        propertyId = suggestions[0]?.id ?? suggestions[0]?.propertyId ?? null;
      } catch (err) {
        return {
          mid: null,
          low: null,
          high: null,
          status: "NO_VALUE",
          confidence: "UNKNOWN",
          source: "NO_VALUE",
          provider: "DOMAIN",
          method: null,
          checkedAt,
          note: err instanceof UpstreamError ? err.message : "Domain property resolve failed",
          cacheable: false,
        };
      }
    }

    if (!propertyId) {
      return {
        mid: null,
        low: null,
        high: null,
        status: "NO_VALUE",
        confidence: "UNKNOWN",
        source: "NO_VALUE",
        provider: "DOMAIN",
        method: null,
        checkedAt,
        note: "No Domain property ID matched for this address",
        cacheable: false,
      };
    }

    try {
      const url = `${DOMAIN_API_BASE}/v1/properties/${encodeURIComponent(propertyId)}/priceEstimate`;
      const est = await fetchJson<DomainPriceEstimate>(url, {
        service: "Domain priceEstimate",
        timeoutMs: 15000,
        headers: { Authorization: `Bearer ${token}` },
      });
      const mid = est.mid ?? null;
      if (mid == null || !(mid > 0)) {
        return {
          mid: null,
          low: est.lowerPrice ?? null,
          high: est.upperPrice ?? null,
          status: "NO_VALUE",
          confidence: "UNKNOWN",
          source: "LIVE_AVM",
          provider: "DOMAIN",
          method: "priceEstimate",
          checkedAt,
          note: "Domain returned no mid price estimate for this property",
          cacheKey: `domain:${propertyId}`,
          cacheable: true,
        };
      }
      const confRaw = est.confidence != null ? String(est.confidence) : "UNKNOWN";
      return {
        mid,
        low: est.lowerPrice ?? null,
        high: est.upperPrice ?? null,
        status: "LIVE_AVM",
        confidence: /high/i.test(confRaw) ? "HIGH" : /med/i.test(confRaw) ? "MEDIUM" : /low/i.test(confRaw) ? "LOW" : "UNKNOWN",
        source: "LIVE_AVM",
        provider: "DOMAIN",
        method: "priceEstimate",
        checkedAt: est.dateUpdated ?? est.estimateDate ?? checkedAt,
        note: null,
        cacheKey: `domain:${propertyId}`,
        cacheable: true,
      };
    } catch (err) {
      return {
        mid: null,
        low: null,
        high: null,
        status: "NO_VALUE",
        confidence: "UNKNOWN",
        source: "NO_VALUE",
        provider: "DOMAIN",
        method: "priceEstimate",
        checkedAt,
        note: err instanceof UpstreamError ? err.message : "Domain priceEstimate request failed",
        cacheable: false,
      };
    }
  }
}

export const domainValuationProvider = new DomainValuationProvider();
