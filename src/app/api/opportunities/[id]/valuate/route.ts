import { NextResponse } from "next/server";
import { autoValueOpportunity, getGlobalAssumptions, loadOpportunity, serializeOpportunity } from "@/lib/opportunity-service";
import { jsonError, requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/** Auto-value lots missing market values via NSW registered comps (Domain optional). */
export async function POST(_req: Request, { params }: Ctx) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const { id } = await params;
  const opp = await loadOpportunity(id);
  if (!opp) return jsonError("Opportunity not found", 404);
  try {
    const result = await autoValueOpportunity(id);
    const fresh = await loadOpportunity(id);
    if (!fresh) return jsonError("Opportunity not found", 404);
    return NextResponse.json({
      ...serializeOpportunity(fresh, await getGlobalAssumptions()),
      valuationRun: result,
    });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Auto-valuation failed", 503);
  }
}
