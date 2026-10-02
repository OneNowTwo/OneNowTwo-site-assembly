export interface YieldInputs {
  siteAreaSqm: number;
  fsr: number;
  efficiency: number;
  siteCoverage: number;
  floorToFloorM: number;
  avgDwellingSizeSqm: number;
  carSpacesPerDwelling: number;
  heightLimitM: number | null;
  /** Planning/site efficiency applied to theoretical GFA (default 1 = no haircut). */
  planningAdjustment?: number;
  /** Manual override of achievable GFA. */
  achievableGfaOverride?: number | null;
  /** When set, dwelling count comes from unit mix rather than saleable ÷ avg size. */
  unitCountOverride?: number | null;
  /** When set, saleable area for dwelling fallback uses this (e.g. unit mix total). */
  saleableAreaOverride?: number | null;
}

export interface YieldResult {
  /** Site × FSR — theoretical planning capacity, not an achievable building. */
  theoreticalGfa: number;
  planningAdjustment: number;
  /** Theoretical × planning adjustment, or manual override. */
  achievableGfa: number;
  gfaSource: "SYSTEM_ESTIMATE" | "OVERRIDE";
  /** @deprecated alias of achievableGfa for older callers */
  gfa: number;
  saleableArea: number;
  dwellingsExact: number;
  dwellings: number;
  footprintSqm: number;
  storeys: number;
  indicativeHeightM: number;
  heightCompliant: boolean | null;
  maxStoreysUnderHeight: number | null;
  carSpaces: number;
}

/**
 * Indicative yield distinguishing theoretical FSR capacity from achievable GFA.
 * Theoretical GFA = site × FSR.
 * Achievable GFA = override ?? theoretical × planningAdjustment.
 * Saleable = achievable × efficiency (or override from unit mix).
 */
export function computeYield(i: YieldInputs): YieldResult {
  const theoreticalGfa = Math.max(0, i.siteAreaSqm * i.fsr);
  const planningAdjustment = i.planningAdjustment ?? 1;
  const gfaSource = i.achievableGfaOverride != null && i.achievableGfaOverride > 0 ? "OVERRIDE" : "SYSTEM_ESTIMATE";
  const achievableGfa = gfaSource === "OVERRIDE" ? i.achievableGfaOverride! : theoreticalGfa * planningAdjustment;
  const saleableArea = i.saleableAreaOverride != null && i.saleableAreaOverride > 0 ? i.saleableAreaOverride : achievableGfa * i.efficiency;
  const dwellingsExact =
    i.unitCountOverride != null && i.unitCountOverride >= 0
      ? i.unitCountOverride
      : i.avgDwellingSizeSqm > 0
        ? saleableArea / i.avgDwellingSizeSqm
        : 0;
  const dwellings = i.unitCountOverride != null ? Math.round(i.unitCountOverride) : Math.floor(dwellingsExact + 1e-9);
  const footprintSqm = i.siteAreaSqm * i.siteCoverage;
  const storeys = footprintSqm > 0 && achievableGfa > 0 ? Math.ceil(achievableGfa / footprintSqm - 1e-9) : 0;
  const indicativeHeightM = storeys * i.floorToFloorM;
  const maxStoreysUnderHeight = i.heightLimitM != null && i.floorToFloorM > 0 ? Math.floor(i.heightLimitM / i.floorToFloorM) : null;
  return {
    theoreticalGfa,
    planningAdjustment,
    achievableGfa,
    gfaSource,
    gfa: achievableGfa,
    saleableArea,
    dwellingsExact,
    dwellings,
    footprintSqm,
    storeys,
    indicativeHeightM,
    heightCompliant: i.heightLimitM == null ? null : indicativeHeightM <= i.heightLimitM + 1e-9,
    maxStoreysUnderHeight,
    carSpaces: Math.ceil(dwellings * i.carSpacesPerDwelling),
  };
}
