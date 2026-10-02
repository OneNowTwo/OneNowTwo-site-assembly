import { NextResponse } from "next/server";
import { z } from "zod";
import { getParcelsForBBox } from "@/lib/parcel-service";
import { buildAdjacency } from "@/lib/analysis/geometry";
import { computeAssemblyMetrics, generateAssemblies, scoreAssembly } from "@/lib/analysis/assembly";
import { getGlobalAssumptions } from "@/lib/opportunity-service";
import { parcelToAnalysisLot } from "@/lib/parcel-analysis";
import { jsonError } from "@/lib/session";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  startId: z.string().min(1),
  lng: z.number().min(140).max(154.5),
  lat: z.number().min(-38).max(-28),
  /** Optional manual selection to evaluate instead of generating. */
  selectedIds: z.array(z.string()).max(12).optional(),
});

/** Search radius around the start lot (degrees ≈ 220 m) — enough for 6-lot assemblies, bounded for speed. */
const RADIUS_DEG = 0.002;

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid request");
  const { startId, lng, lat, selectedIds } = parsed.data;

  const result = await getParcelsForBBox({ west: lng - RADIUS_DEG, east: lng + RADIUS_DEG, south: lat - RADIUS_DEG * 0.85, north: lat + RADIUS_DEG * 0.85 });
  if (!result.parcels.length) return jsonError(result.messages[0] ?? "No parcels available", 503, { messages: result.messages });
  const lots = result.parcels.map(parcelToAnalysisLot);
  if (!lots.some((l) => l.id === startId)) return jsonError("Start parcel not found in the NSW cadastre response", 404);

  const a = await getGlobalAssumptions();
  const adj = buildAdjacency(result.parcels.map((p) => ({ id: p.externalParcelId, geometry: p.geometry })));
  const neighbours = [...(adj.get(startId) ?? [])];

  let manual = null;
  if (selectedIds?.length) {
    const group = lots.filter((l) => selectedIds.includes(l.id));
    const metrics = computeAssemblyMetrics(group, a, adj);
    manual = { key: "manual", lotIds: group.map((l) => l.id), metrics, score: scoreAssembly(metrics, a) };
  }
  const candidates = generateAssemblies(lots, adj, startId, a, { maxSize: a.maxAssemblySize, maxResults: 8 });
  const usedIds = new Set([startId, ...neighbours, ...candidates.flatMap((c) => c.lotIds), ...(manual?.lotIds ?? [])]);

  return NextResponse.json({
    startId,
    neighbours,
    candidates,
    manual,
    parcels: result.parcels.filter((p) => usedIds.has(p.externalParcelId)),
    cadastreStatus: result.cadastreStatus,
    planningStatus: result.planningStatus,
    messages: result.messages,
  });
}
