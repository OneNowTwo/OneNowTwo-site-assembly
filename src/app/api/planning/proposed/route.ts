import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "@/lib/session";
import {
  loadFixturePlanningAreas,
  proposedFindFieldsAtPoint,
  resolveProposedPlanningAtPoint,
  queryInnerWestProposedAtPoint,
} from "@/lib/source-watcher";
import { pointInBBox } from "@/lib/source-watcher/geometry";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  lng: z.coerce.number(),
  lat: z.coerce.number(),
  live: z.coerce.boolean().optional(),
});

/**
 * Proposed / pending planning at a point.
 * Never returns CURRENT LEP law — PlanningSnapshot remains authoritative for that.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return jsonError("lng and lat required");
  const { lng, lat, live } = parsed.data;

  const areas = loadFixturePlanningAreas();
  const proposed = resolveProposedPlanningAtPoint({ lng, lat, areas });
  const findFields = proposedFindFieldsAtPoint({ lng, lat, areas });

  let liveInnerWest: Awaited<ReturnType<typeof queryInnerWestProposedAtPoint>> | null = null;
  const inIw = pointInBBox(lng, lat, { west: 151.12, south: -33.925, east: 151.2, north: -33.87 });
  if (live !== false && inIw) {
    try {
      liveInnerWest = await queryInnerWestProposedAtPoint(lng, lat);
    } catch {
      liveInnerWest = null;
    }
  }

  return NextResponse.json({
    safety: "PROPOSED / PENDING only — not current development rights. PlanningSnapshot remains CURRENT.",
    ...proposed,
    findFields,
    liveInnerWest,
  });
}
