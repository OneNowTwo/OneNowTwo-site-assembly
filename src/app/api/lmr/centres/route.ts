import { NextResponse } from "next/server";
import { fetchNominatedCentres } from "@/lib/data-sources/housing-sepp-lmr";
import { jsonError } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("bbox") ?? "";
  const parts = raw.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return jsonError("bbox must be west,south,east,north");
  const [west, south, east, north] = parts;
  try {
    const centres = await fetchNominatedCentres({ west, south, east, north });
    return NextResponse.json({ centres });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Could not load town centres", 503);
  }
}
