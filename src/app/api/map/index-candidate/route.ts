import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  capParcelIds,
  formatIndexCandidateSummary,
  siteGeometryFromParcels,
} from "@/lib/index-candidate-geometry";
import { bboxFromGeometry } from "@/lib/map/map-target";
import { getStoredParcelsByExternalIds } from "@/lib/parcel-service";

export const dynamic = "force-dynamic";

/**
 * Strictly DB-only SiteCandidateIndex resolve for Today → Map (INDEX_CANDIDATE).
 *
 * Reads SiteCandidateIndex + stored Parcel rows only.
 * Never calls NSW cadastre/planning, never hydrates, never writes.
 * Missing geometry → geometryStatus: "MISSING" (repair via out-of-band backfill).
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

  const rawParcelIds = Array.isArray(row.parcelIds)
    ? (row.parcelIds as unknown[]).map(String).filter(Boolean)
    : [];
  const parcelIds = capParcelIds(rawParcelIds);

  // Index rows often store the Sydney batch TILE bbox (multi-km), not the site.
  const storedTileBbox = bboxFromGeometry(row.bbox);

  // DB-only: no NSW, no live hydrate, no writes.
  const parcels = (await getStoredParcelsByExternalIds(parcelIds)).filter((p) => !!p.geometry);

  const siteGeometry =
    siteGeometryFromParcels(parcels) ?? (row.geometry as typeof row.geometry) ?? null;

  const geometryStatus: "OK" | "MISSING" =
    parcels.length > 0 || !!siteGeometry ? "OK" : "MISSING";

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
  if (!siteBbox) siteBbox = bboxFromGeometry(siteGeometry) ?? null;
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

  const summary = formatIndexCandidateSummary({
    address: row.address,
    suburb: row.suburb,
    lotCount: row.lotCount ?? parcelIds.length ?? null,
    siteAreaSqm: row.siteAreaSqm,
    currentFsr: row.currentFsr,
    proposedFsr: row.proposedFsr,
  });

  return NextResponse.json({
    kind: "INDEX_CANDIDATE",
    id: row.id,
    canonicalKey: row.canonicalKey,
    title: row.address ?? row.suburb ?? row.canonicalKey,
    address: row.address,
    suburb: row.suburb,
    lga: row.lga,
    zone: row.zone,
    lotCount: row.lotCount ?? parcelIds.length,
    siteAreaSqm: row.siteAreaSqm,
    currentFsr: row.currentFsr,
    proposedFsr: row.proposedFsr,
    proposedHeightM: row.proposedHeightM,
    currentHeightM: row.currentHeightM,
    indexedAt: (row.lastEvaluatedAt ?? row.updatedAt)?.toISOString?.() ?? null,
    summary,
    parcelIds,
    /** Tight site bbox for map fly/fit — never the discovery tile. */
    bbox: siteBbox,
    tileBbox: storedTileBbox,
    geometry: siteGeometry,
    geometryStatus,
    centroid,
    opportunityId: row.opportunityId,
    parcels,
    hydratedFromCadastre: false,
    source: "site_candidate_index",
  });
}
