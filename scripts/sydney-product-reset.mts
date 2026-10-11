/**
 * Historical cleanup helper.
 * Default is DRY-RUN only. Apply requires --allow-apply after human review.
 *
 *   npx tsx scripts/sydney-product-reset.mts --dry-run
 *   npx tsx scripts/sydney-product-reset.mts --allow-apply
 */

import "dotenv/config";
import { applyArchiveDedupe, buildHistoricalRecordsToArchive } from "../src/lib/intelligence/archive-dedupe";
import { prisma } from "../src/lib/db";

async function main() {
  const allowApply = process.argv.includes("--allow-apply");
  const dryRun = !allowApply;

  console.log(dryRun ? "DRY RUN — no writes (pass --allow-apply after human review)" : "APPLYING archive…");
  const historical = await buildHistoricalRecordsToArchive();
  console.log(JSON.stringify(historical.summary, null, 2));
  console.log(`records=${historical.records.length}`);

  const result = await applyArchiveDedupe({ dryRun, allowApply });
  console.log(JSON.stringify({ applied: result.applied }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
