/**
 * Marginal lot analysis — "what does this lot add?"
 * Compares full assembly economics vs assembly without the lot.
 */

export interface MarginalLotEconomics {
  areaSqm: number;
  theoreticalGfa: number;
  achievableGfa: number;
  grv: number;
  maxPayable: number;
  combinedExistingValue: number;
  acquisitionHeadroom: number;
}

export interface MarginalLotResult {
  id: string;
  marketValue: number | null;
  deltaArea: number;
  deltaTheoreticalGfa: number;
  deltaAchievableGfa: number;
  deltaGrv: number;
  deltaMaxPayable: number;
  deltaHeadroom: number;
  /** deltaMaxPayable − marketValue: positive means the lot adds more acquisition capacity than it costs. */
  netValueAdd: number | null;
  verdict: "HIGH_VALUE" | "NEUTRAL" | "DESTROYS_VALUE";
  conclusion: string;
  improvesConnectivity: boolean;
}

/**
 * For each lot, measure the incremental contribution to max payable / headroom vs its market value.
 */
export function analyseMarginalLots(
  lots: { id: string; marketValue: number | null; label?: string }[],
  base: MarginalLotEconomics,
  withoutLot: (id: string) => MarginalLotEconomics,
  opts?: { improvesConnectivity?: (id: string) => boolean },
): MarginalLotResult[] {
  return lots.map((lot) => {
    const w = withoutLot(lot.id);
    const deltaArea = base.areaSqm - w.areaSqm;
    const deltaTheoreticalGfa = base.theoreticalGfa - w.theoreticalGfa;
    const deltaAchievableGfa = base.achievableGfa - w.achievableGfa;
    const deltaGrv = base.grv - w.grv;
    const deltaMaxPayable = base.maxPayable - w.maxPayable;
    const deltaHeadroom = base.acquisitionHeadroom - w.acquisitionHeadroom;
    const mv = lot.marketValue;
    const netValueAdd = mv != null ? deltaMaxPayable - mv : null;
    const improvesConnectivity = opts?.improvesConnectivity?.(lot.id) ?? false;

    let verdict: MarginalLotResult["verdict"] = "NEUTRAL";
    let conclusion: string;
    if (netValueAdd != null && netValueAdd < -50_000) {
      verdict = "DESTROYS_VALUE";
      conclusion = `This parcel destroys value at normal market price (adds $${(deltaMaxPayable / 1e6).toFixed(2)}m capacity vs $${(mv! / 1e6).toFixed(2)}m market). DO NOT INCLUDE unless strategically essential.`;
    } else if (netValueAdd != null && netValueAdd > 200_000) {
      verdict = "HIGH_VALUE";
      conclusion = `High-value lot: adds $${(deltaMaxPayable / 1e6).toFixed(2)}m max payable vs $${(mv! / 1e6).toFixed(2)}m existing value${improvesConnectivity ? "; improves frontage / connectivity" : ""}.`;
    } else if (netValueAdd != null) {
      conclusion = `Marginal contribution near market value (Δ max payable $${(deltaMaxPayable / 1e6).toFixed(2)}m vs MV $${(mv! / 1e6).toFixed(2)}m).`;
    } else {
      conclusion = "Enter an estimated market value to judge whether this lot adds or destroys acquisition headroom.";
    }

    return {
      id: lot.id,
      marketValue: mv,
      deltaArea,
      deltaTheoreticalGfa,
      deltaAchievableGfa,
      deltaGrv,
      deltaMaxPayable,
      deltaHeadroom,
      netValueAdd,
      verdict,
      conclusion,
      improvesConnectivity,
    };
  });
}
