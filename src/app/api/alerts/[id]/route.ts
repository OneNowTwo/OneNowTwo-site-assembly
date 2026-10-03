import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, jsonError } from "@/lib/session";
import { updateAlertRule } from "@/lib/monitoring/alerts";
import { alertCriteriaSchema } from "@/lib/monitoring/types";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  criteria: alertCriteriaSchema.optional(),
  active: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: Ctx) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid patch");
  const rule = await updateAlertRule(id, session.userId, parsed.data);
  if (!rule) return jsonError("Not found", 404);
  return NextResponse.json(rule);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const { id } = await params;
  const existing = await prisma.alertRule.findFirst({ where: { id, userId: session.userId } });
  if (!existing) return jsonError("Not found", 404);
  await prisma.alertRule.update({ where: { id }, data: { active: false } });
  return NextResponse.json({ ok: true });
}
