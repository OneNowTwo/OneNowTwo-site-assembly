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

  // Index rows often store the Sydney batch TILE bbox (multi-km), not the site.
  // Prefer a tight site bbox from stored parcels / centroid — never fly the map to a tile.
  const storedTileBbox = bboxFromGeometry(row.bbox);
  const parcels = parcelIds.length ? await getStoredParcelsByExternalIds(parcelIds) : [];

  let siteBbox: { west: number; south: number; east: number; north: number } | null = null;
  if (parcels.length) {
    let west = Infinity,
      south = Infinity,
      east = -Infinity,
      north = -Infinity;
    for (const p of parcels) {
      const [lng, lat] = p.centroid;
      west = Math.min(west, lng);
      east = Math.max(east, lng);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
      const g = bboxFromGeometry(p.geometry);
      if (g) {
        west = Math.min(west, g.west);
        east = Math.max(east, g.east);
        south = Math.min(south, g.south);
        north = Math.max(north, g.north);
      }
    }
    if (Number.isFinite(west)) {
      const pad = 0.0004;
      siteBbox = { west: west - pad, south: south - pad, east: east + pad, north: north + pad };
    }
  }
  if (!siteBbox) siteBbox = bboxFromGeometry(row.geometry) ?? null;
  if (!siteBbox && row.centroidLat != null && row.centroidLng != null) {
    siteBbox = {
      west: row.centroidLng - 0.0012,
      south: row.centroidLat - 0.0012,
      east: row.centroidLng + 0.0012,
      north: row.centroidLat + 0.0012,
    };
  }

  const centroid =
    row.centroidLat != null && row.centroidLng != null
      ? { lat: row.centroidLat, lng: row.centroidLng }
      : siteBbox
        ? { lat: (siteBbox.south + siteBbox.north) / 2, lng: (siteBbox.west + siteBbox.east) / 2 }
        : null;

  return NextResponse.json({
    kind: "INDEX_CANDIDATE",
    id: row.id,
    canonicalKey: row.canonicalKey,
    title: row.address ?? row.suburb ?? row.canonicalKey,
    address: row.address,
    suburb: row.suburb,
    lga: row.lga,
    parcelIds,
    /** Tight site bbox for map fly/fit — never the discovery tile. */
    bbox: siteBbox,
    tileBbox: storedTileBbox,
    geometry: row.geometry,
    centroid,
    opportunityId: row.opportunityId,
    parcels,
    source: "site_candidate_index",
  });
}
