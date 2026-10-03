import { NextResponse } from "next/server";
import { loadOpportunity } from "@/lib/opportunity-service";
import { getAssemblyPlanningContext } from "@/lib/planning/planning-rules-service";
import { fetchNominatedCentres } from "@/lib/data-sources/housing-sepp-lmr";
import { jsonError } from "@/lib/session";
import type { ParcelData } from "@/lib/types";
import type { FsrControl, FsrMappedStatus } from "@/lib/types";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const opp = await loadOpportunity(id);
  if (!opp) return jsonError("Opportunity not found", 404);

  const parcels: ParcelData[] = opp.parcels.map((op) => {
    const p = op.parcel;
    const snap = p.snapshots[0]?.data as { fsrStatus?: FsrMappedStatus; fsrControls?: FsrControl[] } | undefined;
    return {
      externalParcelId: p.externalParcelId,
      source: p.source,
      lot: p.lot,
      section: p.section,
      dp: p.dp,
      lotIdString: p.lotIdString,
      address: p.address,
      suburb: p.suburb,
      geometry: p.geometry as unknown as ParcelData["geometry"],
      centroid: [p.centroidLng, p.centroidLat],
      areaSqm: p.areaSqm,
      isStrata: p.isStrata,
      planning: p.zone
        ? {
            zone: p.zone,
            zoneName: p.zoneName,
            fsr: p.fsr,
            fsrStatus: snap?.fsrStatus ?? (p.fsr != null ? "MAPPED" : "NO_MAPPED"),
            fsrControls: snap?.fsrControls ?? [],
            heightM: p.heightM,
            minLotSizeSqm: p.minLotSizeSqm,
            heritage: p.heritage,
            planningInstrument: p.planningInstrument,
            lga: p.lga,
            sources: {},
          }
        : null,
      planningStatus: p.zone ? "ok" : "unavailable",
      retrievedAt: (p.planningCheckedAt ?? p.updatedAt).toISOString(),
    };
  });

  const lngs = parcels.map((p) => p.centroid[0]);
  const lats = parcels.map((p) => p.centroid[1]);
  const pad = 0.02;
  const centres = await fetchNominatedCentres({
    west: Math.min(...lngs) - pad,
    south: Math.min(...lats) - pad,
    east: Math.max(...lngs) + pad,
    north: Math.max(...lats) + pad,
  }).catch(() => []);

  const context = await getAssemblyPlanningContext({ parcels, centres });
  return NextResponse.json(context);
}
