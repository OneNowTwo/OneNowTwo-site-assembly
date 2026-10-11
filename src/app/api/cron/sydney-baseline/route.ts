import { NextResponse } from "next/server";
import { runSydneyBaseline } from "@/lib/intelligence/sydney-baseline";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Sydney baseline + SiteCandidateIndex refresh.
 * Auth: CRON_SECRET bearer (same pattern as other crons).
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  const result = await runSydneyBaseline({ skipWatcher: false });
  return NextResponse.json(result);
}

export async function GET(req: Request) {
  return POST(req);
}
