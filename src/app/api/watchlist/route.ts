import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, jsonError } from "@/lib/session";
import { createWatchItem, ensureDefaultWatchlist, listWatchItems } from "@/lib/monitoring/watchlist";
import { watchFiltersSchema, bboxSchema } from "@/lib/monitoring/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  await ensureDefaultWatchlist(session.userId);
  return NextResponse.json({ items: await listWatchItems(session.userId) });
}

const createSchema = z.object({
  kind: z.enum(["SUBURB", "MAP_AREA", "PRECINCT", "PARCEL", "OPPORTUNITY"]),
  label: z.string().trim().min(1).max(160),
  suburb: z.string().trim().min(1).max(80).optional().nullable(),
  bbox: bboxSchema.optional().nullable(),
  precinctId: z.string().optional().nullable(),
  externalParcelId: z.string().optional().nullable(),
  opportunityId: z.string().optional().nullable(),
  filters: watchFiltersSchema.optional(),
  notes: z.string().max(2000).optional().nullable(),
  scanCadence: z.enum(["MANUAL", "DAILY", "WEEKLY"]).optional(),
});

export async function POST(req: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid watch item: " + parsed.error.issues[0]?.message);
  const item = await createWatchItem({ userId: session.userId, ...parsed.data });
  return NextResponse.json(item, { status: 201 });
}
