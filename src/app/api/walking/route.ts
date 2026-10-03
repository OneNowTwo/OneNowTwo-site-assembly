import { NextResponse } from "next/server";
import { z } from "zod";
import { nearestPointOnRing, walkingDistanceProvider } from "@/lib/data-sources/walking-distance";
import { fetchNominatedCentres } from "@/lib/data-sources/housing-sepp-lmr";
import { jsonError } from "@/lib/session";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  fromLng: z.number(),
  fromLat: z.number(),
  toLng: z.number().optional(),
  toLat: z.number().optional(),
  /** Resolve destination as nearest point on a nominated centre boundary. */
  centreId: z.string().optional(),
  centreLabel: z.string().optional(),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid walking request");
  const { fromLng, fromLat, toLng, toLat, centreId, centreLabel } = parsed.data;
  const from = { type: "Point" as const, coordinates: [fromLng, fromLat] as [number, number] };

  let to = toLng != null && toLat != null ? { type: "Point" as const, coordinates: [toLng, toLat] as [number, number] } : null;
  let centreName: string | null = null;

  if (!to && (centreId || centreLabel)) {
    const centres = await fetchNominatedCentres({
      west: fromLng - 0.05,
      south: fromLat - 0.05,
      east: fromLng + 0.05,
      north: fromLat + 0.05,
    });
    const centre =
      centres.find((c) => c.id === centreId) ??
      centres.find((c) => centreLabel && c.label.toLowerCase().includes(centreLabel.toLowerCase())) ??
      null;
    if (!centre) return jsonError("Nominated centre not found near origin", 404);
    centreName = centre.label;
    if (centre.boundaryRing?.length) {
      const nearest = nearestPointOnRing(from, centre.boundaryRing);
      to = { type: "Point", coordinates: [nearest.coordinates[0]!, nearest.coordinates[1]!] };
    } else {
      to = { type: "Point", coordinates: [centre.lng, centre.lat] };
    }
  }

  if (!to) return jsonError("Provide toLng/toLat or centreId/centreLabel");

  const route = await walkingDistanceProvider.route(from, to);
  const pass800 = route.status === "OK" && route.walkingDistanceM != null && route.walkingDistanceM <= 800;
  return NextResponse.json({
    ...route,
    centreName,
    lmr800WalkingTest: route.status === "OK" ? (pass800 ? "PASS" : "FAIL") : "WALKING DISTANCE NOT CONFIRMED",
  });
}
