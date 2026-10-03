import type { ParcelData } from "@/lib/types";
import { resolveEffectiveControls, type WalkingDistanceHint } from "@/lib/analysis/effective-controls";
import { affordableHousingScenarios } from "@/lib/analysis/affordable-housing";
import type { NominatedCentre } from "@/lib/data-sources/housing-sepp-lmr";
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

export class CuratedPlanningRuleProvider implements PlanningRuleProvider {
  readonly name = "Curated official planning-change registry";

  async getPendingPlanningChanges(input: {
    lng: number;
    lat: number;
    lga?: string | null;
    suburb?: string | null;
  }): Promise<PlanningChangeRecord[]> {
    return matchPlanningChanges(input);
  }

  async refreshFromOfficialSources(): Promise<{ upserted: number; messages: string[] }> {
    // MVP: curated registry with lastChecked bump. Cron re-validates URLs later.
    for (const c of matchPlanningChanges({ lng: 151.24, lat: -33.84 })) {
      c.lastChecked = new Date().toISOString();
    }
    return {
      upserted: 0,
      messages: [
        "Curated registry refreshed (lastChecked). Full Planning Proposal Register scrape not enabled — use official portal for statutory confirmation.",
      ],
    };
  }
}

export const planningRuleProvider = new CuratedPlanningRuleProvider();

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
    if (eff.statePolicy) {
      const walkingOk = eff.lmr.distanceBasis === "PEDESTRIAN_ROUTE";
      pathways.push({
        id: "pathway:lmr",
        kind: "LMR",
        title: "Low & Mid-Rise Housing (Housing SEPP)",
        status: walkingOk ? "CANDIDATE" : "REQUIRES_PLANNING_CONFIRMATION",
        summary: walkingOk
          ? `LMR ${eff.lmr.band} near ${eff.lmr.centreName ?? "nominated centre"} — walking distance confirmed.`
          : `LMR proximity screen near ${eff.lmr.centreName ?? "nominated centre"} — walking not confirmed; modelled FSR requires planning confirmation.`,
        meta: LMR_META,
        controls: {
          baseFsr: eff.lep.fsr,
          pathwayFsr: eff.statePolicy.fsr,
          effectiveFsr: eff.modelled.fsr,
          baseHeightM: eff.lep.heightM,
          pathwayHeightM: eff.statePolicy.heightM,
          effectiveHeightM: eff.modelled.heightM,
          howCalculated: [
            `LEP FSR: ${eff.lep.fsr ?? "—"}`,
            `LMR non-discretionary FSR: ${eff.statePolicy.fsr ?? "—"}`,
            `Modelled effective FSR: ${eff.modelled.fsr ?? "—"} (${eff.modelled.certainty})`,
            `Distance basis: ${eff.lmr.distanceBasis}`,
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
