import { NextResponse } from "next/server";
import { z } from "zod";
import { CURATED_PLANNING_CHANGES, matchPlanningChanges } from "@/lib/planning/change-registry";
import { planningRuleProvider } from "@/lib/planning/planning-rules-service";
import { jsonError } from "@/lib/session";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  lng: z.coerce.number().optional(),
  lat: z.coerce.number().optional(),
  lga: z.string().optional(),
  suburb: z.string().optional(),
});

/** List pending planning changes (curated official watchlist). Never returns as CURRENT law. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return jsonError("Invalid query");
  const { lng, lat, lga, suburb } = parsed.data;
  if (lng != null && lat != null) {
    const matched = matchPlanningChanges({ lng, lat, lga, suburb });
    return NextResponse.json({ changes: matched, safety: "PROPOSED/PENDING only — not current development rights" });
  }
  return NextResponse.json({
    changes: CURATED_PLANNING_CHANGES,
    safety: "PROPOSED/PENDING only — not current development rights",
    provider: planningRuleProvider.name,
  });
}
