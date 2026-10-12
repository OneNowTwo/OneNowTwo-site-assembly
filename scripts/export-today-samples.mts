import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "../src/lib/db";
import { listTodaySiteCandidates } from "../src/lib/intelligence/site-candidate-index";
import { DEFAULT_STRATEGY_PROFILE } from "../src/lib/source-watcher/strategy-profile";

async function main() {
  const { candidates } = await listTodaySiteCandidates(DEFAULT_STRATEGY_PROFILE, { limit: 10 });
  const samples = [];
  for (const c of candidates.slice(0, 5)) {
    const row = await prisma.siteCandidateIndex.findUnique({ where: { id: c.id } });
    const batch = row?.indexBatchId
      ? await prisma.sydneyIndexBatch.findUnique({ where: { id: row.indexBatchId } })
      : null;
    const refs = (row?.sourceRefs ?? {}) as Record<string, unknown>;
    samples.push({
      canonicalKey: row?.canonicalKey,
      address: row?.address,
      actualLga: row?.lga,
      suburb: row?.suburb,
      indexBatchId: row?.indexBatchId,
      indexRunId: row?.indexRunId,
      batchLga: refs.batchLga ?? batch?.lga ?? null,
      tileKey: refs.tileKey ?? batch?.tileKey ?? null,
      parcelIds: row?.parcelIds,
      whyItRanked: row?.reasonHints,
      quickScore: row?.quickScore,
      strategyScores: row?.strategyScores,
      provenance: row?.provenance,
      mapDeepLink: c.href,
    });
  }
  const out = process.argv[2] || "/tmp/today-sample-candidates.json";
  writeFileSync(out, JSON.stringify(samples, null, 2));
  console.log(JSON.stringify({ written: out, count: samples.length, samples }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
