export interface YieldInputs {
  siteAreaSqm: number;
  fsr: number;
  efficiency: number;
  siteCoverage: number;
  floorToFloorM: number;
  avgDwellingSizeSqm: number;
  carSpacesPerDwelling: number;
  heightLimitM: number | null;
}

export interface YieldResult {
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

/** Indicative yield: GFA = site × FSR; saleable = GFA × efficiency; dwellings = saleable ÷ average size (rounded down). */
export function computeYield(i: YieldInputs): YieldResult {
  const gfa = Math.max(0, i.siteAreaSqm * i.fsr);
  const saleableArea = gfa * i.efficiency;
  const dwellingsExact = i.avgDwellingSizeSqm > 0 ? saleableArea / i.avgDwellingSizeSqm : 0;
  const dwellings = Math.floor(dwellingsExact + 1e-9);
  const footprintSqm = i.siteAreaSqm * i.siteCoverage;
  const storeys = footprintSqm > 0 && gfa > 0 ? Math.ceil(gfa / footprintSqm - 1e-9) : 0;
  const indicativeHeightM = storeys * i.floorToFloorM;
  const maxStoreysUnderHeight = i.heightLimitM != null && i.floorToFloorM > 0 ? Math.floor(i.heightLimitM / i.floorToFloorM) : null;
  return {
    gfa,
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
