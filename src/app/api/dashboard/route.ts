import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { ensureDefaultWatchlist } from "@/lib/monitoring/watchlist";
import { getWorkspaceDashboard } from "@/lib/monitoring/dashboard";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  await ensureDefaultWatchlist(session.userId);
  return NextResponse.json(await getWorkspaceDashboard(session.userId));
}
