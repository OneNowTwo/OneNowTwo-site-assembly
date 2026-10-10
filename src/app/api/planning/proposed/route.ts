import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "@/lib/session";
import {
  proposedFindFieldsAtPoint,
  queryInnerWestProposedAtPoint,
  resolveKeySitesWithParcels,
  resolveProposedPlanningAtPoint,
} from "@/lib/source-watcher";
import { loadProposedPlanningAreas } from "@/lib/source-watcher/load-persisted-areas";
import { pointInBBox } from "@/lib/source-watcher/geometry";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  lng: z.coerce.number(),
  lat: z.coerce.number(),
  live: z.coerce.boolean().optional(),
});

/**
 * Proposed / pending planning at a point.
 * Production path: persisted PlanningChangeArea / KeySite from Source Watcher.
 * Fixtures only when DB has no rows (fallback). Never CURRENT LEP law.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return jsonError("lng and lat required");
  const { lng, lat, live } = parsed.data;

  const { areas, source } = await loadProposedPlanningAreas();
  const proposed = resolveProposedPlanningAtPoint({ lng, lat, areas });
  const findFields = proposedFindFieldsAtPoint({ lng, lat, areas });
  const keySites = await resolveKeySitesWithParcels({ lng, lat, areas });

  let liveInnerWest: Awaited<ReturnType<typeof queryInnerWestProposedAtPoint>> | null = null;
  const inIw = pointInBBox(lng, lat, { west: 151.12, south: -33.925, east: 151.2, north: -33.87 });
  if (live !== false && inIw) {
    try {
      liveInnerWest = await queryInnerWestProposedAtPoint(lng, lat);
    } catch {
      liveInnerWest = null;
    }
  }

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
    liveInnerWest,
  });
}
