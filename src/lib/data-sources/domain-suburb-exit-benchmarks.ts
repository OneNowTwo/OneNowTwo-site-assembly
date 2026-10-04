/**
 * Domain suburb performance statistics → bedroom-specific unit exit medians.
 * Requires api_suburbperformance_read (or package that includes suburb performance).
 * Falls back silently when credentials/scope are unavailable — NSW registered sales remain.
 */

import { fetchJson } from "./http";
import { domainValuationConfigured, getDomainAccessToken } from "./domain-valuation";
import type { ExitBenchmarkProvider, SuburbExitBenchmarkResult } from "@/lib/analysis/exit-benchmark-provider";

const DOMAIN_API_BASE = process.env.DOMAIN_API_BASE ?? "https://api.domain.com.au";

interface SeriesInfo {
  year?: number;
  month?: number;
  values?: {
    medianSoldPrice?: number | null;
    numberSold?: number | null;
  };
}

interface SuburbPerformanceResponse {
  header?: { suburb?: string; state?: string; propertyCategory?: string };
  series?: { seriesInfo?: SeriesInfo[] };
}

function latestMedian(series: SeriesInfo[] | undefined): { median: number; sampleSize: number } | null {
  if (!series?.length) return null;
  // Prefer newest period with a median and at least one sale.
  const ordered = [...series].reverse();
  for (const row of ordered) {
    const median = row.values?.medianSoldPrice;
    const n = row.values?.numberSold ?? 0;
    if (median != null && median > 0 && n > 0) return { median, sampleSize: n };
  }
  return null;
}

async function fetchBedroomMedian(
  token: string,
  suburb: string,
  state: string,
  bedrooms: number,
): Promise<{ median: number; sampleSize: number } | null> {
  const encodedSuburb = encodeURIComponent(suburb.trim());
  const url =
    `${DOMAIN_API_BASE}/v2/suburbPerformanceStatistics/${state}/${encodedSuburb}` +
    `?propertyCategory=unit&bedrooms=${bedrooms}&periodSize=years&totalPeriods=1` +
    `&values=MedianSoldPrice,NumberSold`;
  try {
    const json = await fetchJson<SuburbPerformanceResponse>(url, {
      service: "Domain suburb performance",
      timeoutMs: 15000,
      ttlMs: 12 * 60 * 60 * 1000,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    return latestMedian(json.series?.seriesInfo);
  } catch {
    // Older/v1 shape or missing scope — try without postcode path already used.
    return null;
  }
}

export class DomainSuburbExitBenchmarkProvider implements ExitBenchmarkProvider {
  readonly name = "Domain suburb performance";

  async getSuburbUnitBenchmarks(input: {
    suburb: string;
    state?: string;
    lng?: number;
    lat?: number;
  }): Promise<SuburbExitBenchmarkResult | null> {
    if (!domainValuationConfigured()) return null;
    const auth = await getDomainAccessToken();
    if (!auth.token) return null;

    const state = (input.state ?? "NSW").toUpperCase();
    const suburb = input.suburb.trim();
    if (!suburb) return null;

    const byBedroom: SuburbExitBenchmarkResult["byBedroom"] = {};
    const bedroomTypes: Array<{ beds: number; name: keyof NonNullable<SuburbExitBenchmarkResult["byBedroom"]> }> = [
      { beds: 1, name: "1 Bed" },
      { beds: 2, name: "2 Bed" },
      { beds: 3, name: "3 Bed" },
    ];

    await Promise.all(
      bedroomTypes.map(async ({ beds, name }) => {
        const point = await fetchBedroomMedian(auth.token!, suburb, state, beds);
        // Require a modest sample so thin 3-bed sets don't invent precision.
        if (!point || point.sampleSize < 5) return;
        byBedroom[name] = {
          medianPrice: point.median,
          sampleSize: point.sampleSize,
          source: "Domain suburb performance (unit)",
        };
      }),
    );

    if (!Object.keys(byBedroom).length) return null;

    // Overall unit median: prefer 2-bed as the market anchor when present.
    const overall = byBedroom["2 Bed"]?.medianPrice ?? byBedroom["1 Bed"]?.medianPrice ?? null;
    const overallSample =
      (byBedroom["2 Bed"]?.sampleSize ?? 0) + (byBedroom["1 Bed"]?.sampleSize ?? 0) + (byBedroom["3 Bed"]?.sampleSize ?? 0);

    return {
      suburb,
      state,
      checkedAt: new Date().toISOString(),
      source: "Domain suburb performance",
      overallUnitMedian: overall,
      overallSampleSize: overallSample,
      byBedroom,
    };
  }
}

export const domainSuburbExitBenchmarkProvider = new DomainSuburbExitBenchmarkProvider();
