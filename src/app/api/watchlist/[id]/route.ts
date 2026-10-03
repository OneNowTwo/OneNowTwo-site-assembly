import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, jsonError } from "@/lib/session";
import { deleteWatchItem, updateWatchItem } from "@/lib/monitoring/watchlist";
import { watchFiltersSchema, bboxSchema } from "@/lib/monitoring/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  label: z.string().trim().min(1).max(160).optional(),
  filters: watchFiltersSchema.optional(),
  notes: z.string().max(2000).optional().nullable(),
  scanCadence: z.enum(["MANUAL", "DAILY", "WEEKLY"]).optional(),
  active: z.boolean().optional(),
  bbox: bboxSchema.optional().nullable(),
});

export async function PATCH(req: Request, { params }: Ctx) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid patch");
  const item = await updateWatchItem(id, session.userId, parsed.data);
  if (!item) return jsonError("Not found", 404);
  return NextResponse.json(item);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const { id } = await params;
  const ok = await deleteWatchItem(id, session.userId);
  if (!ok) return jsonError("Not found", 404);
  return NextResponse.json({ ok: true });
}
