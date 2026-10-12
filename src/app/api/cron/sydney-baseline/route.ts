import { NextResponse } from "next/server";
import { runSydneyBaseline } from "@/lib/intelligence/sydney-baseline";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Sydney baseline cron — START / CONTINUE / COMPLETE.
 * Processes a bounded number of index batches per call.
 * Archive apply is NEVER automatic (dry-run only).
 *
 * Continues the active RUNNING/QUEUED SydneyIndexRun for sydney-metro
 * (e.g. cmv4g2pef0000hyjsxbdgveot). Candidates upsert by canonicalKey so
 * re-processing a tile does not duplicate ACTIVE INDEX_DISCOVERY rows.
 * Do not call invalidatePriorRunsAndStartFresh from production cron.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  const url = new URL(req.url);
  const batches = Number(url.searchParams.get("batches") ?? "5");
  const skipWatcher = url.searchParams.get("skipWatcher") === "1";
  const result = await runSydneyBaseline({
    skipWatcher,
    dryRunArchive: true,
    batchesPerInvoke: Number.isFinite(batches) ? Math.min(Math.max(batches, 1), 15) : 5,
  });
  return NextResponse.json(result);
}

export async function GET(req: Request) {
  return POST(req);
}
