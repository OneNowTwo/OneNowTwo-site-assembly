import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createOpportunity } from "@/lib/opportunity-service";
import { parseOpportunityInputs } from "@/lib/analysis/assumptions";
import { STAGE_PROGRESS } from "@/lib/constants";
import { jsonError, requireSession } from "@/lib/session";
import type { ParcelData } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const rows = await prisma.opportunity.findMany({
      orderBy: { updatedAt: "desc" },
      include: { parcels: { select: { acquisitionStage: true, included: true } } },
    });
    return NextResponse.json(
      rows.map((o) => {
        const inc = o.parcels.filter((p) => p.included);
        const inputs = parseOpportunityInputs(o.inputs);
        const canonical = inputs.scanProvenance?.canonicalCalculation;
        const effectiveFsr =
          canonical?.effectiveFsr ??
          (inputs.fsrOverrideKind === "SCAN_MODELLED" || inputs.fsrOverrideKind === "USER" ? inputs.fsrOverride : null) ??
          inputs.pathwaySnapshot?.modelledFsr ??
          null;
        return {
          id: o.id,
          name: o.name,
          status: o.status,
          suburb: o.suburb,
          lga: o.lga,
          demoFinancialData: o.demoFinancialData,
          lotCount: inc.length,
          totalSiteArea: o.totalSiteArea,
          score: canonical?.score ?? o.score,
          effectiveFsr,
          grv: canonical?.grv ?? o.grv,
          maxLandBudget: canonical?.maxPayable ?? o.maxLandBudget,
          profit: o.profit,
          marginOnCost: o.marginOnCost,
          combinedMarketValue: o.combinedMarketValue,
          acquisitionHeadroom: canonical?.headroom ?? o.acquisitionHeadroom,
          acquisitionHeadroomPercent: o.acquisitionHeadroomPercent,
          unitCount: o.unitCount,
          acquisitionProgress: inc.length ? inc.reduce((s, p) => s + STAGE_PROGRESS[p.acquisitionStage], 0) / inc.length : 0,
          controlledCount: inc.filter((p) => p.acquisitionStage === "CONTROLLED").length,
          updatedAt: o.updatedAt.toISOString(),
        };
      }),
    );
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Failed to list opportunities", 503);
  }
}

const polygon = z.object({ type: z.enum(["Polygon", "MultiPolygon"]), coordinates: z.array(z.any()).min(1) });
const valuationSchema = z
  .object({
    mid: z.number().nullable(),
    low: z.number().nullable().optional(),
    high: z.number().nullable().optional(),
    status: z.string(),
    confidence: z.string(),
    source: z.string(),
    provider: z.string().nullable().optional(),
    method: z.string().nullable().optional(),
    checkedAt: z.string().nullable().optional(),
    externalId: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
    numberOfComps: z.number().nullable().optional(),
    comps: z.array(z.any()).nullable().optional(),
    subjectLastSale: z.any().nullable().optional(),
    valuationLabel: z.string().nullable().optional(),
  })
  .nullable()
  .optional();

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
  valuation: valuationSchema,
});
const createSchema = z.object({
  name: z.string().trim().min(1).max(160),
  parcels: z.array(parcelSchema).min(1).max(12),
  /** Opportunity inputs — must include fsrOverride + scanProvenance when created from Area Scan. */
  inputs: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid opportunity: " + parsed.error.issues[0]?.message);
  try {
    const opp = await createOpportunity({
      name: parsed.data.name,
      parcels: parsed.data.parcels as ParcelData[],
      userId: session.userId,
      inputs: parsed.data.inputs,
    });
    return NextResponse.json({ id: opp.id }, { status: 201 });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Could not save opportunity", 503);
  }
}
