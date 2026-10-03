import { NextResponse } from "next/server";
import { z } from "zod";
import { CURATED_PLANNING_CHANGES } from "@/lib/planning/change-registry";
import { planningRuleProvider, resolvePendingPlanningChanges } from "@/lib/planning/planning-rules-service";
import { jsonError } from "@/lib/session";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  lng: z.coerce.number().optional(),
  lat: z.coerce.number().optional(),
  lga: z.string().optional(),
  suburb: z.string().optional(),
});

/** List pending planning changes (statewide NSW PP layers + curated watchlist). Never CURRENT law. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return jsonError("Invalid query");
  const { lng, lat, lga, suburb } = parsed.data;
  if (lng != null && lat != null) {
    const matched = await resolvePendingPlanningChanges({ lng, lat, lga, suburb });
    return NextResponse.json({
      changes: matched,
      safety: "PROPOSED/PENDING only — not current development rights",
      provider: planningRuleProvider.name,
    });
  }
  return NextResponse.json({
    changes: CURATED_PLANNING_CHANGES,
    safety: "PROPOSED/PENDING only — not current development rights",
    provider: planningRuleProvider.name,
    note: "Pass lng/lat for statewide spatial match against NSW Planning Proposal layers.",
  });
}
