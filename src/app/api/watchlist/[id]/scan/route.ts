import { NextResponse } from "next/server";
import { requireSession, jsonError } from "@/lib/session";
import { prisma } from "@/lib/db";
import { runScanJob } from "@/lib/monitoring/scan-schedule";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

/** Manual re-scan for a saved area. */
export async function POST(_req: Request, { params }: Ctx) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const { id } = await params;
  const watch = await prisma.watchItem.findFirst({ where: { id, userId: session.userId, active: true } });
  if (!watch) return jsonError("Watch item not found", 404);
  if (!["SUBURB", "MAP_AREA", "PRECINCT"].includes(watch.kind)) {
    return jsonError("Only suburb / map area / precinct watches can be re-scanned");
  }
  await prisma.watchItem.update({ where: { id }, data: { scanStatus: "QUEUED" } });
  const job = await prisma.areaScanJob.create({
    data: { watchItemId: id, status: "QUEUED", cadence: "MANUAL" },
  });
  try {
    const result = await runScanJob(job.id, session.userId);
    return NextResponse.json({ jobId: job.id, ...result });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Scan failed", 503);
  }
}
