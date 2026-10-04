import { type Adjacency, components, inducedDegree } from "./geometry";

export interface CriticalLotInput {
  id: string;
  areaSqm: number;
  marketValue: number | null;
}

export interface Economics {
  areaSqm: number;
  gfa: number;
  budget: number;
  grv?: number;
  headroom?: number;
  connected?: boolean;
}

export interface CriticalLotResult {
  id: string;
  status: "CRITICAL" | "OPTIONAL";
  reasons: string[];
  areaWithout: number;
  areaReductionPct: number;
  gfaWithout: number;
  gfaReductionPct: number;
  budgetWithout: number;
  budgetChangePct: number;
  grvWithout: number;
  grvReductionPct: number;
  headroomWithout: number;
  headroomDelta: number;
  remainingConnected: boolean;
  remainingFragments: number;
  belowMinViable: boolean;
  viableWithout: boolean;
  /** Neighbours within the assembly. */
  degree: number;
  /** True when removing the lot splits the remaining assembly (graph cut vertex). */
  connector: boolean;
}

export interface CriticalOptions {
  minViableSiteAreaSqm: number;
  /** A lot whose loss cuts site area or GFA by at least this share is critical. */
  majorReductionPct?: number;
}

/**
 * "What if this property can't be acquired?" — re-runs the economics without each lot and classifies
 * it CRITICAL when the remainder fragments, drops below the minimum viable site, cannot pay market
 * value for the remaining lots, or loses a major share of area / GFA / headroom. Otherwise OPTIONAL.
 */
export function analyseCriticalLots(
  lots: CriticalLotInput[],
  adj: Adjacency,
  base: Economics,
  economicsFor: (ids: string[]) => Economics,
  opts: CriticalOptions,
): CriticalLotResult[] {
  const major = opts.majorReductionPct ?? 0.3;
  const ids = lots.map((l) => l.id);
  const degree = inducedDegree(ids, adj);
  return lots.map((lot) => {
    const remaining = ids.filter((i) => i !== lot.id);
    const e = remaining.length ? economicsFor(remaining) : { areaSqm: 0, gfa: 0, budget: 0, grv: 0, headroom: 0 };
    const frags = remaining.length ? components(remaining, adj).length : 0;
    const remainingConnected = frags <= 1;
    const areaReductionPct = base.areaSqm > 0 ? 1 - e.areaSqm / base.areaSqm : 1;
    const gfaReductionPct = base.gfa > 0 ? 1 - e.gfa / base.gfa : 1;
    const budgetChangePct = base.budget !== 0 ? e.budget / base.budget - 1 : 0;
    const baseGrv = base.grv ?? 0;
    const grvWithout = e.grv ?? 0;
    const grvReductionPct = baseGrv > 0 ? 1 - grvWithout / baseGrv : 0;
    const baseHeadroom = base.headroom ?? 0;
    const headroomWithout = e.headroom ?? 0;
    const headroomDelta = headroomWithout - baseHeadroom;
    const remainingMv = lots.filter((l) => l.id !== lot.id).reduce((s, l) => s + (l.marketValue ?? 0), 0);
    const belowMinViable = e.areaSqm < opts.minViableSiteAreaSqm;
    const viableWithout = e.budget > 0 && e.budget >= remainingMv;

    const reasons: string[] = [];
    if (!remainingConnected) reasons.push(`Removing it splits the site into ${frags} disconnected parts`);
    if (belowMinViable)
      reasons.push(
        `Remaining site ${Math.round(e.areaSqm).toLocaleString("en-AU")} sqm is below preferred scanner site-size threshold (${opts.minViableSiteAreaSqm.toLocaleString("en-AU")} sqm)`,
      );
    if (!viableWithout) reasons.push(e.budget <= 0 ? "Project has no residual land value without it" : "Remaining budget cannot cover market value of the other lots");
    if (areaReductionPct >= major) reasons.push(`Site area falls ${(areaReductionPct * 100).toFixed(0)}%`);
    if (gfaReductionPct >= major && Math.abs(gfaReductionPct - areaReductionPct) > 0.01) reasons.push(`GFA falls ${(gfaReductionPct * 100).toFixed(0)}%`);
    if (grvReductionPct >= major) reasons.push(`GRV falls ${(grvReductionPct * 100).toFixed(0)}%`);
    const headroomReductionPct = baseHeadroom > 0 ? -headroomDelta / baseHeadroom : 0;
    if (headroomDelta < -1_000_000 && headroomReductionPct >= major) {
      reasons.push(`Acquisition headroom falls $${(Math.abs(headroomDelta) / 1e6).toFixed(1)}m`);
    }
    const critical = reasons.length > 0;
    if (!critical) {
      reasons.push(
        `Site area −${(areaReductionPct * 100).toFixed(0)}%, GFA −${(gfaReductionPct * 100).toFixed(0)}%; remaining lots stay contiguous and viable`,
      );
    }
    return {
      id: lot.id,
      status: critical ? "CRITICAL" : "OPTIONAL",
      reasons,
      areaWithout: e.areaSqm,
      areaReductionPct,
      gfaWithout: e.gfa,
      gfaReductionPct,
      budgetWithout: e.budget,
      budgetChangePct,
      grvWithout,
      grvReductionPct,
      headroomWithout,
      headroomDelta,
      remainingConnected,
      remainingFragments: frags,
      belowMinViable,
      viableWithout,
      degree: degree.get(lot.id) ?? 0,
      connector: !remainingConnected,
    };
  });
}
