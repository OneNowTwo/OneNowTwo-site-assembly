/**
 * Read-time ACTIVE Opportunity detailed scores for Today / Find display.
 * Uses persisted Opportunity.score only — never recomputes analysis.
 *
 * Rule:
 * - If row.opportunityId is set → that Opportunity's score/id wins (no canonical swap).
 * - Else → match by canonicalKey (parcel-derived or stored).
 */

import { prisma } from "@/lib/db";
import { canonicalParcelKey } from "@/lib/intelligence/canonical-key";

export type LinkedOpportunityScore = {
  opportunityId: string;
  score: number;
};

export type LinkedOpportunityScoreIndex = {
  byId: Map<string, LinkedOpportunityScore>;
  byCanonicalKey: Map<string, LinkedOpportunityScore>;
};

const PAGE = 500;

/**
 * Resolve the linked detailed score for an index row.
 * Exact opportunityId always wins over canonical-key fallback.
 */
export function resolveLinkedOpportunityScore(
  opportunityId: string | null | undefined,
  canonicalKey: string,
  index: LinkedOpportunityScoreIndex,
): LinkedOpportunityScore | null {
  if (opportunityId) {
    // Do not fall back to a different Opportunity when an explicit id is present.
    return index.byId.get(opportunityId) ?? null;
  }
  return index.byCanonicalKey.get(canonicalKey) ?? null;
}

/** @deprecated use loadLinkedOpportunityScoreIndex — kept name for call-site clarity. */
export async function loadLinkedOpportunityScoresByCanonicalKey(): Promise<
  Map<string, LinkedOpportunityScore>
> {
  const index = await loadLinkedOpportunityScoreIndex();
  return index.byCanonicalKey;
}

/**
 * Load every ACTIVE Opportunity with a non-null persisted score.
 * Pages by immutable id — no status whitelist, no hard take cap.
 */
export async function loadLinkedOpportunityScoreIndex(): Promise<LinkedOpportunityScoreIndex> {
  const byId = new Map<string, LinkedOpportunityScore>();
  const byCanonicalKey = new Map<string, LinkedOpportunityScore>();

  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.opportunity.findMany({
      where: {
        lifecycleStatus: "ACTIVE",
        score: { not: null },
      },
      orderBy: { id: "asc" },
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
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

    for (const o of batch) {
      if (o.score == null) continue;
      const entry: LinkedOpportunityScore = { opportunityId: o.id, score: o.score };
      byId.set(o.id, entry);

      const fromParcels = canonicalParcelKey(
        o.parcels.map((p) => p.parcel.externalParcelId),
      );
      const key = o.canonicalKey || fromParcels;
      if (!key) continue;
      const existing = byCanonicalKey.get(key);
      // Deterministic when multiple ACTIVE opps share a key and no opportunityId on the row:
      // prefer higher score, then lower id.
      if (
        !existing ||
        o.score > existing.score ||
        (o.score === existing.score && o.id < existing.opportunityId)
      ) {
        byCanonicalKey.set(key, entry);
      }
    }

    if (batch.length < PAGE) break;
    cursor = batch[batch.length - 1]!.id;
  }

  return { byId, byCanonicalKey };
}
