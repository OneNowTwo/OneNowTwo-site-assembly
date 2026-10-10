import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/session";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  lng: z.coerce.number(),
  lat: z.coerce.number(),
});

/**
 * Recent IntelChangeEvents for a site point.
 * Spatial filter is best-effort on stored geometry/bbox JSON — geography-neutral.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return jsonError("lng and lat required");
  const { lng, lat } = parsed.data;

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 60);

  const rows = await prisma.intelChangeEvent.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 80,
  });

  const events = rows
    .filter((e) => {
      const g = e.geometry as { type?: string; coordinates?: unknown; bbox?: number[] } | null;
      if (!g) return e.importance >= 0.7;
      if (Array.isArray(g.bbox) && g.bbox.length >= 4) {
        const [w, s, east, n] = g.bbox;
        return lng >= w! && lng <= east! && lat >= s! && lat <= n!;
      }
      if (g.type === "Point" && Array.isArray(g.coordinates)) {
        const [x, y] = g.coordinates as number[];
        return Math.abs(x - lng) < 0.01 && Math.abs(y - lat) < 0.01;
      }
      return e.importance >= 0.75;
    })
    .slice(0, 12)
    .map((e) => ({
      id: e.id,
      kind: e.kind,
      title: e.title,
      summary: e.summary,
      createdAt: e.createdAt.toISOString(),
      href: e.href,
    }));

  return NextResponse.json({ events });
}
