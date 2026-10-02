import { NextResponse } from "next/server";
import { geocode } from "@/lib/data-sources/geocoder";
import { jsonError } from "@/lib/session";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return jsonError("Enter at least 2 characters");
  return NextResponse.json(await geocode(q.slice(0, 200)));
}
