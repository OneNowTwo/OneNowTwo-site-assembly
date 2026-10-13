/**
 * Read-time map of INDEX_DISCOVERY canonicalKey → ACTIVE Opportunity detailed score.
 * Uses persisted Opportunity.score only — never recomputes analysis.
 */

import { prisma } from "@/lib/db";
import { canonicalParcelKey } from "@/lib/intelligence/canonical-key";

export type LinkedOpportunityScore = {
  opportunityId: string;
  score: number;
};

export async function loadLinkedOpportunityScoresByCanonicalKey(): Promise<
  Map<string, LinkedOpportunityScore>
> {
  const opps = await prisma.opportunity.findMany({
    where: {
      lifecycleStatus: "ACTIVE",
      status: { in: ["ANALYSING", "FEASIBLE", "WATCHING", "ACQUIRING"] },
      score: { not: null },
    },
    take: 200,
    select: {
      id: true,
      score: true,
      canonicalKey: true,
      parcels: {
        where: { included: true },
        select: { parcel: { select: { externalParcelId: true } } },
      },
    },
  });

  const map = new Map<string, LinkedOpportunityScore>();
  for (const o of opps) {
    if (o.score == null) continue;
    const fromParcels = canonicalParcelKey(
      o.parcels.map((p) => p.parcel.externalParcelId),
    );
    const key = o.canonicalKey || fromParcels;
    if (!key) continue;
    const existing = map.get(key);
    // Prefer highest detailed score if multiple ACTIVE opps share a key (shouldn't, but deterministic).
    if (!existing || o.score > existing.score) {
      map.set(key, { opportunityId: o.id, score: o.score });
    }
  }
  return map;
}
