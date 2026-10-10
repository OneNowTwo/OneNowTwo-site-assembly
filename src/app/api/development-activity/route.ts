import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "@/lib/session";
import { developmentActivityProvider, loadDevelopmentActivityBundle } from "@/lib/data-sources/development-activity";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const querySchema = z.object({
  lng: z.coerce.number().optional(),
  lat: z.coerce.number().optional(),
  radiusM: z.coerce.number().min(50).max(5000).optional(),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return jsonError("Invalid query");
  const { lng, lat, radiusM } = parsed.data;

  if (lng != null && lat != null && developmentActivityProvider.getNearby) {
    const activities = await developmentActivityProvider.getNearby({ lng, lat }, radiusM ?? 500);
    return NextResponse.json({ activities, radiusM: radiusM ?? 500 });
  }

  const bundle = await loadDevelopmentActivityBundle();
  return NextResponse.json({
    activities: bundle.activities.slice(0, 50),
    messages: bundle.messages,
  });
}
