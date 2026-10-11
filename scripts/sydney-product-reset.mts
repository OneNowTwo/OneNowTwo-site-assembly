/**
 * Production reset helper (run AFTER DB backup):
 *   npx tsx scripts/sydney-product-reset.mts --dry-run
 *   npx tsx scripts/sydney-product-reset.mts --apply
 *
 * Archives duplicate Opportunities, retires fixture/baseline intel noise,
 * refreshes SiteCandidateIndex. Does not delete engines or source config.
 */

import "dotenv/config";
import { applyArchiveDedupe } from "../src/lib/intelligence/archive-dedupe";
import { refreshSiteCandidateIndexFromKnownEntities } from "../src/lib/intelligence/site-candidate-index";
import { prisma } from "../src/lib/db";

async function main() {
  const apply = process.argv.includes("--apply");
  const dryRun = !apply;

  console.log(dryRun ? "DRY RUN — no writes" : "APPLYING archive/dedupe…");
  const result = await applyArchiveDedupe({ dryRun });
  console.log(JSON.stringify(result.plan, null, 2));

  if (!dryRun) {
    const refreshed = await refreshSiteCandidateIndexFromKnownEntities({ includeOpportunities: true });
    const count = await prisma.siteCandidateIndex.count({ where: { lifecycleStatus: "ACTIVE" } });
    console.log(`SiteCandidateIndex upserts=${refreshed.upserted} active=${count}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
