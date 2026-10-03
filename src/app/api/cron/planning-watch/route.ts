import { NextResponse } from "next/server";
import { planningRuleProvider } from "@/lib/planning/planning-rules-service";
import { CURATED_PLANNING_CHANGES } from "@/lib/planning/change-registry";

export const dynamic = "force-dynamic";

/**
 * Render cron / external scheduler target.
 * Auth: CRON_SECRET bearer optional. Does NOT rewrite current-law controls.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  const result = await planningRuleProvider.refreshFromOfficialSources?.();
  return NextResponse.json({
    ok: true,
    cadence: "daily recommended",
    watchlistCount: CURATED_PLANNING_CHANGES.length,
    ...result,
    note: "Pending changes stay PROPOSED/GATEWAY/EXHIBITED until legally commenced. Current feasibility is never silently rewritten.",
  });
}

export async function GET(req: Request) {
  return POST(req);
}
