/**
 * In-fill affordable housing pathway (Housing SEPP) — CURRENT POLICY modelling.
 *
 * NSW currently provides potential FSR and height bonuses of roughly 20–30%
 * where approximately 10–15% of GFA is provided as affordable housing.
 *
 * This module models candidate scenarios. Exact eligibility is project-specific —
 * never auto-apply the maximum bonus as a legal certainty.
 *
 * Affordable HOUSING BONUS (capacity uplift) ≠ AFFORDABLE HOUSING CONTRIBUTION (cost).
 */

export type AffordableShare = 0.1 | 0.15;

export interface AffordableHousingScenarioInput {
  /** Base FSR already selected for the pathway (e.g. LEP or LMR modelled). */
  baseFsr: number | null;
  baseHeightM: number | null;
  siteAreaSqm: number;
  /** Share of GFA provided as affordable housing. */
  affordableShare: AffordableShare;
  /**
   * Bonus percentage of base controls.
   * NSW range is typically 20–30%; default maps 10% AH → 20%, 15% AH → 30%.
   */
  bonusPct?: number;
  /** When stacking on LMR is not confirmed for the site. */
  stackingConfirmed?: boolean;
  baseLabel?: string;
}

export interface AffordableHousingScenarioResult {
  label: string;
  policyStatus: "CURRENT_POLICY_SUBJECT_TO_ELIGIBILITY";
  affordableShare: number;
  bonusPct: number;
  baseFsr: number | null;
  bonusFsr: number | null;
  effectiveFsr: number | null;
  baseHeightM: number | null;
  bonusHeightM: number | null;
  effectiveHeightM: number | null;
  theoreticalGfa: number | null;
  affordableGfa: number | null;
  marketSaleableGfaHint: number | null;
  howCalculated: string[];
  certainty: "CANDIDATE" | "REQUIRES_PLANNING_CONFIRMATION";
  note: string;
}

function defaultBonusForShare(share: AffordableShare): number {
  return share >= 0.15 ? 0.3 : 0.2;
}

export function modelInfillAffordableHousing(input: AffordableHousingScenarioInput): AffordableHousingScenarioResult {
  const bonusPct = input.bonusPct ?? defaultBonusForShare(input.affordableShare);
  const how: string[] = [];
  const baseLabel = input.baseLabel ?? "Base development control";
  how.push(`${baseLabel}: FSR ${input.baseFsr ?? "—"} · height ${input.baseHeightM ?? "—"} m`);
  how.push(`Affordable housing provision: ${Math.round(input.affordableShare * 100)}% of GFA`);
  how.push(`Modelled bonus: +${Math.round(bonusPct * 100)}% FSR and height (Housing SEPP in-fill range 20–30%)`);

  const stackingOk = input.stackingConfirmed === true;
  const certainty =
    input.baseFsr == null || !stackingOk ? "REQUIRES_PLANNING_CONFIRMATION" : "CANDIDATE";
  if (!stackingOk) {
    how.push("Stacking with LMR / other State controls REQUIRES PLANNING CONFIRMATION — not auto-stacked as legal certainty");
  }

  const effectiveFsr = input.baseFsr != null ? input.baseFsr * (1 + bonusPct) : null;
  const effectiveHeightM = input.baseHeightM != null ? input.baseHeightM * (1 + bonusPct) : null;
  const theoreticalGfa = effectiveFsr != null ? input.siteAreaSqm * effectiveFsr : null;
  const affordableGfa = theoreticalGfa != null ? theoreticalGfa * input.affordableShare : null;
  const marketSaleableGfaHint = theoreticalGfa != null && affordableGfa != null ? theoreticalGfa - affordableGfa : null;

  if (effectiveFsr != null) how.push(`Modelled effective FSR: ${effectiveFsr.toFixed(2)}:1`);
  if (effectiveHeightM != null) how.push(`Modelled effective height: ${effectiveHeightM.toFixed(1)} m`);

  return {
    label: `${Math.round(input.affordableShare * 100)}% AFFORDABLE HOUSING`,
    policyStatus: "CURRENT_POLICY_SUBJECT_TO_ELIGIBILITY",
    affordableShare: input.affordableShare,
    bonusPct,
    baseFsr: input.baseFsr,
    bonusFsr: input.baseFsr != null ? input.baseFsr * bonusPct : null,
    effectiveFsr,
    baseHeightM: input.baseHeightM,
    bonusHeightM: input.baseHeightM != null ? input.baseHeightM * bonusPct : null,
    effectiveHeightM,
    theoreticalGfa,
    affordableGfa,
    marketSaleableGfaHint,
    howCalculated: how,
    certainty,
    note: "CURRENT POLICY — SUBJECT TO ELIGIBILITY. Not a certified planning advice. Do not treat as automatic development rights.",
  };
}

export function affordableHousingScenarios(base: Omit<AffordableHousingScenarioInput, "affordableShare" | "bonusPct">): AffordableHousingScenarioResult[] {
  return [
    modelInfillAffordableHousing({ ...base, affordableShare: 0.1 }),
    modelInfillAffordableHousing({ ...base, affordableShare: 0.15 }),
  ];
}
