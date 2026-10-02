import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createOpportunity } from "@/lib/opportunity-service";
import { STAGE_PROGRESS } from "@/lib/constants";
import { jsonError, requireSession } from "@/lib/session";
import type { ParcelData } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await prisma.opportunity.findMany({
    orderBy: { updatedAt: "desc" },
    include: { parcels: { select: { acquisitionStage: true, included: true } } },
  });
  return NextResponse.json(
    rows.map((o) => {
      const inc = o.parcels.filter((p) => p.included);
      return {
        id: o.id,
        name: o.name,
        status: o.status,
        suburb: o.suburb,
        lga: o.lga,
        demoFinancialData: o.demoFinancialData,
        lotCount: inc.length,
        totalSiteArea: o.totalSiteArea,
        score: o.score,
        grv: o.grv,
        maxLandBudget: o.maxLandBudget,
        profit: o.profit,
        marginOnCost: o.marginOnCost,
        combinedMarketValue: o.combinedMarketValue,
        acquisitionProgress: inc.length ? inc.reduce((s, p) => s + STAGE_PROGRESS[p.acquisitionStage], 0) / inc.length : 0,
        controlledCount: inc.filter((p) => p.acquisitionStage === "CONTROLLED").length,
        updatedAt: o.updatedAt.toISOString(),
      };
    }),
  );
}

const polygon = z.object({ type: z.enum(["Polygon", "MultiPolygon"]), coordinates: z.array(z.any()).min(1) });
const parcelSchema = z.object({
  externalParcelId: z.string().regex(/^nsw-cadid:\d+$/),
  source: z.enum(["LIVE_NSW", "CACHED_NSW", "MANUAL"]),
  lot: z.string().nullable(),
  section: z.string().nullable(),
  dp: z.string().nullable(),
  lotIdString: z.string().nullable(),
  address: z.string().nullable(),
  suburb: z.string().nullable(),
  geometry: polygon,
  centroid: z.tuple([z.number(), z.number()]),
  areaSqm: z.number().positive(),
  isStrata: z.boolean(),
  planning: z.any().nullable(),
  planningStatus: z.enum(["ok", "partial", "unavailable"]),
  retrievedAt: z.string(),
});
const createSchema = z.object({ name: z.string().trim().min(1).max(160), parcels: z.array(parcelSchema).min(1).max(12) });

export async function POST(req: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid opportunity: " + parsed.error.issues[0]?.message);
  const opp = await createOpportunity({ name: parsed.data.name, parcels: parsed.data.parcels as ParcelData[], userId: session.userId });
  return NextResponse.json({ id: opp.id }, { status: 201 });
}
