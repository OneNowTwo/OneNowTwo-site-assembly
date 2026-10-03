import { NextResponse } from "next/server";
import { z } from "zod";
import { scanArea } from "@/lib/scan-service";
import { jsonError } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const bodySchema = z.object({
  west: z.number().min(140).max(154.5).optional(),
  south: z.number().min(-38).max(-28).optional(),
  east: z.number().min(140).max(154.5).optional(),
  north: z.number().min(-38).max(-28).optional(),
  centreQuery: z.string().min(2).max(120).optional(),
  suburbHint: z.string().min(2).max(80).optional(),
  maxResults: z.number().int().min(3).max(30).optional(),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid scan request");
  const { west, south, east, north, centreQuery, suburbHint, maxResults } = parsed.data;
  const hasBBox = west != null && south != null && east != null && north != null;
  if (!hasBBox && !centreQuery && !suburbHint) return jsonError("Provide a map bbox or centre/suburb query");

  try {
    const result = await scanArea({
      bbox: hasBBox ? { west: west!, south: south!, east: east!, north: north! } : undefined,
      centreQuery,
      suburbHint,
      maxResults,
    });
    return NextResponse.json(result);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Area scan failed", 503);
  }
}
