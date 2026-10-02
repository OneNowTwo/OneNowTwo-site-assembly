import { NextResponse } from "next/server";
import { buildOpportunityRadar, SYDNEY_RADAR_BBOX } from "@/lib/analysis/radar";
import { jsonError } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(10, Math.max(3, Number(url.searchParams.get("limit") ?? 5) || 5));
  try {
    const result = await buildOpportunityRadar({ bbox: SYDNEY_RADAR_BBOX, limit });
    return NextResponse.json(result);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Radar failed", 503);
  }
}
