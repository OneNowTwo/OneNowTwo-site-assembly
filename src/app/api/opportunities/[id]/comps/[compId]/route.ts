import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getGlobalAssumptions, loadOpportunity, serializeOpportunity } from "@/lib/opportunity-service";
import { jsonError } from "@/lib/session";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string; compId: string }> };

const money = z.number().min(0).max(1e10);
const optionalMoney = money.nullable().optional();
const str = (max: number) => z.string().max(max).nullable().optional();

const patchSchema = z.object({
  address: z.string().trim().min(1).max(300).optional(),
  salePrice: money.optional(),
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
  source: z.string().max(80).optional(),
  sourceReference: str(300),
  included: z.boolean().optional(),
  notes: str(2000),
  distanceM: z.number().min(0).nullable().optional(),
});

export async function PATCH(req: Request, { params }: Ctx) {
  const { id, compId } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid update: " + parsed.error.issues[0]?.message);
  const existing = await prisma.comparableSale.findFirst({ where: { id: compId, opportunityId: id } });
  if (!existing) return jsonError("Comparable not found", 404);
  const d = parsed.data;
  const salePrice = d.salePrice ?? existing.salePrice;
  const saleableArea = d.saleableArea !== undefined ? d.saleableArea : existing.saleableArea;
  const internalArea = d.internalArea !== undefined ? d.internalArea : existing.internalArea;
  const area = saleableArea && saleableArea > 0 ? saleableArea : internalArea && internalArea > 0 ? internalArea : null;
  await prisma.comparableSale.update({
    where: { id: compId },
    data: {
      ...d,
      saleDate: d.saleDate === undefined ? undefined : d.saleDate ? new Date(d.saleDate) : null,
      pricePerSqm: d.pricePerSqm !== undefined ? d.pricePerSqm : area ? salePrice / area : existing.pricePerSqm,
    },
  });
  const opp = await loadOpportunity(id);
  return NextResponse.json(serializeOpportunity(opp!, await getGlobalAssumptions()));
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id, compId } = await params;
  await prisma.comparableSale.deleteMany({ where: { id: compId, opportunityId: id } });
  const opp = await loadOpportunity(id);
  if (!opp) return jsonError("Opportunity not found", 404);
  return NextResponse.json(serializeOpportunity(opp, await getGlobalAssumptions()));
}
