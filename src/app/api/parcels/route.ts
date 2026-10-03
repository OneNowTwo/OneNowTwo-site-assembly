import { NextResponse } from "next/server";
import { getParcelsForBBox } from "@/lib/parcel-service";
import { jsonError } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("bbox") ?? "";
  const parts = raw.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return jsonError("bbox must be west,south,east,north");
  const [west, south, east, north] = parts;
  if (west < 140 || east > 154.5 || south < -38 || north > -28) return jsonError("bbox is outside NSW");
  try {
    return NextResponse.json(await getParcelsForBBox({ west, south, east, north }));
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Parcel request failed", 503);
  }
}
