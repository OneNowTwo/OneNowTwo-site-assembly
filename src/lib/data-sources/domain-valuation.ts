import { buildUrl, fetchJson, UpstreamError } from "./http";
import type { PropertyValuationResult, PropertyValuationProvider } from "./providers";

/**
 * Domain Price Estimate API — live integration.
 *
 * Auth (Client Credentials Grant):
 *   POST https://auth.domain.com.au/v1/connect/token
 *   Authorization: Basic base64(client_id:client_secret)
 *   body: grant_type=client_credentials&scope=...
 *
 * Env:
 *   DOMAIN_CLIENT_ID
 *   DOMAIN_CLIENT_SECRET
 *   DOMAIN_API_BASE (optional, default https://api.domain.com.au)
 *   DOMAIN_AUTH_URL (optional)
 *   DOMAIN_SCOPES (optional)
 *
 * Price Estimation is a separate Domain API package — if the project only has
 * Agents & Listings / Properties & Locations, priceEstimate may 403 until upgraded.
 */
const DOMAIN_AUTH_URL = process.env.DOMAIN_AUTH_URL ?? "https://auth.domain.com.au/v1/connect/token";
const DOMAIN_API_BASE = process.env.DOMAIN_API_BASE ?? "https://api.domain.com.au";
const DOMAIN_SCOPES =
  process.env.DOMAIN_SCOPES ?? "api_properties_read api_addresslocators_read api_listings_read api_locations_read";

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

export function domainValuationConfigured(): boolean {
  return !!(process.env.DOMAIN_CLIENT_ID?.trim() && process.env.DOMAIN_CLIENT_SECRET?.trim());
}

export function domainCredentialStatus(): {
  configured: boolean;
  missing: string[];
  authUrl: string;
  apiBase: string;
  scopes: string;
  notes: string[];
} {
  const missing: string[] = [];
  if (!process.env.DOMAIN_CLIENT_ID?.trim()) missing.push("DOMAIN_CLIENT_ID");
  if (!process.env.DOMAIN_CLIENT_SECRET?.trim()) missing.push("DOMAIN_CLIENT_SECRET");
  return {
    configured: missing.length === 0,
    missing,
    authUrl: DOMAIN_AUTH_URL,
    apiBase: DOMAIN_API_BASE,
    scopes: DOMAIN_SCOPES,
    notes: [
      "Create a project at https://developer.domain.com.au → Credentials → OAuth Client (Client Credentials).",
      "Add API packages: Properties & Locations (suggest) and Price Estimation (priceEstimate) — Price Estimation is a separate package.",
      "Auth uses HTTP Basic with client_id:client_secret (not form-body client credentials).",
    ],
  };
}

async function getAccessToken(): Promise<{ token: string | null; error?: string }> {
  if (!domainValuationConfigured()) return { token: null, error: "DOMAIN_CLIENT_ID / DOMAIN_CLIENT_SECRET not set" };
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return { token: cachedToken.accessToken };

  const id = process.env.DOMAIN_CLIENT_ID!.trim();
  const secret = process.env.DOMAIN_CLIENT_SECRET!.trim();
  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: DOMAIN_SCOPES,
  });
  try {
    const res = await fetch(DOMAIN_AUTH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
      },
      body,
    });
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!res.ok || !json.access_token) {
      return {
        token: null,
        error: json.error_description ?? json.error ?? `Domain auth HTTP ${res.status}`,
      };
    }
    cachedToken = {
      accessToken: json.access_token,
      expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    };
    return { token: cachedToken.accessToken };
  } catch (err) {
    return { token: null, error: err instanceof Error ? err.message : "Domain auth failed" };
  }
}

interface DomainSuggestItem {
  id?: string | number;
  propertyId?: string | number;
  address?: string;
  relativeScore?: number;
  suburb?: string;
  postCode?: string;
  state?: string;
}

interface DomainPriceEstimate {
  mid?: number;
  midPrice?: number;
  lowerPrice?: number;
  upperPrice?: number;
  confidence?: string | number;
  priceConfidence?: string | number;
  date?: string;
  dateUpdated?: string;
  estimateDate?: string;
  source?: string;
}

function mapConfidence(raw: string | number | undefined): PropertyValuationResult["confidence"] {
  if (raw == null) return "UNKNOWN";
  const s = String(raw).toLowerCase();
  if (s.includes("high")) return "HIGH";
  if (s.includes("med")) return "MEDIUM";
  if (s.includes("low")) return "LOW";
  return "UNKNOWN";
}

function buildSearchTerms(address?: string | null, suburb?: string | null): string | null {
  const a = (address ?? "").trim();
  if (!a) return null;
  // Avoid duplicating suburb if already in the address string.
  if (suburb && !a.toLowerCase().includes(suburb.toLowerCase())) return `${a}, ${suburb}, NSW`;
  if (!/\bnsw\b/i.test(a)) return `${a}, NSW`;
  return a;
}

export class DomainValuationProvider implements PropertyValuationProvider {
  readonly name = "Domain Price Estimate API";

  async resolvePropertyId(address: string, suburb?: string | null, token?: string): Promise<{ id: string | null; note?: string }> {
    const auth = token ? { token } : await getAccessToken();
    if (!auth.token) return { id: null, note: auth.error ?? "Domain auth failed" };
    const terms = buildSearchTerms(address, suburb);
    if (!terms) return { id: null, note: "No address to resolve" };
    try {
      const suggestUrl = buildUrl(`${DOMAIN_API_BASE}/v1/properties/_suggest`, {
        terms,
        pageSize: "5",
      });
      const suggestions = await fetchJson<DomainSuggestItem[]>(suggestUrl, {
        service: "Domain property suggest",
        timeoutMs: 12000,
        ttlMs: 24 * 60 * 60 * 1000,
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      if (!Array.isArray(suggestions) || !suggestions.length) return { id: null, note: `No Domain property match for “${terms}”` };
      // Prefer highest relativeScore; otherwise first.
      const sorted = [...suggestions].sort((a, b) => (b.relativeScore ?? 0) - (a.relativeScore ?? 0));
      const best = sorted[0]!;
      const id = best.id ?? best.propertyId;
      return id != null ? { id: String(id) } : { id: null, note: "Domain suggest returned no id" };
    } catch (err) {
      return { id: null, note: err instanceof UpstreamError ? err.message : "Domain property resolve failed" };
    }
  }

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

    // Caller-supplied overrides are handled by the waterfall before Domain — but keep safety.
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

    const auth = await getAccessToken();
    if (!auth.token) {
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
        note: `DOMAIN VALUATION NOT CONNECTED — ${auth.error ?? "authentication failed"}`,
        cacheable: false,
      };
    }

    let propertyId = input.domainPropertyId ? String(input.domainPropertyId) : null;
    if (!propertyId && input.address) {
      const resolved = await this.resolvePropertyId(input.address, input.suburb, auth.token);
      propertyId = resolved.id;
      if (!propertyId) {
        return {
          mid: null,
          low: null,
          high: null,
          status: "NO_VALUE",
          confidence: "UNKNOWN",
          source: "NO_VALUE",
          provider: "DOMAIN",
          method: "properties/_suggest",
          checkedAt,
          note: resolved.note ?? "No Domain property ID matched",
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
        note: "No address or Domain property ID available",
        cacheable: false,
      };
    }

    try {
      const url = `${DOMAIN_API_BASE}/v1/properties/${encodeURIComponent(propertyId)}/priceEstimate`;
      const est = await fetchJson<DomainPriceEstimate>(url, {
        service: "Domain priceEstimate",
        timeoutMs: 15000,
        ttlMs: 7 * 24 * 60 * 60 * 1000,
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      const mid = est.midPrice ?? est.mid ?? null;
      const low = est.lowerPrice ?? null;
      const high = est.upperPrice ?? null;
      const conf = mapConfidence(est.priceConfidence ?? est.confidence);
      if (mid == null || !(mid > 0)) {
        return {
          mid: null,
          low,
          high,
          status: "NO_VALUE",
          confidence: conf,
          source: "LIVE_AVM",
          provider: "DOMAIN",
          method: "priceEstimate",
          checkedAt: est.date ?? est.dateUpdated ?? est.estimateDate ?? checkedAt,
          note: "Domain returned no midPrice for this property",
          cacheKey: `domain:${propertyId}`,
          cacheable: true,
          externalId: propertyId,
        };
      }
      return {
        mid,
        low,
        high,
        status: "LIVE_AVM",
        confidence: conf,
        source: "LIVE_AVM",
        provider: "DOMAIN",
        method: "priceEstimate",
        checkedAt: est.date ?? est.dateUpdated ?? est.estimateDate ?? checkedAt,
        note: est.source ? `Domain source: ${est.source}` : null,
        cacheKey: `domain:${propertyId}`,
        cacheable: true,
        externalId: propertyId,
      };
    } catch (err) {
      const msg = err instanceof UpstreamError ? err.message : err instanceof Error ? err.message : "Domain priceEstimate request failed";
      const packageHint = /403|forbidden|not authorised|not authorized|scope/i.test(msg)
        ? " — Price Estimation package may not be enabled on this Domain project"
        : "";
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
        note: msg + packageHint,
        cacheable: false,
        externalId: propertyId,
      };
    }
  }
}

export const domainValuationProvider = new DomainValuationProvider();
