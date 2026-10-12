/**
 * Production-safe bootstrap for Render / hosted start.
 *
 * Ensures GlobalAssumptions (and only that) exist.
 * NEVER creates Opportunities, demo parcels, comps, owners, or seed stories.
 *
 *   tsx scripts/ensure-production-bootstrap.mts
 *
 * Used by: npm run start:render
 * Demo data (Neutral Bay etc.) is opt-in via: npm run db:seed:demo
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { ensureProductionBootstrap } from "../src/lib/production-bootstrap";

async function main() {
  const result = await ensureProductionBootstrap();
  console.log(
    JSON.stringify(
      {
        ok: true,
        assumptions: result.assumptions,
        opportunityCount: result.opportunityCount,
        note: "Production bootstrap — no demo Opportunities created",
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
