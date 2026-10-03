import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, jsonError } from "@/lib/session";
import { createAlertRule, listAlertEvents, listAlertRules } from "@/lib/monitoring/alerts";
import { alertCriteriaSchema } from "@/lib/monitoring/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const url = new URL(req.url);
  if (url.searchParams.get("events") === "1") {
    return NextResponse.json({ events: await listAlertEvents(session.userId) });
  }
  return NextResponse.json({ rules: await listAlertRules(session.userId) });
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(160),
  criteria: alertCriteriaSchema,
  watchItemId: z.string().optional().nullable(),
});

export async function POST(req: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid alert rule: " + parsed.error.issues[0]?.message);
  const rule = await createAlertRule({ userId: session.userId, ...parsed.data });
  return NextResponse.json(rule, { status: 201 });
}
