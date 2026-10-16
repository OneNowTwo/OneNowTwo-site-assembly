import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, jsonError } from "@/lib/session";
import { ensureDefaultWatchlist, listWatchItems } from "@/lib/monitoring/watchlist";
import type { WatchedSiteMarker } from "@/lib/map/watched-site-marker";

export const dynamic = "force-dynamic";

export type { WatchedSiteMarker };

/**
 * Plottable watched-site markers for the Map layer.
 * Only returns items with a usable centroid (opportunity parcels, parcel lookup, or bbox centre).
 */
export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  await ensureDefaultWatchlist(session.userId);
  try {
    const items = await listWatchItems(session.userId);
    const markers: WatchedSiteMarker[] = [];

    for (const item of items) {
      if (item.kind === "OPPORTUNITY" && item.opportunityId) {
        const parcels = await prisma.opportunityParcel.findMany({
          where: { opportunityId: item.opportunityId, included: true },
          include: { parcel: { select: { centroidLat: true, centroidLng: true } } },
        });
        if (!parcels.length) continue;
        const lat = parcels.reduce((s, p) => s + p.parcel.centroidLat, 0) / parcels.length;
        const lng = parcels.reduce((s, p) => s + p.parcel.centroidLng, 0) / parcels.length;
        markers.push({
          id: item.id,
          label: item.label,
          kind: item.kind,
          lat,
          lng,
          status: item.opportunity?.status ?? null,
          href: `/opportunities/${item.opportunityId}`,
        });
        continue;
      }

      if (item.kind === "PARCEL" && item.externalParcelId) {
        const parcel = await prisma.parcel.findUnique({
          where: { externalParcelId: item.externalParcelId },
          select: { centroidLat: true, centroidLng: true, address: true },
        });
        if (!parcel) continue;
        markers.push({
          id: item.id,
          label: item.label || parcel.address || item.externalParcelId,
          kind: item.kind,
          lat: parcel.centroidLat,
          lng: parcel.centroidLng,
          status: null,
          href: null,
        });
        continue;
      }

      const bbox = item.bbox as { west?: number; south?: number; east?: number; north?: number } | null;
      if (bbox && [bbox.west, bbox.south, bbox.east, bbox.north].every((n) => typeof n === "number" && Number.isFinite(n))) {
        markers.push({
          id: item.id,
          label: item.label,
          kind: item.kind,
          lat: (bbox.south! + bbox.north!) / 2,
          lng: (bbox.west! + bbox.east!) / 2,
          status: null,
          href: "/watching",
        });
      }
    }

    return NextResponse.json({ markers });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Could not load watched sites", 503);
  }
}
