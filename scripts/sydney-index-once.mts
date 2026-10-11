/**
 * Process N Sydney index batches (local / ops).
 *   npx tsx scripts/sydney-index-once.mts [batches=5]
 */

import "dotenv/config";
import { runSydneyBaseline } from "../src/lib/intelligence/sydney-baseline";
import { prisma } from "../src/lib/db";

async function main() {
  const batches = Number(process.argv[2] ?? "5");
  const result = await runSydneyBaseline({
    skipWatcher: process.argv.includes("--skip-watcher"),
    dryRunArchive: true,
    batchesPerInvoke: Number.isFinite(batches) ? batches : 5,
  });
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
