import { NextResponse } from "next/server";
import { loadOpportunity, toOpportunityLots } from "@/lib/opportunity-service";
import { resolvePendingPlanningChanges } from "@/lib/planning/planning-rules-service";
import { resolvePlanning } from "@/lib/planning/resolve-planning";
import { parseOpportunityInputs } from "@/lib/analysis/assumptions";
import { jsonError } from "@/lib/session";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/**
 * Returns the SAME PlanningSnapshot the opportunity UI already uses (resolvePlanning),
 * plus pending changes attached. Does NOT independently re-infer State pathways —
 * that duplicate source caused Planning tab B to disagree with Yield.
 */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const opp = await loadOpportunity(id);
  if (!opp) return jsonError("Opportunity not found", 404);

  const inputs = parseOpportunityInputs(opp.inputs);
  const lots = toOpportunityLots(opp);
  const centroids = opp.parcels.filter((p) => p.included).map((p) => [p.parcel.centroidLng, p.parcel.centroidLat] as const);
  const avgLng = centroids.length
    ? centroids.reduce((s, c) => s + c[0], 0) / centroids.length
    : (opp.parcels[0]?.parcel.centroidLng ?? 0);
  const avgLat = centroids.length
    ? centroids.reduce((s, c) => s + c[1], 0) / centroids.length
    : (opp.parcels[0]?.parcel.centroidLat ?? 0);

  const pendingCheckedAt = new Date().toISOString();
  const pendingSource = "NSW Planning Proposal layers + curated watchlist";
  const pendingChanges = await resolvePendingPlanningChanges({
    lng: avgLng,
    lat: avgLat,
    lga: opp.lga,
    suburb: opp.suburb,
  }).catch(() => []);

  const planningSnapshot = resolvePlanning({
    lots: lots.map((l) => ({
      id: l.id,
      label: l.label,
      included: l.included,
      areaSqm: l.areaSqm,
      zone: l.zone,
      zoneName: l.zoneName,
      fsr: l.fsr,
      heightM: l.heightM,
      minLotSizeSqm: l.minLotSizeSqm,
      heritage: l.heritage,
      planningInstrument: l.planningInstrument ?? null,
      planningCheckedAt: l.planningCheckedAt ?? null,
    })),
    inputs,
    pendingChanges,
    pendingChangesCheckedAt: pendingCheckedAt,
    pendingChangesSource: pendingSource,
  });

  return NextResponse.json({
    safetyNote:
      "CURRENT LAW vs CURRENT PATHWAYS vs PROPOSED/PENDING are separate. Proposed controls never contaminate current feasibility.",
    planningSnapshot,
    pendingChanges,
    pendingChangesCheckedAt: pendingCheckedAt,
    pendingChangesSource: pendingSource,
    // De-authorised: pathwaySummary is no longer independently resolved.
    pathwaySummary: [],
  });
}
