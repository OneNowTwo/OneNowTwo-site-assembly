import type { BBox } from "@/lib/types";
import { fetchNominatedCentres, bboxAround, type NominatedCentre } from "@/lib/data-sources/housing-sepp-lmr";
import { developmentActivityProvider } from "@/lib/data-sources/development-activity";
import { getParcelsForBBox } from "@/lib/parcel-service";
import { resolveEffectiveControls } from "./effective-controls";
import { NON_DEVELOPABLE_ZONES, isHeritageItem } from "./assembly";
import { RADAR_WEIGHTS, type PrecinctRadarRowDTO } from "./radar-shared";

export { RADAR_WEIGHTS } from "./radar-shared";
export type PrecinctRadarRow = PrecinctRadarRowDTO;

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function scorePrecinctFromParcels(centre: NominatedCentre, parcels: { planning: import("@/lib/types").PlanningControls | null; centroid: [number, number]; areaSqm: number; isStrata: boolean }[]): Omit<PrecinctRadarRow, "activityStatus" | "activityMessage"> {
  const effs = parcels.map((p) => resolveEffectiveControls(p.planning, p.centroid, [centre]));
  const residential = parcels.filter((p) => {
    const z = p.planning?.zone;
    return z && /^R[1-4]$/.test(z) && !NON_DEVELOPABLE_ZONES.test(z);
  });
  const uplifts = effs.map((e) => e.fsrUplift);
  const meanUplift = avg(uplifts) ?? 0;
  const lep = avg(effs.map((e) => e.lep.fsr).filter((x): x is number => x != null));
  const mod = avg(effs.map((e) => e.modelled.fsr).filter((x): x is number => x != null));

  const lowDensityShare =
    residential.length === 0
      ? 0
      : residential.filter((p) => (p.planning?.fsr ?? 0.6) <= 0.6 && p.areaSqm >= 350 && p.areaSqm <= 900 && !p.isStrata).length / residential.length;

  const assemblyFriendly =
    residential.length === 0
      ? 0
      : residential.filter((p) => !p.isStrata && p.areaSqm >= 300 && p.areaSqm <= 1000 && !isHeritageItem(p.planning?.heritage ?? null)).length / residential.length;

  const heritageShare =
    residential.length === 0 ? 0 : residential.filter((p) => isHeritageItem(p.planning?.heritage ?? null)).length / residential.length;

  const inBandShare = effs.filter((e) => e.lmr.band !== "OUTSIDE").length / Math.max(parcels.length, 1);

  const planningUplift = Math.min(100, (meanUplift / 0.8) * 100);
  const underdevelopment = lowDensityShare * 100;
  const assemblyFriendlyScore = assemblyFriendly * 100;
  const constraintBurden = Math.max(0, 100 - heritageShare * 120);
  const centreProximity = inBandShare * 100;
  // Activity weight reserved — null until DA feed connected; redistribute conceptually by scoring without inventing.
  const developmentActivity = null as number | null;

  const usableWeights =
    RADAR_WEIGHTS.planningUplift +
    RADAR_WEIGHTS.underdevelopment +
    RADAR_WEIGHTS.assemblyFriendly +
    RADAR_WEIGHTS.constraintBurden +
    RADAR_WEIGHTS.centreProximity;
  const score = Math.round(
    (planningUplift * RADAR_WEIGHTS.planningUplift +
      underdevelopment * RADAR_WEIGHTS.underdevelopment +
      assemblyFriendlyScore * RADAR_WEIGHTS.assemblyFriendly +
      constraintBurden * RADAR_WEIGHTS.constraintBurden +
      centreProximity * RADAR_WEIGHTS.centreProximity) /
      usableWeights,
  );

  const summary: string[] = [];
  if (meanUplift >= 0.25) summary.push("High planning uplift vs base LEP FSR");
  else if (meanUplift >= 0.1) summary.push("Moderate planning uplift");
  else summary.push("Limited modelled FSR uplift from LEP base");
  if (lowDensityShare >= 0.45) summary.push("Low existing density / underdevelopment");
  if (assemblyFriendly >= 0.4) summary.push("Strong assembly-friendly parcel geometry mix");
  if (heritageShare >= 0.15) summary.push("Elevated heritage constraint burden");
  summary.push("Development activity data not connected");

  const scanBbox = bboxAround(centre.lng, centre.lat, 800);

  return {
    precinctId: centre.id,
    name: `${centre.label} 800m catchment`,
    score,
    components: {
      planningUplift: Math.round(planningUplift),
      underdevelopment: Math.round(underdevelopment),
      assemblyFriendly: Math.round(assemblyFriendlyScore),
      constraintBurden: Math.round(constraintBurden),
      centreProximity: Math.round(centreProximity),
      developmentActivity,
    },
    summary,
    sampleParcels: parcels.length,
    eligibleResidential: residential.length,
    meanLepFsr: lep != null ? Math.round(lep * 1000) / 1000 : null,
    meanModelledFsr: mod != null ? Math.round(mod * 1000) / 1000 : null,
    meanFsrUplift: Math.round(meanUplift * 1000) / 1000,
    centre,
    scanBbox,
  };
}

/** Greater Sydney-ish default bbox for radar centre discovery. */
export const SYDNEY_RADAR_BBOX: BBox = { west: 150.7, south: -34.15, east: 151.35, north: -33.55 };

export async function buildOpportunityRadar(opts?: { bbox?: BBox; limit?: number; sampleRadiusM?: number }): Promise<{
  precincts: PrecinctRadarRow[];
  weights: typeof RADAR_WEIGHTS;
  messages: string[];
}> {
  const bbox = opts?.bbox ?? SYDNEY_RADAR_BBOX;
  const limit = opts?.limit ?? 8;
  const sampleRadiusM = opts?.sampleRadiusM ?? 550;
  const messages: string[] = [
    "Precincts ranked from official SEPP (Housing) 2021 Town Centres Map + live EPI parcel samples.",
    "DEVELOPMENT ACTIVITY DATA NOT CONNECTED — competition/untapped index withheld.",
    "LMR eligibility uses straight-line screen only; walking catchment requires confirmation.",
  ];

  const centres = await fetchNominatedCentres(bbox);
  // V1: sample a bounded set of centres (performance). Prefer name diversity.
  const sorted = [...centres].sort((a, b) => a.label.localeCompare(b.label));
  const step = Math.max(1, Math.floor(sorted.length / Math.min(12, sorted.length || 1)));
  const picked = sorted.filter((_, i) => i % step === 0).slice(0, 12);

  const settled = await Promise.allSettled(
    picked.map(async (centre) => {
      const sampleBox = bboxAround(centre.lng, centre.lat, sampleRadiusM);
      const { parcels } = await getParcelsForBBox(sampleBox);
      if (parcels.length < 8) return null;
      const base = scorePrecinctFromParcels(centre, parcels);
      const activity = await developmentActivityProvider.getActivityForPrecinct(centre.id);
      return { ...base, activityStatus: activity.status, activityMessage: activity.message } satisfies PrecinctRadarRow;
    }),
  );

  const rows: PrecinctRadarRow[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled" && r.value) rows.push(r.value);
  }

  rows.sort((a, b) => b.score - a.score);
  return { precincts: rows.slice(0, limit), weights: RADAR_WEIGHTS, messages };
}
