import { NextResponse } from "next/server";
import { runPersistedSourceWatcher } from "@/lib/source-watcher/persist";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Source Watcher cron — FETCH → snapshot → diff → IntelChangeEvent → TODAY feed.
 * Proposed planning never applied to current-law feasibility.
 * Auth: Bearer CRON_SECRET when set.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  try {
    const result = await runPersistedSourceWatcher();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  return POST(req);
}
