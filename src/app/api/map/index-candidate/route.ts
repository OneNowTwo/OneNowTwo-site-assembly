import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { bboxFromGeometry } from "@/lib/map/map-target";
import { getStoredParcelsByExternalIds } from "@/lib/parcel-service";

export const dynamic = "force-dynamic";

/**
 * Lightweight SiteCandidateIndex resolve for Today → Map (INDEX_CANDIDATE).
 * DB-only: no NSW cadastre bbox scan, no planning, no LMR centres.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? url.searchParams.get("candidateId");
  const canonicalKey = url.searchParams.get("canonicalKey") ?? url.searchParams.get("key");

  if (!id && !canonicalKey) {
    return NextResponse.json({ error: "id or canonicalKey required" }, { status: 400 });
  }

  const row = await prisma.siteCandidateIndex.findFirst({
    where: {
      lifecycleStatus: "ACTIVE",
      ...(id ? { id } : { canonicalKey: canonicalKey! }),
    },
  });

  if (!row) {
    return NextResponse.json({ error: "Indexed candidate not found" }, { status: 404 });
  }

  const parcelIds = Array.isArray(row.parcelIds)
    ? (row.parcelIds as unknown[]).map(String).filter(Boolean)
    : [];
  const bbox =
    bboxFromGeometry(row.bbox) ??
    bboxFromGeometry(row.geometry) ??
    (row.centroidLat != null && row.centroidLng != null
      ? {
          west: row.centroidLng - 0.0015,
          south: row.centroidLat - 0.0015,
          east: row.centroidLng + 0.0015,
          north: row.centroidLat + 0.0015,
        }
      : null);

  const parcels = parcelIds.length ? await getStoredParcelsByExternalIds(parcelIds) : [];

  return NextResponse.json({
    kind: "INDEX_CANDIDATE",
    id: row.id,
    canonicalKey: row.canonicalKey,
    title: row.address ?? row.suburb ?? row.canonicalKey,
    address: row.address,
    suburb: row.suburb,
    lga: row.lga,
    parcelIds,
    bbox,
    geometry: row.geometry,
    centroid:
      row.centroidLat != null && row.centroidLng != null
        ? { lat: row.centroidLat, lng: row.centroidLng }
        : bbox
          ? { lat: (bbox.south + bbox.north) / 2, lng: (bbox.west + bbox.east) / 2 }
          : null,
    opportunityId: row.opportunityId,
    parcels,
    source: "site_candidate_index",
  });
}
