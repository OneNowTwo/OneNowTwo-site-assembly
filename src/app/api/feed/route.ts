import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { listFeed, type FeedSort } from "@/lib/monitoring/feed";
import type { FeedKind } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const url = new URL(req.url);
  const sort = (url.searchParams.get("sort") as FeedSort | null) ?? "importance";
  const kind = url.searchParams.get("kind") as FeedKind | null;
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 40)));
  const items = await listFeed({ sort, kind: kind ?? undefined, limit });
  return NextResponse.json({ items });
}
