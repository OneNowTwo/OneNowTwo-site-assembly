import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const ks = await prisma.keySite.findFirst({
    where: { externalKeySiteId: "Area L" },
    include: { planningChangeArea: true },
  });
  console.log("KEYSITE", JSON.stringify({
    id: ks?.id,
    name: ks?.name,
    pcaId: ks?.planningChangeAreaId,
    sourceUrl: ks?.sourceUrl,
    currentControls: ks?.currentControls,
    proposedControls: ks?.proposedControls,
    incentiveControls: ks?.incentiveControls,
    requirements: ks?.requirements,
    requiredParcelHints: ks?.requiredParcelHints,
    bbox: ks?.bbox,
  }, null, 2));
  console.log("PCA", JSON.stringify({
    id: ks?.planningChangeArea?.id,
    title: ks?.planningChangeArea?.title,
    status: ks?.planningChangeArea?.status,
    lgas: ks?.planningChangeArea?.lgas,
    sourceUrl: ks?.planningChangeArea?.sourceUrl,
    exhibitionEnd: ks?.planningChangeArea?.exhibitionEnd,
    proposedControls: ks?.planningChangeArea?.proposedControls,
    authority: ks?.planningChangeArea?.authority,
    lastCheckedAt: ks?.planningChangeArea?.lastCheckedAt,
  }, null, 2));

  const events = await prisma.intelChangeEvent.findMany({
    where: {
      OR: [
        { title: { contains: "Area L", mode: "insensitive" } },
        { summary: { contains: "Area L", mode: "insensitive" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  for (const e of events) {
    console.log("---EVENT", e.kind, e.title);
    console.log(JSON.stringify({ summary: e.summary, oldValue: e.oldValue, newValue: e.newValue, href: e.href, sourceId: e.sourceId, createdAt: e.createdAt, material: e.material }, null, 2).slice(0, 2500));
  }

  const story = await prisma.intelligenceStory.findFirst({
    where: { title: { contains: "Area L" }, strategyTags: { has: "APARTMENTS" } },
  });
  console.log("STORY", JSON.stringify(story, null, 2)?.slice(0, 2000));

  // Bexley planning state (may have been seeded earlier — report honestly)
  const ids = ["nsw-cadid:102813140","nsw-cadid:103821903","nsw-cadid:103811478"];
  const parcels = await prisma.parcel.findMany({ where: { externalParcelId: { in: ids } } });
  for (const p of parcels) {
    console.log("PARCEL", p.address, { zone: p.zone, fsr: p.fsr, heightM: p.heightM, planningCheckedAt: p.planningCheckedAt, instrument: p.planningInstrument, lga: p.lga });
    const snaps = await prisma.planningSnapshot.findMany({ where: { parcelId: p.id }, orderBy: { retrievedAt: "desc" }, take: 2 });
    console.log("  snaps", snaps.map(s => ({ source: s.source, retrievedAt: s.retrievedAt, dataKeys: s.data && typeof s.data==='object' ? Object.keys(s.data as object) : null })));
  }
}
main().finally(() => prisma.$disconnect());
