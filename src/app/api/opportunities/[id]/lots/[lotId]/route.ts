import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getGlobalAssumptions, loadOpportunity, recomputeOpportunity, serializeOpportunity } from "@/lib/opportunity-service";
import { ACQUISITION_STAGES, STAGE_LABELS } from "@/lib/constants";
import { jsonError } from "@/lib/session";
import type { Prisma } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string; lotId: string }> };

const money = z.number().min(0).max(1e10).nullable();
const str = (max: number) => z.string().max(max).nullable();
const dateStr = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).nullable();

const patchSchema = z.object({
  included: z.boolean().optional(),
  marketValue: money.optional(),
  marketValueSource: z.enum(["USER_ESTIMATE", "COMPARABLE_DERIVED", "LIVE_PROVIDER", "SYSTEM_ESTIMATE", "DEMO"]).nullable().optional(),
  marketValueConfidence: str(80).optional(),
  landValuePerSqm: money.optional(),
  comparableValue: money.optional(),
  maxAllocationOverride: money.optional(),
  openingOfferOverride: money.optional(),
  strategicWeight: z.number().min(0).max(20).nullable().optional(),
  acquisitionStage: z.enum(ACQUISITION_STAGES).optional(),
  lastContactAt: dateStr.optional(),
  nextAction: str(300).optional(),
  nextActionDate: dateStr.optional(),
  approachNotes: str(5000).optional(),
  owner: z
    .object({ name: str(200), ownerType: str(80), phone: str(80), email: str(200), mailingAddress: str(300), notes: str(3000) })
    .partial()
    .optional(),
  /** Manual planning input when the NSW service is unavailable or a planner has confirmed different controls. */
  planning: z
    .object({ zone: str(10), zoneName: str(100), fsr: z.number().min(0).max(30).nullable(), heightM: z.number().min(0).max(400).nullable(), minLotSizeSqm: z.number().min(0).nullable(), heritage: str(300) })
    .partial()
    .optional(),
});

const toDate = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : new Date(v));

export async function PATCH(req: Request, { params }: Ctx) {
  const { id, lotId } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid update: " + parsed.error.issues[0]?.path.join(".") + " " + parsed.error.issues[0]?.message);
  const op = await prisma.opportunityParcel.findFirst({ where: { id: lotId, opportunityId: id }, include: { parcel: true } });
  if (!op) return jsonError("Lot not found", 404);
  const { owner, planning, lastContactAt, nextActionDate, ...fields } = parsed.data;

  await prisma.$transaction(async (tx) => {
    await tx.opportunityParcel.update({
      where: { id: lotId },
      data: { ...fields, lastContactAt: toDate(lastContactAt), nextActionDate: toDate(nextActionDate) },
    });
    if (fields.acquisitionStage && fields.acquisitionStage !== op.acquisitionStage) {
      await tx.acquisitionActivity.create({
        data: {
          opportunityParcelId: lotId,
          type: "STAGE_CHANGE",
          note: `${STAGE_LABELS[op.acquisitionStage]} → ${STAGE_LABELS[fields.acquisitionStage]}`,
          stageFrom: op.acquisitionStage,
          stageTo: fields.acquisitionStage,
        },
      });
    }
    if (owner) {
      await tx.ownerContact.upsert({ where: { opportunityParcelId: lotId }, create: { opportunityParcelId: lotId, ...owner }, update: owner });
    }
    if (planning) {
      const updated = await tx.parcel.update({ where: { id: op.parcelId }, data: { ...planning, planningCheckedAt: new Date() } });
      const field = { kind: "ASSUMPTION", source: "Manual planning input", retrievedAt: new Date().toISOString() };
      await tx.planningSnapshot.create({
        data: {
          parcelId: op.parcelId,
          source: "MANUAL",
          data: {
            zone: updated.zone, zoneName: updated.zoneName, fsr: updated.fsr, heightM: updated.heightM, minLotSizeSqm: updated.minLotSizeSqm,
            heritage: updated.heritage, planningInstrument: updated.planningInstrument, lga: updated.lga,
            sources: Object.fromEntries(Object.keys(planning).map((k) => [k === "zoneName" ? "zone" : k, field])),
          } as Prisma.InputJsonValue,
        },
      });
    }
  });
  await prisma.opportunity.update({ where: { id }, data: { updatedAt: new Date() } });
  await recomputeOpportunity(id);
  const opp = await loadOpportunity(id);
  return NextResponse.json(serializeOpportunity(opp!, await getGlobalAssumptions()));
}
