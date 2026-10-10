import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { ensureDefaultWatchlist } from "@/lib/monitoring/watchlist";
import { getTodayIntelligence } from "@/lib/monitoring/today-intelligence";
import { profileForStrategy, type DevelopmentStrategy } from "@/lib/source-watcher/strategy-profile";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  await ensureDefaultWatchlist(session.userId);
  const url = new URL(req.url);
  const strategyParam = (url.searchParams.get("strategy") ?? "GENERAL_RESIDENTIAL") as DevelopmentStrategy;
  const allowed: DevelopmentStrategy[] = ["APARTMENTS", "CO_LIVING", "TOWNHOUSES", "GENERAL_RESIDENTIAL"];
  const strategy = allowed.includes(strategyParam) ? strategyParam : "GENERAL_RESIDENTIAL";
  return NextResponse.json(await getTodayIntelligence(session.userId, profileForStrategy(strategy)));
}
