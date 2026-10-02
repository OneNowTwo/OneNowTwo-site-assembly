import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ACTIVITY_TYPES } from "@/lib/constants";
import { jsonError } from "@/lib/session";

type Ctx = { params: Promise<{ id: string; lotId: string }> };

const schema = z.object({
  type: z.enum(ACTIVITY_TYPES),
  note: z.string().max(5000).nullable().optional(),
  activityDate: z.string().optional(),
  nextAction: z.string().max(300).nullable().optional(),
  nextActionDate: z.string().nullable().optional(),
});

const CONTACT_TYPES = new Set(["LETTER", "DOOR_KNOCK", "CALL", "EMAIL", "MEETING", "OFFER"]);

export async function POST(req: Request, { params }: Ctx) {
  const { id, lotId } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid activity");
  const op = await prisma.opportunityParcel.findFirst({ where: { id: lotId, opportunityId: id } });
  if (!op) return jsonError("Lot not found", 404);
  const d = parsed.data;
  const activityDate = d.activityDate ? new Date(d.activityDate) : new Date();
  const nextActionDate = d.nextActionDate ? new Date(d.nextActionDate) : null;
  const activity = await prisma.acquisitionActivity.create({
    data: { opportunityParcelId: lotId, type: d.type, note: d.note ?? null, activityDate, nextAction: d.nextAction ?? null, nextActionDate },
  });
  await prisma.opportunityParcel.update({
    where: { id: lotId },
    data: {
      ...(CONTACT_TYPES.has(d.type) ? { lastContactAt: activityDate } : {}),
      ...(d.nextAction ? { nextAction: d.nextAction, nextActionDate } : {}),
    },
  });
  await prisma.opportunity.update({ where: { id }, data: { updatedAt: new Date() } });
  return NextResponse.json({ id: activity.id }, { status: 201 });
}
