import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { assumptionsSchema, DEFAULT_ASSUMPTIONS } from "@/lib/analysis/assumptions";
import { getGlobalAssumptions, recomputeOpportunity } from "@/lib/opportunity-service";
import { jsonError } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ values: await getGlobalAssumptions(), defaults: DEFAULT_ASSUMPTIONS });
}

export async function PUT(req: Request) {
  const parsed = assumptionsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid assumptions: " + parsed.error.issues[0]?.path.join(".") + " " + parsed.error.issues[0]?.message);
  await prisma.globalAssumptions.upsert({ where: { id: "global" }, create: { id: "global", values: parsed.data }, update: { values: parsed.data } });
  // Saved opportunities inherit globals unless overridden; refresh their cached summaries.
  const opps = await prisma.opportunity.findMany({ select: { id: true } });
  for (const o of opps) await recomputeOpportunity(o.id);
  return NextResponse.json({ values: parsed.data });
}
