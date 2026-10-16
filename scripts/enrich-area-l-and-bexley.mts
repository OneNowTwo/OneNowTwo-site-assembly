/**
 * Evidence-pass helpers (not a demo seed):
 * 1) Enrich Area L proposed controls from live Inner West FeatureServer centroid query.
 * 2) Clear any prior Bexley planning rows, then persist via live NSW EPI attach.
 *
 * Usage: npx tsx scripts/enrich-area-l-and-bexley.mts
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client";
import {
  enrichKeySiteProposedControls,
  queryInnerWestProposedAtPoint,
} from "../src/lib/source-watcher/adapters/inner-west-live";
import { getParcelsByExternalIds } from "../src/lib/parcel-service";
import type { KeySiteFact } from "../src/lib/source-watcher/types";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const BEXLEY_IDS = [
  "nsw-cadid:102813140", // 39 Beaconsfield Street — 645 sqm
  "nsw-cadid:103811478", // 42 Connemarra Street — 810 sqm
  "nsw-cadid:103821903", // 40 Connemarra Street — 830 sqm
];

async function enrichAreaL() {
  const ks = await prisma.keySite.findFirst({ where: { externalKeySiteId: "Area L" } });
  if (!ks) throw new Error("Area L key site not found in DB");

  const bbox = ks.bbox as { west: number; south: number; east: number; north: number } | null;
  const geom = ks.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  const fact: KeySiteFact = {
    externalKeySiteId: ks.externalKeySiteId,
    name: ks.name,
    bbox,
    geometry: geom,
    geometrySource: "OFFICIAL_FEATURE_SERVICE",
    proposedControls: {
      legalStatus: "PROPOSED",
      machineReadable: true,
      notes: "pre-enrich",
    },
  };

  const enriched = await enrichKeySiteProposedControls(fact);
  const pc = enriched.proposedControls;
  console.log("Area L live enrich:", JSON.stringify(pc, null, 2));

  if (!pc || (pc.zone == null && pc.fsr == null && pc.heightM == null)) {
    // Direct centroid probe for diagnostics
    if (bbox) {
      const mid = {
        lng: (bbox.west + bbox.east) / 2,
        lat: (bbox.south + bbox.north) / 2,
      };
      const probe = await queryInnerWestProposedAtPoint(mid.lng, mid.lat);
      console.log("Direct centroid probe:", probe);
    }
    throw new Error("Area L enrichment returned no structured controls");
  }

  await prisma.keySite.update({
    where: { id: ks.id },
    data: {
      proposedControls: pc as unknown as Prisma.InputJsonValue,
      sourceUrl: ks.sourceUrl ?? "https://experience.arcgis.com/experience/2b5ffd9da4f44cd7b7886b632a180556/page/Page",
    },
  });

  // Keep story payload in sync so Today detail can read proposed controls from payload too.
  const stories = await prisma.intelligenceStory.findMany({
    where: {
      OR: [
        { title: { contains: "Area L", mode: "insensitive" } },
        { payload: { path: ["keySiteIds"], array_contains: ["Area L"] } },
      ],
    },
  });
  for (const s of stories) {
    const payload = (s.payload ?? {}) as Record<string, unknown>;
    await prisma.intelligenceStory.update({
      where: { id: s.id },
      data: {
        payload: {
          ...payload,
          awaitingVerification: false,
          proposedControls: {
            zone: pc.zone,
            fsr: pc.fsr,
            heightM: pc.heightM,
            incentiveFsr: pc.incentiveFsr,
            incentiveHeightM: pc.incentiveHeightM,
            affordableHousingContributionPct: pc.affordableHousingContributionPct,
          },
          previousControls: null,
          evidenceSummary: null,
          evidenceWhyItMatters: null,
          keySiteIds: Array.isArray(payload.keySiteIds)
            ? payload.keySiteIds
            : ["Area L"],
          planningChangeAreaId:
            typeof payload.planningChangeAreaId === "string"
              ? payload.planningChangeAreaId
              : ks.planningChangeAreaId,
          sourceLabel: "Inner West Council — Our Fairer Future",
        } as unknown as Prisma.InputJsonValue,
      },
    });
    console.log("Updated story", s.id, s.title);
  }
}

async function refreshBexleyLivePlanning() {
  // Clear prior planning so we do not rely on a demo seed timestamp.
  const rows = await prisma.parcel.findMany({ where: { externalParcelId: { in: BEXLEY_IDS } } });
  for (const p of rows) {
    await prisma.planningSnapshot.deleteMany({ where: { parcelId: p.id } });
    await prisma.parcel.update({
      where: { id: p.id },
      data: {
        zone: null,
        zoneName: null,
        fsr: null,
        heightM: null,
        lga: p.lga,
        planningInstrument: null,
        planningCheckedAt: null,
        heritage: null,
        minLotSizeSqm: null,
      },
    });
  }
  console.log("Cleared planning on", rows.length, "Bexley parcels");

  // Live NSW EPI attach + persist (parcel-service persistLivePlanning).
  const live = await getParcelsByExternalIds(BEXLEY_IDS, { skipPlanning: false });
  for (const p of live) {
    console.log("LIVE", p.address, {
      zone: p.planning?.zone,
      fsr: p.planning?.fsr,
      heightM: p.planning?.heightM,
      status: p.planningStatus,
      retrievedAt: p.retrievedAt,
      instrument: p.planning?.planningInstrument,
    });
  }
  if (live.some((p) => !p.planning?.zone || p.planning.fsr == null)) {
    throw new Error("Live NSW planning did not return R3/FSR for all Bexley lots");
  }

  // Confirm DB persistence
  const after = await prisma.parcel.findMany({ where: { externalParcelId: { in: BEXLEY_IDS } } });
  for (const p of after) {
    console.log("DB", p.address, {
      zone: p.zone,
      fsr: p.fsr,
      heightM: p.heightM,
      planningCheckedAt: p.planningCheckedAt,
      instrument: p.planningInstrument,
    });
  }
}

async function main() {
  const mode = process.argv[2] ?? "all";
  if (mode === "area-l" || mode === "all") await enrichAreaL();
  if (mode === "bexley" || mode === "all") await refreshBexleyLivePlanning();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
