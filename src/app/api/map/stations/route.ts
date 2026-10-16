import { NextResponse } from "next/server";
import { fetchTrainStations } from "@/lib/data-sources/nsw-train-stations";
import { jsonError } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Official NSW train/metro/light-rail stations for the Map Stations / centres layer. */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("bbox") ?? "";
  const parts = raw.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return jsonError("bbox must be west,south,east,north");
  }
  const [west, south, east, north] = parts;
  try {
    const stations = await fetchTrainStations({ west, south, east, north });
    return NextResponse.json({ stations });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Could not load stations", 503);
  }
}
