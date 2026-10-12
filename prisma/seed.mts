/**
 * Local / preview seeding.
 *
 * Without --demo: only ensures GlobalAssumptions (same as production bootstrap).
 * With --demo: also seeds the Neutral Bay Assembly Demo opportunity (opt-in).
 *
 *   npm run db:seed              # assumptions only — safe
 *   npm run db:seed:demo         # assumptions + Neutral Bay demo
 *   npm run db:reset-demo        # delete/recreate Neutral Bay demo
 *
 * Production start:render uses scripts/ensure-production-bootstrap.mts — NOT this file.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import pointOnFeature from "@turf/point-on-feature";
import { prisma } from "@/lib/db";
import { DEFAULT_ASSUMPTIONS } from "@/lib/analysis/assumptions";
import {
  DEMO_ACQUISITION_COMPS,
  DEMO_BBOX,
  DEMO_EXIT_COMPS,
  DEMO_INPUTS,
  DEMO_LOTS,
  DEMO_NOTES,
  DEMO_OPPORTUNITY_NAME,
  DEMO_UNIT_MIX,
} from "@/lib/demo";
import { nswCadastreProvider } from "@/lib/data-sources/nsw-cadastre";
import { nswPlanningProvider } from "@/lib/data-sources/nsw-planning";
import { createOpportunity, recomputeOpportunity, syncUnitTypes } from "@/lib/opportunity-service";
import { shouldSeedDemo } from "@/lib/production-bootstrap";
import type { ParcelData } from "@/lib/types";

async function demoParcels(): Promise<{ parcels: ParcelData[]; origin: string }> {
  try {
    const lots = await nswCadastreProvider.getParcelsInBBox(DEMO_BBOX);
    const picked = DEMO_LOTS.map((d) => lots.find((l) => l.lotIdString === d.lotIdString));
    if (picked.some((p) => !p)) throw new Error("demo lots not found in live response");
    const controls = await nswPlanningProvider.getControlsForPoints(
      DEMO_BBOX,
      picked.map((p) => ({ id: p!.externalParcelId, point: pointOnFeature({ type: "Feature", properties: {}, geometry: p!.geometry }).geometry })),
    );
    return {
      parcels: picked.map((p) => ({ ...p!, planning: controls.get(p!.externalParcelId) ?? null, planningStatus: controls.has(p!.externalParcelId) ? "ok" : "unavailable" })),
      origin: "live NSW services",
    };
  } catch (err) {
    const file = path.join(process.cwd(), "prisma/seed-data/neutral-bay-demo-parcels.json");
    const snap = JSON.parse(readFileSync(file, "utf8")) as { retrievedAt: string; parcels: ParcelData[] };
    const byLot = new Map(snap.parcels.map((p) => [p.lotIdString, p]));
    return {
      parcels: DEMO_LOTS.map((d) => ({ ...byLot.get(d.lotIdString)!, source: "CACHED_NSW" as const })),
      origin: `stored NSW snapshot from ${snap.retrievedAt} (${err instanceof Error ? err.message : "live fetch failed"})`,
    };
  }
}

async function ensureAssumptions() {
  await prisma.globalAssumptions.upsert({
    where: { id: "global" },
    create: { id: "global", values: DEFAULT_ASSUMPTIONS },
    update: {},
  });
}

async function seedDemo(reset: boolean) {
  const existing = await prisma.opportunity.findFirst({
    where: { name: DEMO_OPPORTUNITY_NAME, demoFinancialData: true },
  });
  if (existing && !reset) {
    console.log(`Demo opportunity already present (${existing.id}); use --reset to recreate.`);
    return;
  }
  if (existing) await prisma.opportunity.delete({ where: { id: existing.id } });

  const { parcels, origin } = await demoParcels();
  const opp = await createOpportunity({
    name: DEMO_OPPORTUNITY_NAME,
    parcels,
    demoFinancialData: true,
    notes: DEMO_NOTES,
    inputs: DEMO_INPUTS,
  });

  const rows = await prisma.opportunityParcel.findMany({ where: { opportunityId: opp.id }, include: { parcel: true } });
  const now = Date.now();
  for (const d of DEMO_LOTS) {
    const op = rows.find((r) => r.parcel.lotIdString === d.lotIdString)!;
    const contacted = ["LETTER_SENT", "CONTACT_MADE", "INTERESTED"].includes(d.stage);
    await prisma.opportunityParcel.update({
      where: { id: op.id },
      data: {
        marketValue: d.marketValue,
        marketValueSource: "DEMO",
        marketValueConfidence: "Demo fictional estimate",
        acquisitionStage: d.stage,
        approachNotes: d.approachNotes || null,
        lastContactAt: contacted ? new Date(now - 6 * 864e5) : null,
        nextAction: contacted ? "Follow-up call" : d.stage === "NOT_RESEARCHED" ? "Order title search" : "Send introductory letter",
        nextActionDate: new Date(now + 5 * 864e5),
        owner: { create: { name: d.owner.name, ownerType: d.owner.ownerType, notes: d.owner.notes, mailingAddress: op.parcel.address } },
      },
    });
    if (contacted) {
      await prisma.acquisitionActivity.createMany({
        data: [
          {
            opportunityParcelId: op.id,
            type: "LETTER",
            note: "Demo: introductory letter delivered.",
            activityDate: new Date(now - 14 * 864e5),
            stageFrom: "READY_TO_APPROACH",
            stageTo: "LETTER_SENT",
          },
          ...(d.stage === "INTERESTED"
            ? [
                {
                  opportunityParcelId: op.id,
                  type: "DOOR_KNOCK" as const,
                  note: "Demo: spoke with owners; open to a conversation on price.",
                  activityDate: new Date(now - 6 * 864e5),
                  stageFrom: "LETTER_SENT" as const,
                  stageTo: "INTERESTED" as const,
                  nextAction: "Follow-up call",
                  nextActionDate: new Date(now + 5 * 864e5),
                },
              ]
            : []),
        ],
      });
    }
  }

  await syncUnitTypes(opp.id, DEMO_UNIT_MIX);

  for (const c of DEMO_ACQUISITION_COMPS) {
    await prisma.comparableSale.create({
      data: {
        opportunityId: opp.id,
        type: "ACQUISITION",
        address: c.address,
        salePrice: c.salePrice,
        saleDate: new Date(c.saleDate),
        bedrooms: c.bedrooms,
        bathrooms: c.bathrooms,
        parking: c.parking,
        landArea: c.landArea,
        propertyType: c.propertyType,
        distanceM: c.distanceM,
        source: "DEMO",
        included: true,
        notes: c.notes,
        dataDate: new Date(c.saleDate),
      },
    });
  }
  for (const c of DEMO_EXIT_COMPS) {
    await prisma.comparableSale.create({
      data: {
        opportunityId: opp.id,
        type: "EXIT",
        address: c.address,
        salePrice: c.salePrice,
        saleDate: new Date(c.saleDate),
        bedrooms: c.bedrooms,
        bathrooms: c.bathrooms,
        parking: c.parking,
        saleableArea: c.saleableArea,
        pricePerSqm: c.salePrice / c.saleableArea,
        unitType: c.unitType,
        newBuildStatus: c.newBuildStatus,
        source: "DEMO",
        included: true,
        notes: c.notes,
        dataDate: new Date(c.saleDate),
      },
    });
  }

  await prisma.opportunity.update({ where: { id: opp.id }, data: { status: "ACQUIRING" } });
  const analysis = await recomputeOpportunity(opp.id);
  const f = analysis!.base.feasibility;
  console.log(`Seeded "${DEMO_OPPORTUNITY_NAME}" (${opp.id}) from ${origin}`);
  console.log(
    `  site ${Math.round(analysis!.site.siteAreaSqm)} sqm · achievable GFA ${Math.round(analysis!.base.yield.achievableGfa)} · ${analysis!.base.yield.dwellings} dwellings · GRV $${(f.grv / 1e6).toFixed(1)}m`,
  );
  console.log(
    `  existing $${(((analysis!.combinedExistingValue ?? 0) / 1e6).toFixed(2))}m → max payable $${(analysis!.maxPayableToOwners / 1e6).toFixed(2)}m → headroom $${(((analysis!.acquisitionHeadroom ?? 0) / 1e6).toFixed(2))}m (${Math.round((analysis!.acquisitionHeadroomPercent ?? 0) * 100)}%)`,
  );
}

async function main() {
  const reset = process.argv.includes("--reset");
  const wantDemo = shouldSeedDemo(process.argv);

  await ensureAssumptions();
  console.log("GlobalAssumptions ensured (id=global).");

  if (!wantDemo) {
    const opportunityCount = await prisma.opportunity.count();
    console.log(
      `No --demo flag — skipping Neutral Bay / demo Opportunity seed (opportunities in DB: ${opportunityCount}).`,
    );
    console.log("For local demo data: npm run db:seed:demo");
    return;
  }

  await seedDemo(reset);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
