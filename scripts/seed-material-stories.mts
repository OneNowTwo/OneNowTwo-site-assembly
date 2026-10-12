/**
 * DEVELOPMENT / PREVIEW ONLY.
 * Never run as part of production deploy, cron, or Sydney baseline indexing.
 * Guard: requires ALLOW_PREVIEW_SEED=1 and refuses NODE_ENV=production.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { persistIntelligenceStories } from "../src/lib/intelligence/persist-stories";
import { getSydneyIndexMetrics } from "../src/lib/intelligence/sydney-index-pipeline";

function assertPreviewOnly() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PREVIEW_SEED !== "1") {
    throw new Error("seed-material-stories is preview-only — refused in production (set ALLOW_PREVIEW_SEED=1 only for local demos)");
  }
  if (process.env.ALLOW_PREVIEW_SEED !== "1") {
    throw new Error("seed-material-stories refused — set ALLOW_PREVIEW_SEED=1 for local/preview use only");
  }
}

async function main() {
  assertPreviewOnly();
  const seeds = [
    {
      kind: "FSR_PROPOSED_CHANGE" as const,
      title: "Proposed FSR uplift — Burwood corridor",
      summary: "Proposed FSR 1.5 → 2.7 under exhibited planning controls. PROPOSED only — not current law.",
      changeKey: "seed:fsr:burwood:1.5-2.7",
      importance: 8,
      payload: { lga: "Burwood", suburb: "Burwood" },
      newValue: { fsr: 2.7 },
      oldValue: { fsr: 1.5 },
      href: "/map?pca=seed-burwood",
    },
    {
      kind: "KEY_SITE_CREATED" as const,
      title: "Key-site program update — Inner West",
      summary: "12 key sites with amalgamation requirements across the planning program.",
      changeKey: "seed:keysite:iw:program",
      importance: 7.5,
      payload: { lga: "Inner West", externalKeySiteId: "KS_SEED" },
      newValue: { externalKeySiteId: "KS_SEED", requirements: { requiredCount: 4 } },
      href: "/map?pca=seed-iw&keySite=KS_SEED",
    },
    {
      kind: "HDA_RECOMMENDATION_CHANGED" as const,
      title: "New HDA recommendation — Parramatta",
      summary: "Housing Delivery Authority recommendation published for a Parramatta corridor site.",
      changeKey: "seed:hda:parramatta:1",
      importance: 7,
      payload: { lga: "Parramatta", suburb: "Parramatta", lat: -33.815, lng: 151.001 },
      newValue: { recommendation: "recommended" },
      href: "/map?activityId=seed-hda-1&lat=-33.815&lng=151.001&zoom=15",
    },
    {
      kind: "SSD_STATUS_CHANGED" as const,
      title: "SSD status change — City of Sydney riverfront",
      summary: "State significant development stage updated; dwelling yield implications for nearby assemblies.",
      changeKey: "seed:ssd:cos:1",
      importance: 6.5,
      payload: { lga: "City of Sydney", lat: -33.87, lng: 151.21 },
      newValue: { status: "Exhibition" },
      href: "/map?activityId=seed-ssd-1&lat=-33.87&lng=151.21&zoom=15",
    },
  ];

  for (const s of seeds) {
    await prisma.intelChangeEvent.upsert({
      where: { changeKey: s.changeKey },
      create: { ...s, material: true, lifecycleStatus: "ACTIVE", runPurpose: "CHANGE" },
      update: {
        material: true,
        lifecycleStatus: "ACTIVE",
        title: s.title,
        summary: s.summary,
        importance: s.importance,
      },
    });
  }

  const stories = await persistIntelligenceStories({ strategies: ["APARTMENTS"] });
  const metrics = await getSydneyIndexMetrics();
  console.log(
    JSON.stringify(
      {
        storiesUpserted: stories.upserted,
        uniqueCandidates: metrics.uniqueCandidates,
        byKind: metrics.byKind,
        coverage: metrics.coverage,
        run: metrics.run,
        sampleLgas: [...new Set(metrics.sampleByRegion.map((s) => s.lga))].filter(Boolean),
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
