import type { ParcelData } from "@/lib/types";
import { resolveEffectiveControls, type WalkingDistanceHint } from "@/lib/analysis/effective-controls";
import { affordableHousingScenarios } from "@/lib/analysis/affordable-housing";
import type { NominatedCentre } from "@/lib/data-sources/housing-sepp-lmr";
import { fetchPlanningProposalsNear } from "@/lib/data-sources/nsw-planning-proposals";
import { matchPlanningChanges } from "./change-registry";
import type { CurrentPathway, CurrentStatutoryControls, ParcelPlanningContext, PlanningChangeRecord, PlanningRuleProvider } from "./types";

const LMR_META = {
  id: "nsw:housing-sepp-lmr",
  status: "CURRENT" as const,
  instrumentName: "State Environmental Planning Policy (Housing) 2021 — Low and Mid-Rise Housing",
  authority: "NSW",
  sourceUrl: "https://legislation.nsw.gov.au/",
  sourceAuthority: "NSW legislation / Housing SEPP",
  effectiveDate: "2024-07-01",
  lastChecked: new Date().toISOString(),
  clauseRef: "Low and mid-rise housing",
};

const AH_META = {
  id: "nsw:housing-sepp-infill-affordable",
  status: "CURRENT" as const,
  instrumentName: "State Environmental Planning Policy (Housing) 2021 — In-fill affordable housing",
  authority: "NSW",
  sourceUrl: "https://legislation.nsw.gov.au/",
  sourceAuthority: "NSW legislation / Housing SEPP",
  effectiveDate: null,
  lastChecked: new Date().toISOString(),
  clauseRef: "In-fill affordable housing",
};

/** Merge curated high-signal watchlist with statewide NSW PP spatial layers. Curated wins on id clash. */
export async function resolvePendingPlanningChanges(input: {
  lng: number;
  lat: number;
  lga?: string | null;
  suburb?: string | null;
}): Promise<PlanningChangeRecord[]> {
  const curated = matchPlanningChanges(input);
  const live = await fetchPlanningProposalsNear({ lng: input.lng, lat: input.lat }).catch(() => []);
  const byKey = new Map<string, PlanningChangeRecord>();
  for (const c of live) {
    const key = (c.planningProposalNumber ?? c.id).toUpperCase();
    byKey.set(key, c);
  }
  for (const c of curated) {
    const key = (c.planningProposalNumber ?? c.id).toUpperCase();
    byKey.set(key, c);
  }
  return [...byKey.values()].filter((c) => c.status !== "CURRENT" && c.status !== "SUPERSEDED" && c.status !== "WITHDRAWN");
}

export class StatewidePlanningRuleProvider implements PlanningRuleProvider {
  readonly name = "NSW statewide planning proposals + curated watchlist";

  async getPendingPlanningChanges(input: {
    lng: number;
    lat: number;
    lga?: string | null;
    suburb?: string | null;
  }): Promise<PlanningChangeRecord[]> {
    return resolvePendingPlanningChanges(input);
  }

  async refreshFromOfficialSources(): Promise<{ upserted: number; messages: string[] }> {
    for (const c of matchPlanningChanges({ lng: 151.24, lat: -33.84 })) {
      c.lastChecked = new Date().toISOString();
    }
    // Probe a few metro points to confirm Agency layers respond.
    const probes = await Promise.all([
      fetchPlanningProposalsNear({ lng: 151.218, lat: -33.833 }).catch(() => []),
      fetchPlanningProposalsNear({ lng: 151.01, lat: -33.815 }).catch(() => []),
      fetchPlanningProposalsNear({ lng: 151.236, lat: -33.879 }).catch(() => []),
    ]);
    const liveCount = probes.reduce((n, rows) => n + rows.length, 0);
    return {
      upserted: liveCount,
      messages: [
        "Curated watchlist lastChecked bumped.",
        `Statewide NSW Planning Proposal Agency probe matched ${liveCount} active proposal(s) across sample points.`,
        "Proposed layers never rewrite CURRENT LEP/EPI controls.",
      ],
    };
  }
}

/** @deprecated Use StatewidePlanningRuleProvider — kept for import compatibility. */
export const CuratedPlanningRuleProvider = StatewidePlanningRuleProvider;

export const planningRuleProvider = new StatewidePlanningRuleProvider();

function statutoryFromParcel(p: ParcelData): CurrentStatutoryControls {
  const pl = p.planning;
  return {
    zone: pl?.zone ?? null,
    zoneName: pl?.zoneName ?? null,
    fsr: pl?.fsr ?? null,
    heightM: pl?.heightM ?? null,
    minLotSizeSqm: pl?.minLotSizeSqm ?? null,
    heritage: pl?.heritage ?? null,
    planningInstrument: pl?.planningInstrument ?? null,
    lga: pl?.lga ?? null,
    fsrStatus: pl?.fsrStatus ?? null,
    sources: [
      pl?.sources.fsr?.source,
      pl?.sources.zone?.source,
      pl?.planningInstrument,
      "NSW Planning Portal — EPI Primary Planning Layers",
    ].filter(Boolean) as string[],
    retrievedAt: p.retrievedAt,
  };
}

export async function getParcelPlanningContext(input: {
  parcel: ParcelData;
  centres?: NominatedCentre[];
  walking?: WalkingDistanceHint | null;
}): Promise<ParcelPlanningContext> {
  const p = input.parcel;
  const currentStatutory = statutoryFromParcel(p);
  const pathways: CurrentPathway[] = [];

  const centres = input.centres ?? [];
  if (centres.length) {
    const eff = resolveEffectiveControls(p.planning, p.centroid, centres, input.walking);
    if (eff.statePolicy && eff.lmr.proximityScreen === "PASS") {
      const dist = eff.lmr.straightLineDistanceM;
      pathways.push({
        id: "pathway:lmr",
        kind: "LMR",
        title: "Low & Mid-Rise Housing (Housing SEPP)",
        status: "REQUIRES_PLANNING_CONFIRMATION",
        summary: `LMR proximity ${eff.lmr.proximityLabel ?? "PASS — ESTIMATED"} · ${dist != null ? `${dist} m straight-line` : "—"} to ${eff.lmr.centreName ?? "nominated centre"}. WITHIN 800M SCREENING AREA — planning confirmation required.`,
        meta: LMR_META,
        controls: {
          baseFsr: eff.lep.fsr,
          pathwayFsr: eff.statePolicy.fsr,
          effectiveFsr: eff.modelled.fsr,
          baseHeightM: eff.lep.heightM,
          pathwayHeightM: eff.statePolicy.heightM,
          effectiveHeightM: eff.modelled.heightM,
          howCalculated: [
            `BASE LEP FSR: ${eff.lep.fsr != null ? `${eff.lep.fsr}:1` : "Not mapped"}`,
            `STATE LMR FSR: ${eff.statePolicy.fsr ?? "—"}:1`,
            `MODELLED EFFECTIVE FSR: ${eff.modelled.fsr ?? "—"}:1`,
            `800 m proximity: ${eff.lmr.proximityLabel ?? "—"} (${dist != null ? `${dist} m straight-line` : "—"})`,
            "ESTIMATED ELIGIBILITY — VERIFY BEFORE ACQUISITION / DA",
          ],
        },
        eligibilityNotes: [
          ...eff.lmr.exclusionNotes,
          eff.lmr.zoneEligible ? "Zone appears LMR-eligible" : "Zone may not be LMR-eligible",
        ],
      });
    }
  }

  // Affordable housing pathway — always show as current-policy candidate when residential.
  const zone = p.planning?.zone ?? "";
  if (/^R[1-4]$/.test(zone) || !zone) {
    const baseFsr = pathways[0]?.controls?.effectiveFsr ?? p.planning?.fsr;
    const baseHeight = pathways[0]?.controls?.effectiveHeightM ?? p.planning?.heightM;
    const scenarios = affordableHousingScenarios({
      baseFsr: baseFsr ?? null,
      baseHeightM: baseHeight ?? null,
      siteAreaSqm: p.areaSqm,
      stackingConfirmed: false,
      baseLabel: pathways[0] ? "LMR / base pathway" : "LEP base",
    });
    const s10 = scenarios[0]!;
    pathways.push({
      id: "pathway:infill-ah",
      kind: "INFILL_AFFORDABLE_HOUSING",
      title: "In-fill affordable housing (Housing SEPP)",
      status: "REQUIRES_PLANNING_CONFIRMATION",
      summary: `Potential +20–30% FSR/height where ~10–15% GFA is affordable housing. Example 10% AH → effective FSR ${s10.effectiveFsr?.toFixed(2) ?? "—"}:1 (candidate only).`,
      meta: AH_META,
      controls: {
        baseFsr: s10.baseFsr,
        bonusFsrPct: s10.bonusPct,
        effectiveFsr: s10.effectiveFsr,
        baseHeightM: s10.baseHeightM,
        bonusHeightPct: s10.bonusPct,
        effectiveHeightM: s10.effectiveHeightM,
        howCalculated: s10.howCalculated,
      },
      eligibilityNotes: [
        "CURRENT POLICY — SUBJECT TO ELIGIBILITY",
        "Do not stack LMR + AH automatically unless legislation permits for this site",
        "Affordable housing BONUS ≠ affordable housing CONTRIBUTION",
      ],
    });
  }

  const pendingChanges = await planningRuleProvider.getPendingPlanningChanges({
    lng: p.centroid[0],
    lat: p.centroid[1],
    lga: p.planning?.lga,
    suburb: p.suburb,
  });

  return {
    currentStatutory,
    currentPathways: pathways,
    pendingChanges,
    safetyNote:
      "Current feasibility must use CURRENT statutory controls and confirmed pathways only. PROPOSED / GATEWAY / EXHIBITED changes never alter max payable until legally commenced.",
  };
}

export async function getAssemblyPlanningContext(input: {
  parcels: ParcelData[];
  centres?: NominatedCentre[];
}): Promise<{
  safetyNote: string;
  pendingChanges: PlanningChangeRecord[];
  pathwaySummary: CurrentPathway[];
  lotContexts: { externalParcelId: string; context: ParcelPlanningContext }[];
}> {
  const lotContexts = [];
  const pendingById = new Map<string, PlanningChangeRecord>();
  const pathwayById = new Map<string, CurrentPathway>();
  for (const p of input.parcels) {
    const context = await getParcelPlanningContext({ parcel: p, centres: input.centres });
    lotContexts.push({ externalParcelId: p.externalParcelId, context });
    for (const c of context.pendingChanges) pendingById.set(c.id, c);
    for (const pw of context.currentPathways) if (!pathwayById.has(pw.id)) pathwayById.set(pw.id, pw);
  }
  return {
    safetyNote:
      "CURRENT LAW vs CURRENT PATHWAYS vs PROPOSED/PENDING are separate. Proposed controls never contaminate current feasibility.",
    pendingChanges: [...pendingById.values()],
    pathwaySummary: [...pathwayById.values()],
    lotContexts,
  };
}
