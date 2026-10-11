/**
 * One-shot: apply HISTORICAL archive for Neutral Bay Assembly Demo only.
 * Guard: refuses if dry-run set is not exactly that one Opportunity.
 */
import "dotenv/config";
import { applyArchiveDedupe, buildHistoricalRecordsToArchive } from "../src/lib/intelligence/archive-dedupe";
import { prisma } from "../src/lib/db";

async function main() {
  const list = await buildHistoricalRecordsToArchive();
  console.log(JSON.stringify({ summary: list.summary, records: list.records }, null, 2));
  if (list.records.length !== 1 || list.records[0]?.name !== "Neutral Bay Assembly Demo") {
    throw new Error(`REFUSING apply — unexpected dry-run set (${list.records.length} records)`);
  }
  if (!/demoFinancialData|DEMO\/TEST\/FIXTURE/i.test(list.records[0]!.reason)) {
    throw new Error(`REFUSING apply — unexpected reason: ${list.records[0]!.reason}`);
  }
  const result = await applyArchiveDedupe({ allowApply: true, dryRun: false });
  const opp = await prisma.opportunity.findUnique({
    where: { id: list.records[0]!.id },
    select: { id: true, name: true, lifecycleStatus: true, archivedReason: true, archivedAt: true },
  });
  console.log(JSON.stringify({ applied: result.applied, opportunity: opp }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
