/**
 * Single display rule for planning-dependent economics.
 * Missing planning → "—" / Planning required — never 0.0:1 or $0.
 */

import { fsr, money, num, sqm } from "@/lib/format";

export const PLANNING_REQUIRED_REASON = "Planning required";

/** Canonical effective FSR string from PlanningSnapshot / CalculationSnapshot. */
export function displayEffectiveFsr(
  effectiveFsr: number | null | undefined,
  calculable: boolean,
): string {
  if (!calculable || effectiveFsr == null || !(effectiveFsr > 0)) return "—";
  return fsr(effectiveFsr);
}

export function displayPlanningMoney(
  value: number | null | undefined,
  calculable: boolean,
  opts?: { compact?: boolean },
): string {
  if (!calculable) return "—";
  return money(value, opts);
}

export function displayPlanningCount(
  value: number | null | undefined,
  calculable: boolean,
): string {
  if (!calculable) return "—";
  return num(value);
}

export function displayPlanningSqm(
  value: number | null | undefined,
  calculable: boolean,
): string {
  if (!calculable) return "—";
  return sqm(value);
}

/** Cross-screen regression helper — all surfaces must agree. */
export function effectiveFsrSurfacesAgree(surfaces: Array<string | null | undefined>): boolean {
  if (!surfaces.length) return true;
  const first = surfaces[0] ?? "—";
  return surfaces.every((s) => (s ?? "—") === first);
}
