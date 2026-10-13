/**
 * Map current-assembly GFA display: missing planning ≠ official FSR 0:1.
 */

export type IndicativeGfaDisplay =
  | { kind: "value"; gfaSqm: number }
  | { kind: "planning_required" };

export function indicativeGfaDisplay(metrics: {
  lotCount: number;
  fsrUnmappedLots: number;
  gfa: number;
}): IndicativeGfaDisplay {
  if (metrics.lotCount > 0 && metrics.fsrUnmappedLots === metrics.lotCount) {
    return { kind: "planning_required" };
  }
  return { kind: "value", gfaSqm: metrics.gfa };
}
