import { NextResponse } from "next/server";
import { runDailyMonitoring } from "@/lib/monitoring/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Daily monitoring cron — sales, planning, limited scheduled scans, morning report.
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
  const runScans = new URL(req.url).searchParams.get("scans") !== "0";
  const result = await runDailyMonitoring({ runScans });
  return NextResponse.json(result, { status: result.ok ? 200 : 503 });
}

export async function GET(req: Request) {
  return POST(req);
}
