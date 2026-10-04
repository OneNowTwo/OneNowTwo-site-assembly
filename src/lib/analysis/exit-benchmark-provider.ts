/**
 * Exit benchmark provider abstraction.
 * Priority: USER OVERRIDE > LOCAL BEDROOM MEDIAN > LOCAL STRATA BENCHMARK >
 * LOCAL UNIT MEDIAN > TEMPLATE FALLBACK.
 */

import type { ExitBenchmarkSet, ExitPriceSource, NswLikeSaleForExit } from "./exit-benchmarks";
import { buildLocalExitBenchmarksFromNswSales, EXIT_SOURCE_RANK, mergeExitBenchmarkSets } from "./exit-benchmarks";

export interface BedroomMedianPoint {
  medianPrice: number;
  sampleSize: number;
  source: string;
}

export interface SuburbExitBenchmarkResult {
  suburb: string;
  state: string;
  checkedAt: string;
  source: string;
  overallUnitMedian: number | null;
  overallSampleSize: number;
  byBedroom: Partial<Record<"Studio" | "1 Bed" | "2 Bed" | "3 Bed" | "4 Bed", BedroomMedianPoint>>;
}

export interface ExitBenchmarkProvider {
  readonly name: string;
  getSuburbUnitBenchmarks(input: {
    suburb: string;
    state?: string;
    lng?: number;
    lat?: number;
  }): Promise<SuburbExitBenchmarkResult | null>;
}

/** Convert a suburb bedroom-median provider result into an ExitBenchmarkSet (partial). */
export function suburbResultToExitBenchmarkSet(result: SuburbExitBenchmarkResult): ExitBenchmarkSet {
  const byUnitType: ExitBenchmarkSet["byUnitType"] = {};
  for (const [name, point] of Object.entries(result.byBedroom)) {
    if (!point || !(point.medianPrice > 0) || point.sampleSize < 1) continue;
    byUnitType[name] = {
      pricePerUnit: Math.round(point.medianPrice),
      source: "LOCAL_BEDROOM_MEDIAN",
      sampleSize: point.sampleSize,
      providerLabel: point.source,
    };
  }
  const bedroomCount = Object.keys(byUnitType).length;
  return {
    suburb: result.suburb,
    checkedAt: result.checkedAt,
    byUnitType,
    overallMedian: result.overallUnitMedian,
    overallSampleSize: result.overallSampleSize,
    sourceLabel:
      bedroomCount > 0
        ? `${result.source} — local bedroom medians (${bedroomCount} types)`
        : result.source,
  };
}

/**
 * Resolve exit benchmarks for a scan area / opportunity suburb.
 * Bedroom-specific provider results win over NSW registered-sale fallbacks per unit type.
 */
export async function resolveAreaExitBenchmarks(input: {
  suburb: string | null | undefined;
  state?: string;
  lng?: number;
  lat?: number;
  nswSales?: NswLikeSaleForExit[];
  bedroomProviders?: ExitBenchmarkProvider[];
}): Promise<ExitBenchmarkSet> {
  const nsw = buildLocalExitBenchmarksFromNswSales(input.nswSales ?? []);
  const providers = input.bedroomProviders ?? [];
  let preferred: ExitBenchmarkSet | null = null;
  if (input.suburb?.trim()) {
    for (const provider of providers) {
      try {
        const result = await provider.getSuburbUnitBenchmarks({
          suburb: input.suburb.trim(),
          state: input.state ?? "NSW",
          lng: input.lng,
          lat: input.lat,
        });
        if (!result) continue;
        const asSet = suburbResultToExitBenchmarkSet(result);
        if (Object.keys(asSet.byUnitType).length) {
          preferred = preferred ? mergeExitBenchmarkSets(preferred, asSet) : asSet;
        }
      } catch {
        // Provider failures must not block NSW fallback.
      }
    }
  }
  if (!preferred) return nsw;
  return mergeExitBenchmarkSets(nsw, preferred);
}

export function exitSourceBeats(next: ExitPriceSource, current: ExitPriceSource | undefined): boolean {
  const a = EXIT_SOURCE_RANK[next] ?? 0;
  const b = current ? (EXIT_SOURCE_RANK[current] ?? 0) : 0;
  return a > b;
}
