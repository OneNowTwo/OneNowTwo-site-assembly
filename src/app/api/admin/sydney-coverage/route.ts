import { NextResponse } from "next/server";
import { getSession, jsonError } from "@/lib/session";
import { coverageSummary } from "@/lib/intelligence/sydney-coverage";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Internal Sydney coverage matrix — not for normal developer UI. */
export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Unauthorized", 401);

  const [candidateCount, activeStories, materialEvents] = await Promise.all([
    prisma.siteCandidateIndex.count({ where: { lifecycleStatus: "ACTIVE" } }),
    prisma.intelligenceStory.count({ where: { lifecycleStatus: "ACTIVE", material: true } }),
    prisma.intelChangeEvent.count({ where: { lifecycleStatus: "ACTIVE", material: true } }),
  ]);

  return NextResponse.json({
    ...coverageSummary(),
    index: { candidateCount, activeStories, materialEvents },
  });
}
