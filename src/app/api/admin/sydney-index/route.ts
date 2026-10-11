import { NextResponse } from "next/server";
import { getSession, jsonError } from "@/lib/session";
import { getSydneyIndexMetrics } from "@/lib/intelligence/sydney-index-pipeline";
import { coverageSummary } from "@/lib/intelligence/sydney-coverage";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Admin: Sydney index progress + coverage matrix. */
export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Unauthorized", 401);

  const metrics = await getSydneyIndexMetrics();
  const batches = metrics.run
    ? await prisma.sydneyIndexBatch.findMany({
        where: { runId: metrics.run.id },
        select: {
          id: true,
          lga: true,
          region: true,
          tileKey: true,
          status: true,
          parcelsLoaded: true,
          candidatesGenerated: true,
          error: true,
        },
        orderBy: [{ lga: "asc" }, { tileKey: "asc" }],
        take: 500,
      })
    : [];

  return NextResponse.json({
    metrics,
    batches,
    coverage: coverageSummary(),
  });
}
