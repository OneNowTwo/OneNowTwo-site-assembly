import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "@/lib/session";
import {
  resolveKeySitesWithParcels,
  resolveProposedPlanningAtPoint,
  resolveProposedPlanningForPoint,
} from "@/lib/source-watcher";
import { loadProposedPlanningAreas } from "@/lib/source-watcher/load-persisted-areas";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  lng: z.coerce.number(),
  lat: z.coerce.number(),
  live: z.coerce.boolean().optional(),
});

/**
 * Proposed / pending planning at a point.
 * Production path: resolveProposedPlanningForPoint (persisted PCA/KeySite + adapter enrichers).
 * Fixtures only when DB has no rows (fallback). Never CURRENT LEP law.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return jsonError("lng and lat required");
  const { lng, lat } = parsed.data;

  const { areas, source } = await loadProposedPlanningAreas();
  const proposed = resolveProposedPlanningAtPoint({ lng, lat, areas });
  const findFields = await resolveProposedPlanningForPoint({ lng, lat, areas });
  const keySites = await resolveKeySitesWithParcels({ lng, lat, areas });

  const structuredStatus = (proposed.planningChangeAreas[0]?.proposedControls as { structuredDataStatus?: string } | undefined)
    ?.structuredDataStatus;

  return NextResponse.json({
    safety: "PROPOSED / PENDING only — not current development rights. PlanningSnapshot remains CURRENT.",
    dataSource: source,
    structuredDataStatus: structuredStatus ?? null,
    legalDisclaimer: proposed.legalDisclaimer,
    planningChangeAreas: proposed.planningChangeAreas,
    keySites,
    applies: proposed.applies,
    findFields,
    /** Provenance from generic resolver (adapter enrichers included). */
    resolution: {
      sourceId: findFields.sourceId,
      sourceUrl: findFields.sourceUrl,
      areasSource: findFields.areasSource,
    },
  });
}
