import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getGlobalAssumptions, loadOpportunity, serializeOpportunity } from "@/lib/opportunity-service";
import { jsonError } from "@/lib/session";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const money = z.number().min(0).max(1e10);
const optionalMoney = money.nullable().optional();
const str = (max: number) => z.string().max(max).nullable().optional();

const createSchema = z.object({
  type: z.enum(["ACQUISITION", "EXIT"]),
  parcelId: z.string().nullable().optional(),
  address: z.string().trim().min(1).max(300),
  salePrice: money,
  saleDate: z.string().nullable().optional(),
  propertyType: str(80),
  bedrooms: z.number().min(0).max(20).nullable().optional(),
  bathrooms: z.number().min(0).max(20).nullable().optional(),
  parking: z.number().min(0).max(20).nullable().optional(),
  landArea: optionalMoney,
  internalArea: optionalMoney,
  externalArea: optionalMoney,
  saleableArea: optionalMoney,
  pricePerSqm: optionalMoney,
  newBuildStatus: str(40),
  unitType: str(40),
  source: z.string().max(80).default("MANUAL"),
  sourceReference: str(300),
  included: z.boolean().optional(),
  notes: str(2000),
  distanceM: z.number().min(0).nullable().optional(),
  dataDate: z.string().nullable().optional(),
});

function pricePerSqm(salePrice: number, saleableArea: number | null | undefined, internalArea: number | null | undefined) {
  const area = saleableArea && saleableArea > 0 ? saleableArea : internalArea && internalArea > 0 ? internalArea : null;
  return area ? salePrice / area : null;
}

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const rows = await prisma.comparableSale.findMany({ where: { opportunityId: id }, orderBy: { createdAt: "asc" } });
  return NextResponse.json(rows);
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const exists = await prisma.opportunity.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return jsonError("Opportunity not found", 404);
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid comparable: " + parsed.error.issues[0]?.message);
  const d = parsed.data;
  await prisma.comparableSale.create({
    data: {
      opportunityId: id,
      type: d.type,
      parcelId: d.parcelId ?? null,
      address: d.address,
      salePrice: d.salePrice,
      saleDate: d.saleDate ? new Date(d.saleDate) : null,
      propertyType: d.propertyType ?? null,
      bedrooms: d.bedrooms ?? null,
      bathrooms: d.bathrooms ?? null,
      parking: d.parking ?? null,
      landArea: d.landArea ?? null,
      internalArea: d.internalArea ?? null,
      externalArea: d.externalArea ?? null,
      saleableArea: d.saleableArea ?? null,
      pricePerSqm: d.pricePerSqm ?? pricePerSqm(d.salePrice, d.saleableArea, d.internalArea),
      newBuildStatus: d.newBuildStatus ?? null,
      unitType: d.unitType ?? null,
      source: d.source || "MANUAL",
      sourceReference: d.sourceReference ?? null,
      included: d.included ?? true,
      notes: d.notes ?? null,
      distanceM: d.distanceM ?? null,
      dataDate: d.dataDate ? new Date(d.dataDate) : null,
    },
  });
  const opp = await loadOpportunity(id);
  return NextResponse.json(serializeOpportunity(opp!, await getGlobalAssumptions()), { status: 201 });
}
