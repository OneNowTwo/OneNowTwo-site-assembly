/**
 * SiteCandidateIndex reads for Today / Find.
 * Discovery universe = INDEX_DISCOVERY from SydneyIndexBatch only.
 * Historical Opportunities must never seed the index.
 */

import { prisma } from "@/lib/db";
import type { StrategyProfile } from "@/lib/source-watcher/strategy-profile";
import { buildMapHref } from "@/lib/map/map-target";
import { humanizeSiteReason } from "@/lib/intelligence/site-reasons";

export { humanizeSiteReason } from "@/lib/intelligence/site-reasons";

export type SiteCandidateView = {
  id: string;
  canonicalKey: string;
  name: string;
  address: string;
  suburb: string | null;
  lga: string | null;
  siteAreaSqm: number | null;
  lotCount: number | null;
  owners: number | null;
  currentFsr: number | null;
  proposedFsr: number | null;
  stationDistanceM: number | null;
  score: number | null;
  maxPayable: number | null;
  headroom: number | null;
  reasons: string[];
  status: string;
  kind: string;
  provenance: string;
  href: string;
  analyseHref: string | null;
  sourceLabel?: string | null;
  sourceHref?: string | null;
};

function strategyScore(
  row: {
    zone?: string | null;
    siteAreaSqm?: number | null;
    proposedFsr?: number | null;
    currentFsr?: number | null;
    stationDistanceM?: number | null;
    quickHeadroom?: number | null;
    quickScore?: number | null;
    keySiteStatus?: string | null;
    strategyScores?: unknown;
  },
  profile: StrategyProfile,
): number {
  const cached =
    row.strategyScores && typeof row.strategyScores === "object"
      ? (row.strategyScores as Record<string, number>)[profile.strategy]
      : undefined;
  if (typeof cached === "number") return cached;

  let score = row.quickScore ?? 40;
  const zone = (row.zone ?? "").toUpperCase();
  if (profile.preferredZones.length) {
    if (profile.preferredZones.some((z) => zone.startsWith(z.toUpperCase()))) score += 18;
    else score -= 8;
  }
  if (profile.minSiteAreaSqm != null && row.siteAreaSqm != null) {
    if (row.siteAreaSqm >= profile.minSiteAreaSqm) score += 8;
    else score -= 12;
  }
  if (row.proposedFsr != null && row.currentFsr != null && row.proposedFsr > row.currentFsr) score += 12;
  if (profile.maxStationDistanceM != null && row.stationDistanceM != null) {
    if (row.stationDistanceM <= profile.maxStationDistanceM) score += 10;
    else score -= 6;
  }
  if (row.keySiteStatus) score += 8;
  if (profile.strategy === "TOWNHOUSES" && /R2|R3/.test(zone)) score += 6;
  if (profile.strategy === "APARTMENTS" && /R3|R4|MU1|B4|E1/.test(zone)) score += 6;
  if (profile.strategy === "CO_LIVING" && row.stationDistanceM != null && row.stationDistanceM <= 800) {
    score += 8;
  }
  return score;
}

function reasonsFor(
  row: {
    proposedFsr?: number | null;
    currentFsr?: number | null;
    keySiteStatus?: string | null;
    stationDistanceM?: number | null;
    quickHeadroom?: number | null;
    reasonHints?: unknown;
    zone?: string | null;
  },
): string[] {
  const out: string[] = [];
  const hints = Array.isArray(row.reasonHints) ? row.reasonHints.map(String) : [];
  out.push(...hints.slice(0, 3).map(humanizeSiteReason));
  if (!out.length) {
    if (row.proposedFsr != null && row.currentFsr != null && row.proposedFsr > row.currentFsr) {
      out.push(`Proposed FSR uplift: ${row.currentFsr} → ${row.proposedFsr}`);
    }
    if (row.keySiteStatus) out.push(`Key site · ${row.keySiteStatus}`);
    if (row.stationDistanceM != null && row.stationDistanceM <= 800) {
      out.push(`About ${Math.round(row.stationDistanceM)}m to a station`);
    }
    if (row.zone) out.push(`Zone ${row.zone}`);
  }
  return [...new Set(out)].slice(0, 3);
}

/** Today sites — INDEX_DISCOVERY only, max 10 unique canonical keys. */
export async function listTodaySiteCandidates(
  profile: StrategyProfile,
  opts?: { limit?: number },
): Promise<{ candidates: SiteCandidateView[]; indexReady: boolean; indexCount: number }> {
  const limit = opts?.limit ?? 10;
  const indexCount = await prisma.siteCandidateIndex.count({
    where: { lifecycleStatus: "ACTIVE", provenance: "INDEX_DISCOVERY" },
  });
  const indexReady = indexCount > 0;

  const rows = await prisma.siteCandidateIndex.findMany({
    where: { lifecycleStatus: "ACTIVE", provenance: "INDEX_DISCOVERY" },
    orderBy: [{ quickScore: "desc" }, { updatedAt: "desc" }],
    take: 240,
  });

  const ranked = rows
    .map((r) => ({ row: r, score: strategyScore(r, profile) }))
    .sort((a, b) => b.score - a.score);

  const toView = (row: (typeof ranked)[number]["row"], score: number): SiteCandidateView => {
    const href = buildMapHref({
      lat: row.centroidLat,
      lng: row.centroidLng,
      zoom: 18,
      parcelId: Array.isArray(row.parcelIds) ? String((row.parcelIds as string[])[0] ?? "") : null,
      bbox: row.bbox as { west: number; south: number; east: number; north: number } | null,
      opportunityId: row.opportunityId,
    });
    return {
      id: row.id,
      canonicalKey: row.canonicalKey,
      name: row.address ?? row.suburb ?? row.canonicalKey,
      address: row.address ?? row.suburb ?? "Sydney site",
      suburb: row.suburb,
      lga: row.lga,
      siteAreaSqm: row.siteAreaSqm,
      lotCount: row.lotCount,
      owners: row.owners,
      currentFsr: row.currentFsr,
      proposedFsr: row.proposedFsr,
      stationDistanceM: row.stationDistanceM,
      score: Math.round(score),
      maxPayable: row.maxPayable,
      headroom: row.quickHeadroom,
      reasons: reasonsFor(row),
      status: "CANDIDATE",
      kind: row.kind,
      provenance: row.provenance,
      href,
      analyseHref: row.opportunityId ? `/opportunities/${row.opportunityId}` : null,
    };
  };

  // Soft geographic spread so Today reflects Greater Sydney, not one hot suburb.
  const maxPerLga = Math.max(2, Math.ceil(limit / 5));
  const seen = new Set<string>();
  const perLga = new Map<string, number>();
  const out: SiteCandidateView[] = [];

  for (const { row, score } of ranked) {
    if (seen.has(row.canonicalKey)) continue;
    const lgaKey = (row.lga || row.suburb || "unknown").toUpperCase();
    if ((perLga.get(lgaKey) ?? 0) >= maxPerLga) continue;
    seen.add(row.canonicalKey);
    perLga.set(lgaKey, (perLga.get(lgaKey) ?? 0) + 1);
    out.push(toView(row, score));
    if (out.length >= limit) break;
  }
  if (out.length < limit) {
    for (const { row, score } of ranked) {
      if (seen.has(row.canonicalKey)) continue;
      seen.add(row.canonicalKey);
      out.push(toView(row, score));
      if (out.length >= limit) break;
    }
  }
  return { candidates: out, indexReady, indexCount };
}

/**
 * Optional enrichment only: attach USER_ANALYSED opportunityId onto an existing INDEX_DISCOVERY row
 * when canonical keys match. Never creates discovery candidates from Opportunities.
 */
export async function enrichIndexFromActiveOpportunities(): Promise<{ enriched: number }> {
  const opps = await prisma.opportunity.findMany({
    where: { lifecycleStatus: "ACTIVE", status: { in: ["ANALYSING", "FEASIBLE", "WATCHING", "ACQUIRING"] } },
    take: 100,
    include: {
      parcels: {
        where: { included: true },
        select: { parcel: { select: { externalParcelId: true } } },
      },
    },
  });
  let enriched = 0;
  for (const o of opps) {
    const ids = o.parcels.map((p) => p.parcel.externalParcelId).sort();
    const key = ids.join("|");
    if (!key) continue;
    const existing = await prisma.siteCandidateIndex.findUnique({ where: { canonicalKey: key } });
    if (!existing || existing.provenance !== "INDEX_DISCOVERY") continue;
    await prisma.siteCandidateIndex.update({
      where: { id: existing.id },
      data: {
        opportunityId: o.id,
        quickHeadroom: o.acquisitionHeadroom ?? existing.quickHeadroom,
        maxPayable: o.maxLandBudget ?? existing.maxPayable,
        // Keep INDEX_DISCOVERY as provenance — opportunity only enriches.
      },
    });
    enriched++;
  }
  return { enriched };
}
