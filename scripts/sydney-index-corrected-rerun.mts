/**
 * After lockBbox + LGA provenance fix:
 * 1) invalidate prior run(s)
 * 2) start clean SydneyIndexRun
 * 3) process ≥1 tile per Greater Sydney LGA
 * 4) continue priority urban batches toward ~150 if runtime allows
 *
 * Never runs seed-*.mts.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import {
  invalidatePriorRunsAndStartFresh,
  runSydneyIndexCron,
  getSydneyIndexMetrics,
} from "../src/lib/intelligence/sydney-index-pipeline";
import { GREATER_SYDNEY_LGAS } from "../src/lib/intelligence/greater-sydney-lgas";

const PRIORITY_URBAN = [
  "Inner West",
  "Parramatta",
  "City of Sydney",
  "North Sydney",
  "Randwick",
  "Blacktown",
  "Canterbury-Bankstown",
  "Northern Beaches",
  "Willoughby",
  "Penrith",
  "Canada Bay",
  "Woollahra",
  "Waverley",
  "Ryde",
  "Cumberland",
];

async function prioritizeOnePerLga(runId: string) {
  let n = 0;
  for (const lga of GREATER_SYDNEY_LGAS) {
    const batch = await prisma.sydneyIndexBatch.findFirst({
      where: { runId, lga: lga.name, status: "QUEUED" },
      orderBy: { tileKey: "asc" },
    });
    if (!batch) continue;
    if (batch.tileKey.startsWith("!priority:")) continue;
    await prisma.sydneyIndexBatch.update({
      where: { id: batch.id },
      data: { tileKey: `!priority:lga1:${batch.tileKey}` },
    });
    n++;
  }
  return n;
}

async function prioritizeUrbanExtras(runId: string, extrasPerLga = 3) {
  let n = 0;
  for (const lga of PRIORITY_URBAN) {
    const batches = await prisma.sydneyIndexBatch.findMany({
      where: {
        runId,
        lga,
        status: "QUEUED",
        NOT: { tileKey: { startsWith: "!priority:" } },
      },
      orderBy: { tileKey: "asc" },
      take: extrasPerLga,
    });
    for (const b of batches) {
      await prisma.sydneyIndexBatch.update({
        where: { id: b.id },
        data: { tileKey: `!priority:urban:${b.tileKey}` },
      });
      n++;
    }
  }
  return n;
}

async function retirePreviewSeedStories() {
  // Preview helpers must not feed production Today.
  const e = await prisma.intelChangeEvent.updateMany({
    where: { changeKey: { startsWith: "seed:" } },
    data: { lifecycleStatus: "FIXTURE", material: false },
  });
  // Stories keyed/titled from seed helpers — mark FIXTURE so Today ignores them.
  const r = await prisma.intelligenceStory.updateMany({
    where: {
      OR: [
        { dedupeKey: { startsWith: "seed:" } },
        { dedupeKey: { contains: ":seed:" } },
        { mapHref: { contains: "seed-" } },
        { title: { contains: "Burwood corridor" } },
        { title: { contains: "Key-site program update" } },
        { title: { contains: "HDA recommendation — Parramatta" } },
        { title: { contains: "SSD status change — City of Sydney" } },
      ],
    },
    data: { lifecycleStatus: "FIXTURE", material: false },
  });
  return { stories: r.count, events: e.count };
}

async function main() {
  const targetBatches = Number(process.env.SYDNEY_INDEX_TARGET_BATCHES ?? "150");
  const batchesPerWave = Number(process.env.SYDNEY_INDEX_WAVE_SIZE ?? "8");

  const retired = await retirePreviewSeedStories();
  console.log("retired preview seeds", retired);

  const fresh = await invalidatePriorRunsAndStartFresh({
    reason: "INVALIDATED_PRE_LOCKBBOX — corrected geography re-run for acceptance",
  });
  console.log(JSON.stringify({ fresh }, null, 2));

  const onePer = await prioritizeOnePerLga(fresh.newRunId);
  const urban = await prioritizeUrbanExtras(fresh.newRunId, 3);
  console.log(JSON.stringify({ prioritizedOnePerLga: onePer, prioritizedUrbanExtras: urban }, null, 2));

  let wave = 0;
  while (true) {
    wave++;
    const r = await runSydneyIndexCron({
      batchesPerInvoke: batchesPerWave,
      marketScope: "sydney-metro",
    });
    console.log(
      JSON.stringify(
        {
          wave,
          status: r.status,
          completed: r.completedBatches,
          candidates: r.candidatesIndexed,
          parcels: r.parcelsProcessed,
          lgas: r.lgasComplete,
          notes: r.notes.slice(0, 12),
          errors: r.errors.slice(0, 5),
        },
        null,
        2,
      ),
    );
    if (r.status === "COMPLETE") break;
    if (r.completedBatches >= targetBatches) {
      console.log(`Reached target ~${targetBatches} batches — stopping wave loop`);
      break;
    }
    // Safety: stop if a wave produced nothing (stuck)
    if (!r.notes.length && r.completedBatches === 0) break;
  }

  const metrics = await getSydneyIndexMetrics();
  const lgaAttempted = await prisma.sydneyIndexBatch.groupBy({
    by: ["lga"],
    where: { runId: fresh.newRunId, status: { in: ["COMPLETE", "FAILED"] } },
  });
  const lgaCandidate = await prisma.siteCandidateIndex.groupBy({
    by: ["lga"],
    where: {
      lifecycleStatus: "ACTIVE",
      provenance: "INDEX_DISCOVERY",
      indexRunId: fresh.newRunId,
    },
    _count: { _all: true },
  });
  console.log(
    JSON.stringify(
      {
        runId: fresh.newRunId,
        metrics: metrics.run,
        uniqueCandidates: metrics.uniqueCandidates,
        byKind: metrics.byKind,
        coverage: metrics.coverage,
        lgasAttempted: lgaAttempted.length,
        lgasAttemptedNames: lgaAttempted.map((x) => x.lga).sort(),
        candidateProducingLgas: lgaCandidate
          .map((x) => ({ lga: x.lga, count: x._count._all }))
          .sort((a, b) => b.count - a.count),
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
