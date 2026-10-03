import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { generateMorningReport, getLatestMorningReport, listMorningReports } from "@/lib/monitoring/morning-report";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const url = new URL(req.url);
  if (url.searchParams.get("all") === "1") {
    return NextResponse.json({ reports: await listMorningReports(session.userId) });
  }
  let report = await getLatestMorningReport(session.userId);
  if (!report || url.searchParams.get("refresh") === "1") {
    report = await generateMorningReport(session.userId);
  }
  return NextResponse.json({ report });
}

export async function POST() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const report = await generateMorningReport(session.userId);
  return NextResponse.json({ report }, { status: 201 });
}
