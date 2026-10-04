/**
 * Optional suburb bedroom-median config provider.
 * Reads SUBURB_EXIT_BEDROOM_MEDIANS_JSON — generic per-suburb map, not hardcoded sites.
 *
 * Example:
 * {
 *   "Manly Vale": {
 *     "state": "NSW",
 *     "source": "Domain suburb medians (ops-supplied)",
 *     "byBedroom": {
 *       "1 Bed": { "medianPrice": 820000, "sampleSize": 39 },
 *       "2 Bed": { "medianPrice": 1250000, "sampleSize": 80 }
 *     }
 *   }
 * }
 */

import type { ExitBenchmarkProvider, SuburbExitBenchmarkResult } from "@/lib/analysis/exit-benchmark-provider";

type ConfigBedroom = { medianPrice: number; sampleSize?: number; source?: string };
type ConfigSuburb = {
  state?: string;
  source?: string;
  checkedAt?: string;
  byBedroom?: Partial<Record<"Studio" | "1 Bed" | "2 Bed" | "3 Bed" | "4 Bed", ConfigBedroom>>;
};

function loadConfig(): Record<string, ConfigSuburb> {
  const raw = process.env.SUBURB_EXIT_BEDROOM_MEDIANS_JSON?.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, ConfigSuburb>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function findSuburb(map: Record<string, ConfigSuburb>, suburb: string): ConfigSuburb | null {
  if (map[suburb]) return map[suburb]!;
  const lower = suburb.toLowerCase();
  for (const [key, value] of Object.entries(map)) {
    if (key.toLowerCase() === lower) return value;
  }
  return null;
}

export class ConfigSuburbExitBenchmarkProvider implements ExitBenchmarkProvider {
  readonly name = "Configured suburb bedroom medians";

  async getSuburbUnitBenchmarks(input: {
    suburb: string;
    state?: string;
    lng?: number;
    lat?: number;
  }): Promise<SuburbExitBenchmarkResult | null> {
    const map = loadConfig();
    const entry = findSuburb(map, input.suburb.trim());
    if (!entry?.byBedroom) return null;

    const byBedroom: SuburbExitBenchmarkResult["byBedroom"] = {};
    for (const [name, point] of Object.entries(entry.byBedroom)) {
      if (!point || !(point.medianPrice > 0)) continue;
      const sampleSize = point.sampleSize ?? 0;
      // Require a sample size when supplied; if omitted, accept ops-supplied median.
      if (point.sampleSize != null && point.sampleSize < 5) continue;
      byBedroom[name as keyof NonNullable<SuburbExitBenchmarkResult["byBedroom"]>] = {
        medianPrice: point.medianPrice,
        sampleSize: sampleSize || 5,
        source: point.source ?? entry.source ?? "Configured suburb bedroom median",
      };
    }
    if (!Object.keys(byBedroom).length) return null;

    return {
      suburb: input.suburb.trim(),
      state: (entry.state ?? input.state ?? "NSW").toUpperCase(),
      checkedAt: entry.checkedAt ?? new Date().toISOString(),
      source: entry.source ?? "Configured suburb bedroom medians",
      overallUnitMedian: byBedroom["2 Bed"]?.medianPrice ?? byBedroom["1 Bed"]?.medianPrice ?? null,
      overallSampleSize: Object.values(byBedroom).reduce((s, p) => s + (p?.sampleSize ?? 0), 0),
      byBedroom,
    };
  }
}

export const configSuburbExitBenchmarkProvider = new ConfigSuburbExitBenchmarkProvider();
