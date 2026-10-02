import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { refreshPlanningForParcels } from "@/lib/parcel-service";
import { getGlobalAssumptions, loadOpportunity, recomputeOpportunity, serializeOpportunity } from "@/lib/opportunity-service";
import { jsonError } from "@/lib/session";
import type { Prisma } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** Re-check live NSW planning controls for every lot; keeps the saved snapshot if the service is down. */
export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const opp = await loadOpportunity(id);
  if (!opp) return jsonError("Opportunity not found", 404);
  const rows = opp.parcels.map((p) => p.parcel);
  try {
    const controls = await refreshPlanningForParcels(rows);
    const now = new Date();
    for (const row of rows) {
      const c = controls.get(row.externalParcelId);
      if (!c) continue;
      await prisma.parcel.update({
        where: { id: row.id },
        data: { zone: c.zone, zoneName: c.zoneName, fsr: c.fsr, heightM: c.heightM, minLotSizeSqm: c.minLotSizeSqm, heritage: c.heritage, planningInstrument: c.planningInstrument, lga: c.lga, planningCheckedAt: now },
      });
      await prisma.planningSnapshot.create({ data: { parcelId: row.id, source: "LIVE_NSW", data: c as unknown as Prisma.InputJsonValue, retrievedAt: now } });
    }
  } catch (err) {
    return NextResponse.json(
      { error: "Planning service temporarily unavailable.", detail: err instanceof Error ? err.message : String(err), usingSnapshot: true },
      { status: 503 },
    );
  }
  await recomputeOpportunity(id);
  return NextResponse.json(serializeOpportunity((await loadOpportunity(id))!, await getGlobalAssumptions()));
}
