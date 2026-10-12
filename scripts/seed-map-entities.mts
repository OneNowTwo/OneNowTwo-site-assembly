/**
 * DEVELOPMENT / PREVIEW ONLY.
 * Never run as part of production deploy, cron, or Sydney baseline indexing.
 * Guard: requires ALLOW_PREVIEW_SEED=1 and refuses NODE_ENV=production.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";

function assertPreviewOnly() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PREVIEW_SEED !== "1") {
    throw new Error("seed-map-entities is preview-only — refused in production (set ALLOW_PREVIEW_SEED=1 only for local demos)");
  }
  if (process.env.ALLOW_PREVIEW_SEED !== "1") {
    throw new Error("seed-map-entities refused — set ALLOW_PREVIEW_SEED=1 for local/preview use only");
  }
}

async function main() {
  assertPreviewOnly();
  await prisma.planningChangeArea.upsert({
    where: { id: "seed-iw" },
    create: {
      id: "seed-iw",
      title: "Inner West planning program (seed)",
      status: "EXHIBITION",
      authority: "Inner West Council",
      lgas: ["Inner West"],
      suburbs: ["Marrickville", "Ashfield"],
      sourceUrl: "https://www.innerwest.nsw.gov.au/",
      bbox: { west: 151.12, south: -33.92, east: 151.22, north: -33.85 },
      proposedControls: { fsr: 2.5 },
    },
    update: { status: "EXHIBITION" },
  });
  await prisma.keySite.upsert({
    where: { id: "seed-iw:KS_SEED" },
    create: {
      id: "seed-iw:KS_SEED",
      planningChangeAreaId: "seed-iw",
      externalKeySiteId: "KS_SEED",
      name: "Key Site KS_SEED",
      bbox: { west: 151.15, south: -33.90, east: 151.17, north: -33.88 },
      proposedControls: { fsr: 2.7 },
      requirements: { requiredCount: 4 },
    },
    update: { name: "Key Site KS_SEED" },
  });
  await prisma.planningChangeArea.upsert({
    where: { id: "seed-burwood" },
    create: {
      id: "seed-burwood",
      title: "Burwood corridor proposed controls",
      status: "EXHIBITION",
      lgas: ["Burwood"],
      suburbs: ["Burwood"],
      bbox: { west: 151.08, south: -33.90, east: 151.13, north: -33.86 },
      proposedControls: { fsr: 2.7 },
    },
    update: {},
  });

  const email = process.env.AUTH_EMAIL || "harry@example.com";
  const u = await prisma.user.upsert({
    where: { email },
    create: { email, name: "Harry" },
    update: { name: "Harry" },
  });
  await prisma.watchItem.updateMany({ where: { userId: u.id }, data: { active: false } });
  console.log("ok", email);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
