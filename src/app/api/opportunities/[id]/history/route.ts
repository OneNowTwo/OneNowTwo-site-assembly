import { NextResponse } from "next/server";
import { requireSession, jsonError } from "@/lib/session";
import { listOpportunityHistory } from "@/lib/monitoring/change-history";
import { loadOpportunity } from "@/lib/opportunity-service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const { id } = await params;
  const opp = await loadOpportunity(id);
  if (!opp) return jsonError("Opportunity not found", 404);
  const events = await listOpportunityHistory(id, 80);
  return NextResponse.json({ events });
}
