/**
 * Production-safe config bootstrap — GlobalAssumptions only.
 * Must never create Opportunities / demo parcels / seed intel.
 */

import { prisma } from "@/lib/db";
import { DEFAULT_ASSUMPTIONS } from "@/lib/analysis/assumptions";

export type ProductionBootstrapResult = {
  assumptions: "created" | "unchanged" | "updated";
  opportunityCount: number;
};

/**
 * Idempotent: ensure the singleton GlobalAssumptions row exists with defaults
 * when missing. Does not overwrite customised production values on subsequent runs
 * (only creates if absent).
 */
export async function ensureProductionBootstrap(): Promise<ProductionBootstrapResult> {
  const existing = await prisma.globalAssumptions.findUnique({ where: { id: "global" } });
  let assumptions: ProductionBootstrapResult["assumptions"];
  if (!existing) {
    await prisma.globalAssumptions.create({
      data: { id: "global", values: DEFAULT_ASSUMPTIONS },
    });
    assumptions = "created";
  } else {
    assumptions = "unchanged";
  }

  const opportunityCount = await prisma.opportunity.count();
  return { assumptions, opportunityCount };
}

/** Demo seeding requires an explicit opt-in flag. */
export function shouldSeedDemo(argv: string[] = process.argv): boolean {
  return argv.includes("--demo") || argv.includes("--reset");
}
