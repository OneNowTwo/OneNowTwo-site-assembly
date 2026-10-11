/**
 * Process one QUEUED tile from each listed LGA (geographic breadth proof).
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { runSydneyIndexCron } from "../src/lib/intelligence/sydney-index-pipeline";

const targetLgas = [
  "Inner West",
  "Parramatta",
  "Northern Beaches",
  "North Sydney",
  "Randwick",
  "Blacktown",
  "Canterbury-Bankstown",
  "City of Sydney",
  "Willoughby",
  "Penrith",
];

async function main() {
  const run = await prisma.sydneyIndexRun.findFirst({
    where: { status: { in: ["RUNNING", "QUEUED"] } },
    orderBy: { createdAt: "desc" },
  });
  if (!run) throw new Error("no active SydneyIndexRun");

  let n = 0;
  for (const lga of targetLgas) {
    const batch = await prisma.sydneyIndexBatch.findFirst({
      where: { runId: run.id, lga, status: "QUEUED" },
      orderBy: { tileKey: "asc" },
    });
    if (!batch) {
      console.log("skip", lga);
      continue;
    }
    await prisma.sydneyIndexBatch.update({
      where: { id: batch.id },
      data: { tileKey: `!priority:${batch.tileKey}` },
    });
    n++;
  }
  console.log("prioritized", n);
  const r = await runSydneyIndexCron({ batchesPerInvoke: Math.max(n, 1), marketScope: "sydney-metro" });
  console.log(
    JSON.stringify(
      {
        status: r.status,
        completed: r.completedBatches,
        candidates: r.candidatesIndexed,
        lgas: r.lgasComplete,
        notes: r.notes,
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
