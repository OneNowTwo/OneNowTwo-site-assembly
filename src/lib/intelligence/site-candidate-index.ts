/**
 * SiteCandidateIndex — progressive Sydney-wide candidate store for Today / Find.
 * Detailed Analyse still uses the full opportunity engine.
 */

import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { StrategyProfile } from "@/lib/source-watcher/strategy-profile";
import { isFixtureOnlySource } from "@/lib/monitoring/source-presentation";
import { buildMapHref } from "@/lib/map/map-target";
import { canonicalParcelKey } from "./canonical-key";

export type SiteCandidateView = {
  id: string;
  canonicalKey: string;
  name: string;
  address: string;
  suburb: string | null;
  lga: string | null;
  siteAreaSqm: number | null;
  currentFsr: number | null;
  proposedFsr: number | null;
  score: number | null;
  maxPayable: number | null;
  headroom: number | null;
  reasons: string[];
  status: string;
  kind: string;
  href: string;
  sourceLabel?: string | null;
  sourceHref?: string | null;
};

function strategyScore(row: {
  zone?: string | null;
  siteAreaSqm?: number | null;
  proposedFsr?: number | null;
  currentFsr?: number | null;
  stationDistanceM?: number | null;
  quickHeadroom?: number | null;
  quickScore?: number | null;
  keySiteStatus?: string | null;
  strategyScores?: unknown;
}, profile: StrategyProfile): number {
  const cached = row.strategyScores && typeof row.strategyScores === "object"
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
  if (profile.minProposedFsr != null && row.proposedFsr != null) {
    if (row.proposedFsr >= profile.minProposedFsr) score += 14;
  } else if (row.proposedFsr != null && row.currentFsr != null && row.proposedFsr > row.currentFsr) {
    score += 12;
  }
  if (profile.maxStationDistanceM != null && row.stationDistanceM != null) {
    if (row.stationDistanceM <= profile.maxStationDistanceM) score += 10;
    else score -= 6;
  }
  if (profile.requirePositiveHeadroom) {
    if ((row.quickHeadroom ?? 0) > 0) score += 10;
    else score -= 5;
  }
  if (row.keySiteStatus) score += 8;
  if (profile.strategy === "TOWNHOUSES" && /R2|R3/.test(zone)) score += 6;
  if (profile.strategy === "APARTMENTS" && /R3|R4|MU1|B4|E1/.test(zone)) score += 6;
  if (profile.strategy === "CO_LIVING" && row.stationDistanceM != null && row.stationDistanceM <= 800) {
    score += 8;
  }
  return score;
}

function reasonsFor(row: {
  proposedFsr?: number | null;
  currentFsr?: number | null;
  keySiteStatus?: string | null;
  stationDistanceM?: number | null;
  quickHeadroom?: number | null;
  reasonHints?: unknown;
}, profile: StrategyProfile): string[] {
  const out: string[] = [];
  const hints = Array.isArray(row.reasonHints) ? row.reasonHints.map(String) : [];
  out.push(...hints.slice(0, 3));
  if (row.proposedFsr != null && row.currentFsr != null && row.proposedFsr > row.currentFsr) {
    out.push(`NEW PROPOSED DENSITY UPLIFT · ${row.currentFsr} → ${row.proposedFsr} FSR`);
  } else if (row.proposedFsr != null) {
    out.push(`Proposed FSR ${row.proposedFsr}`);
  }
  if (row.keySiteStatus) out.push(`KEY SITE OPPORTUNITY · ${row.keySiteStatus}`);
  if (row.stationDistanceM != null && row.stationDistanceM <= 800) {
    out.push(`STATION PROXIMITY · ${Math.round(row.stationDistanceM)}m`);
  }
  if (row.quickHeadroom != null && row.quickHeadroom > 0) {
    out.push(`STRONG QUICK FEASIBILITY · +$${(row.quickHeadroom / 1e6).toFixed(1)}m indicative headroom`);
  }
  if (!out.length) {
    out.push(
      profile.strategy === "APARTMENTS"
        ? "Matches apartment strategy profile"
        : "Sydney candidate from progressive index",
    );
  }
  return [...new Set(out)].slice(0, 4);
}

/** Read ranked unique candidates for Today (max ~10). */
export async function listTodaySiteCandidates(
  profile: StrategyProfile,
  opts?: { limit?: number },
): Promise<SiteCandidateView[]> {
  const limit = opts?.limit ?? 10;
  const rows = await prisma.siteCandidateIndex.findMany({
    where: { lifecycleStatus: "ACTIVE" },
    orderBy: [{ quickScore: "desc" }, { updatedAt: "desc" }],
    take: 80,
  });

  const ranked = rows
    .map((r) => ({ row: r, score: strategyScore(r, profile) }))
    .sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const out: SiteCandidateView[] = [];
  for (const { row, score } of ranked) {
    if (seen.has(row.canonicalKey)) continue;
    seen.add(row.canonicalKey);
    const href =
      row.opportunityId
        ? buildMapHref({ opportunityId: row.opportunityId, lat: row.centroidLat, lng: row.centroidLng, zoom: 18 })
        : row.kind === "KEY_SITE"
          ? buildMapHref({
              keySiteId: row.canonicalKey.replace(/^keysite:/, ""),
              lat: row.centroidLat,
              lng: row.centroidLng,
            })
          : row.kind === "PLANNING_AREA"
            ? buildMapHref({
                planningChangeAreaId: row.canonicalKey.replace(/^pca:/, ""),
                lat: row.centroidLat,
                lng: row.centroidLng,
              })
            : row.centroidLat != null && row.centroidLng != null
              ? buildMapHref({ lat: row.centroidLat, lng: row.centroidLng, zoom: 17, parcelId: Array.isArray(row.parcelIds) ? String((row.parcelIds as string[])[0] ?? "") : null })
              : "/find";

    out.push({
      id: row.id,
      canonicalKey: row.canonicalKey,
      name: row.address ?? row.suburb ?? row.canonicalKey,
      address: row.address ?? row.suburb ?? "Sydney site",
      suburb: row.suburb,
      lga: row.lga,
      siteAreaSqm: row.siteAreaSqm,
      currentFsr: row.currentFsr,
      proposedFsr: row.proposedFsr,
      score: Math.round(score),
      maxPayable: row.maxPayable,
      headroom: row.quickHeadroom,
      reasons: reasonsFor(row, profile),
      status: "CANDIDATE",
      kind: row.kind,
      href,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Seed / refresh index rows from live KeySite + PlanningChangeArea + recent ACTIVE opportunities.
 * Safe to run in batches; does not crawl all Sydney parcels synchronously.
 */
export async function refreshSiteCandidateIndexFromKnownEntities(opts?: {
  includeOpportunities?: boolean;
}): Promise<{ upserted: number }> {
  let upserted = 0;
  const keySites = await prisma.keySite.findMany({
    take: 200,
    orderBy: { updatedAt: "desc" },
    include: {
      planningChangeArea: {
        select: { id: true, title: true, status: true, suburbs: true, lgas: true, sourceId: true, sourceUrl: true, bbox: true },
      },
    },
  });

  for (const ks of keySites) {
    if (
      isFixtureOnlySource(ks.planningChangeArea.sourceId) ||
      ks.planningChangeArea.id.startsWith("fixture-")
    ) {
      continue;
    }
    const controls = (ks.incentiveControls ?? ks.proposedControls ?? {}) as {
      fsr?: number | null;
      incentiveFsr?: number | null;
      heightM?: number | null;
    };
    const bbox = (ks.bbox ?? ks.planningChangeArea.bbox) as {
      west?: number;
      south?: number;
      east?: number;
      north?: number;
    } | null;
    const centroidLat =
      bbox && typeof bbox.south === "number" && typeof bbox.north === "number"
        ? (bbox.south + bbox.north) / 2
        : null;
    const centroidLng =
      bbox && typeof bbox.west === "number" && typeof bbox.east === "number"
        ? (bbox.west + bbox.east) / 2
        : null;
    const proposedFsr = controls.incentiveFsr ?? controls.fsr ?? null;
    const canonicalKey = `keysite:${ks.externalKeySiteId}`;
    const req = ks.requirements as { requiredCount?: number } | null;
    await prisma.siteCandidateIndex.upsert({
      where: { canonicalKey },
      create: {
        canonicalKey,
        kind: "KEY_SITE",
        address: ks.name,
        suburb: ks.planningChangeArea.suburbs?.[0] ?? null,
        lga: ks.planningChangeArea.lgas?.[0] ?? null,
        proposedFsr,
        proposedHeightM: controls.heightM ?? null,
        keySiteStatus: req?.requiredCount != null ? `${req.requiredCount} properties required` : ks.planningChangeArea.status,
        centroidLat,
        centroidLng,
        bbox: (ks.bbox ?? undefined) as Prisma.InputJsonValue | undefined,
        geometry: (ks.geometry ?? undefined) as Prisma.InputJsonValue | undefined,
        quickScore: proposedFsr != null ? 55 + proposedFsr * 8 : 50,
        reasonHints: ["KEY SITE OPPORTUNITY", ks.planningChangeArea.title] as unknown as Prisma.InputJsonValue,
        sourceRefs: {
          planningChangeAreaId: ks.planningChangeArea.id,
          sourceUrl: ks.sourceUrl ?? ks.planningChangeArea.sourceUrl,
        } as unknown as Prisma.InputJsonValue,
        lastEvaluatedAt: new Date(),
      },
      update: {
        address: ks.name,
        suburb: ks.planningChangeArea.suburbs?.[0] ?? null,
        lga: ks.planningChangeArea.lgas?.[0] ?? null,
        proposedFsr,
        keySiteStatus: req?.requiredCount != null ? `${req.requiredCount} properties required` : ks.planningChangeArea.status,
        centroidLat,
        centroidLng,
        quickScore: proposedFsr != null ? 55 + proposedFsr * 8 : 50,
        lastEvaluatedAt: new Date(),
        lifecycleStatus: "ACTIVE",
      },
    });
    upserted++;
  }

  if (opts?.includeOpportunities !== false) {
    const opps = await prisma.opportunity.findMany({
      where: { lifecycleStatus: "ACTIVE", status: { in: ["ANALYSING", "FEASIBLE", "WATCHING", "ACQUIRING"] } },
      orderBy: [{ score: "desc" }, { updatedAt: "desc" }],
      take: 40,
      include: {
        parcels: {
          where: { included: true },
          orderBy: { sortOrder: "asc" },
          include: { parcel: true },
        },
      },
    });
    for (const o of opps) {
      const parcelIds = o.parcels.map((p) => p.parcel.externalParcelId);
      const canonicalKey = o.canonicalKey ?? canonicalParcelKey(parcelIds);
      if (!canonicalKey) continue;
      const first = o.parcels[0]?.parcel;
      await prisma.siteCandidateIndex.upsert({
        where: { canonicalKey },
        create: {
          canonicalKey,
          kind: parcelIds.length > 1 ? "ASSEMBLY" : "PARCEL",
          parcelIds: parcelIds as unknown as Prisma.InputJsonValue,
          address: first?.address ?? o.name,
          suburb: o.suburb ?? first?.suburb ?? null,
          lga: o.lga ?? first?.lga ?? null,
          zone: first?.zone ?? null,
          siteAreaSqm: o.totalSiteArea,
          lotCount: parcelIds.length,
          currentFsr: first?.fsr ?? null,
          currentHeightM: first?.heightM ?? null,
          quickScore: o.score ?? 45,
          quickHeadroom: o.acquisitionHeadroom,
          maxPayable: o.maxLandBudget,
          centroidLat: first?.centroidLat ?? null,
          centroidLng: first?.centroidLng ?? null,
          opportunityId: o.id,
          reasonHints: ["From latest analysis"] as unknown as Prisma.InputJsonValue,
          lastEvaluatedAt: new Date(),
        },
        update: {
          quickScore: o.score ?? undefined,
          quickHeadroom: o.acquisitionHeadroom,
          maxPayable: o.maxLandBudget,
          opportunityId: o.id,
          lastEvaluatedAt: new Date(),
          lifecycleStatus: "ACTIVE",
        },
      });
      upserted++;
    }
  }

  return { upserted };
}
