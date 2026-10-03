import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  ensureModelledPlanningOverride,
  getGlobalAssumptions,
  loadOpportunity,
  recomputeOpportunity,
  serializeOpportunity,
  syncUnitTypes,
} from "@/lib/opportunity-service";
import { opportunityInputsSchema } from "@/lib/analysis/assumptions";
import { OPPORTUNITY_STATUSES } from "@/lib/constants";
import { jsonError } from "@/lib/session";
import type { Prisma } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  let opp = await loadOpportunity(id);
  if (!opp) return jsonError("Opportunity not found", 404);
  // Missing LEP FSR → try CURRENT State pathway before the UI shows a fake 0:1.
  const planning = await ensureModelledPlanningOverride(id);
  if (planning.applied) {
    await recomputeOpportunity(id);
    opp = await loadOpportunity(id);
    if (!opp) return jsonError("Opportunity not found", 404);
  }
  return NextResponse.json(serializeOpportunity(opp, await getGlobalAssumptions()));
}

const patchSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  status: z.enum(OPPORTUNITY_STATUSES).optional(),
  notes: z.string().max(5000).nullable().optional(),
  inputs: opportunityInputsSchema.optional(),
});

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid update: " + parsed.error.issues[0]?.path.join(".") + " " + parsed.error.issues[0]?.message);
  const exists = await prisma.opportunity.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return jsonError("Opportunity not found", 404);
  const { inputs, ...rest } = parsed.data;
  await prisma.opportunity.update({ where: { id }, data: { ...rest, ...(inputs ? { inputs: inputs as Prisma.InputJsonValue } : {}) } });
  if (inputs?.unitMix) await syncUnitTypes(id, inputs.unitMix);
  await recomputeOpportunity(id);
  const opp = await loadOpportunity(id);
  return NextResponse.json(serializeOpportunity(opp!, await getGlobalAssumptions()));
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  await prisma.opportunity.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
