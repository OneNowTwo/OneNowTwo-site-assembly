/**
 * Produce HISTORICAL_RECORDS_TO_ARCHIVE for human review.
 * Does NOT apply changes.
 *
 *   npx tsx scripts/sydney-historical-dry-run.mts
 */

import "dotenv/config";
import { writeFileSync } from "node:fs";
import { buildHistoricalRecordsToArchive } from "../src/lib/intelligence/archive-dedupe";
import { prisma } from "../src/lib/db";

async function main() {
  const list = await buildHistoricalRecordsToArchive();
  const outPath = process.argv[2] || "HISTORICAL_RECORDS_TO_ARCHIVE.json";
  writeFileSync(outPath, JSON.stringify(list, null, 2));
  console.log(JSON.stringify({ written: outPath, summary: list.summary, recordCount: list.records.length }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
