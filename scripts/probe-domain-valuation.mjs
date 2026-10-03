#!/usr/bin/env node
/**
 * Probe Domain Price Estimate for Neutral Bay sanity addresses.
 * Does not hardcode values — prints live mid/low/high when credentials work.
 *
 * Usage: node scripts/probe-domain-valuation.mjs
 * Requires: DOMAIN_CLIENT_ID, DOMAIN_CLIENT_SECRET
 */
const AUTH_URL = process.env.DOMAIN_AUTH_URL ?? "https://auth.domain.com.au/v1/connect/token";
const API_BASE = process.env.DOMAIN_API_BASE ?? "https://api.domain.com.au";
const SCOPES =
  process.env.DOMAIN_SCOPES ?? "api_properties_read api_addresslocators_read api_listings_read api_locations_read";

const ADDRESSES = [
  "1 Reserve Street, Neutral Bay NSW 2089",
  "3 Reserve Street, Neutral Bay NSW 2089",
  "5 Reserve Street, Neutral Bay NSW 2089",
  "57 Undercliff Street, Neutral Bay NSW 2089",
];

async function main() {
  const id = process.env.DOMAIN_CLIENT_ID?.trim();
  const secret = process.env.DOMAIN_CLIENT_SECRET?.trim();
  if (!id || !secret) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          blocker: "DOMAIN_CREDENTIALS_MISSING",
          required: ["DOMAIN_CLIENT_ID", "DOMAIN_CLIENT_SECRET"],
          optional: ["DOMAIN_AUTH_URL", "DOMAIN_API_BASE", "DOMAIN_SCOPES", "VALUATION_PROVIDER"],
          auth: {
            method: "OAuth2 Client Credentials",
            tokenUrl: AUTH_URL,
            header: "Authorization: Basic base64(client_id:client_secret)",
            body: "grant_type=client_credentials&scope=...",
          },
          packages: ["Properties & Locations (properties/_suggest)", "Price Estimation (priceEstimate)"],
          portal: "https://developer.domain.com.au",
          note: "Once set, scan auto-values top assemblies via Domain without manual entry.",
        },
        null,
        2,
      ),
    );
    process.exit(2);
  }

  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  const tokenRes = await fetch(AUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: SCOPES }),
  });
  const tokenJson = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenJson.access_token) {
    console.log(JSON.stringify({ ok: false, blocker: "DOMAIN_AUTH_FAILED", status: tokenRes.status, body: tokenJson }, null, 2));
    process.exit(1);
  }
  const token = tokenJson.access_token;
  const results = [];
  for (const terms of ADDRESSES) {
    const suggestUrl = `${API_BASE}/v1/properties/_suggest?terms=${encodeURIComponent(terms)}&pageSize=5`;
    const sugRes = await fetch(suggestUrl, { headers: { Authorization: `Bearer ${token}` } });
    const sug = await sugRes.json().catch(() => null);
    const best = Array.isArray(sug) ? sug.sort((a, b) => (b.relativeScore ?? 0) - (a.relativeScore ?? 0))[0] : null;
    const propertyId = best?.id ?? best?.propertyId ?? null;
    if (!propertyId) {
      results.push({ address: terms, error: "no property match", suggestStatus: sugRes.status });
      continue;
    }
    const estRes = await fetch(`${API_BASE}/v1/properties/${encodeURIComponent(propertyId)}/priceEstimate`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const est = await estRes.json().catch(() => ({}));
    results.push({
      address: terms,
      propertyId: String(propertyId),
      http: estRes.status,
      midPrice: est.midPrice ?? est.mid ?? null,
      lowerPrice: est.lowerPrice ?? null,
      upperPrice: est.upperPrice ?? null,
      priceConfidence: est.priceConfidence ?? est.confidence ?? null,
      estimateDate: est.date ?? est.dateUpdated ?? est.estimateDate ?? null,
      rawError: estRes.ok ? null : est,
    });
  }
  const mids = results.map((r) => r.midPrice).filter((n) => typeof n === "number" && n > 0);
  console.log(
    JSON.stringify(
      {
        ok: mids.length > 0,
        results,
        combinedMid: mids.length ? mids.reduce((s, n) => s + n, 0) : null,
        valuedCount: mids.length,
        benchmarkNote: "5 Reserve Street consumer estimate ~$3.12m ($2.59–$3.65m) is a sanity check only — not hardcoded.",
      },
      null,
      2,
    ),
  );
  process.exit(mids.length ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
