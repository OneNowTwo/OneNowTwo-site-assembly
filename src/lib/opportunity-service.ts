import type { Polygon, MultiPolygon } from "geojson";
import { prisma } from "@/lib/db";
import type { ParcelData } from "@/lib/types";
import { mergeAssumptions, parseOpportunityInputs, DEFAULT_ASSUMPTIONS, type Assumptions } from "@/lib/analysis/assumptions";
import { analyseOpportunity, type OpportunityLot } from "@/lib/analysis/opportunity";
import { lotDp } from "@/lib/format";
import type { Prisma } from "@/generated/prisma/client";
import type { LotDTO, OpportunityDTO } from "@/lib/opportunity-dto";

export const opportunityInclude = {
  parcels: {
    orderBy: { sortOrder: "asc" },
    include: {
      parcel: { include: { snapshots: { orderBy: { retrievedAt: "desc" }, take: 1 } } },
      owner: true,
      activities: { orderBy: { activityDate: "desc" } },
    },
  },
  scenarios: true,
} satisfies Prisma.OpportunityInclude;

export type OpportunityWithRelations = Prisma.OpportunityGetPayload<{ include: typeof opportunityInclude }>;

export async function getGlobalAssumptions(): Promise<Assumptions> {
  const row = await prisma.globalAssumptions.findUnique({ where: { id: "global" } });
  return mergeAssumptions(row?.values ?? DEFAULT_ASSUMPTIONS);
}

export function lotLabel(p: { address: string | null; lot: string | null; section?: string | null; dp: string | null }): string {
  return p.address ? p.address.replace(/,\s*[^,]+$/, "") : lotDp(p);
}

export function toOpportunityLots(opp: OpportunityWithRelations): OpportunityLot[] {
  return opp.parcels.map((op) => ({
    id: op.id,
    label: lotLabel(op.parcel),
    areaSqm: op.parcel.areaSqm,
    zone: op.parcel.zone,
    zoneName: op.parcel.zoneName,
    fsr: op.parcel.fsr,
    heightM: op.parcel.heightM,
    minLotSizeSqm: op.parcel.minLotSizeSqm,
    heritage: op.parcel.heritage,
    isStrata: op.parcel.isStrata,
    planningKnown: op.parcel.planningCheckedAt != null,
    marketValue: op.marketValue ?? (op.landValuePerSqm ? op.landValuePerSqm * op.parcel.areaSqm : null),
    geometry: op.parcel.geometry as unknown as Polygon | MultiPolygon,
    included: op.included,
    maxAllocationOverride: op.maxAllocationOverride,
    openingOfferOverride: op.openingOfferOverride,
  }));
}

export function serializeOpportunity(opp: OpportunityWithRelations, globalAssumptions: Assumptions): OpportunityDTO {
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  return {
    id: opp.id,
    name: opp.name,
    status: opp.status,
    suburb: opp.suburb,
    lga: opp.lga,
    demoFinancialData: opp.demoFinancialData,
    notes: opp.notes,
    inputs: parseOpportunityInputs(opp.inputs),
    createdAt: opp.createdAt.toISOString(),
    updatedAt: opp.updatedAt.toISOString(),
    globalAssumptions,
    lots: opp.parcels.map((op) => {
      const p = op.parcel;
      const snap = p.snapshots[0];
      const snapData = (snap?.data ?? {}) as { sources?: LotDTO["planningSources"] };
      return {
        id: op.id,
        parcelId: p.id,
        externalParcelId: p.externalParcelId,
        source: p.source,
        lot: p.lot,
        section: p.section,
        dp: p.dp,
        address: p.address,
        label: lotLabel(p),
        suburb: p.suburb,
        geometry: p.geometry as unknown as LotDTO["geometry"],
        centroid: [p.centroidLng, p.centroidLat],
        areaSqm: p.areaSqm,
        isStrata: p.isStrata,
        zone: p.zone,
        zoneName: p.zoneName,
        fsr: p.fsr,
        heightM: p.heightM,
        minLotSizeSqm: p.minLotSizeSqm,
        heritage: p.heritage,
        planningInstrument: p.planningInstrument,
        lga: p.lga,
        planningCheckedAt: iso(p.planningCheckedAt),
        planningSnapshotSource: snap?.source ?? null,
        planningSources: snapData.sources ?? {},
        included: op.included,
        marketValue: op.marketValue,
        landValuePerSqm: op.landValuePerSqm,
        comparableValue: op.comparableValue,
        maxAllocationOverride: op.maxAllocationOverride,
        openingOfferOverride: op.openingOfferOverride,
        acquisitionStage: op.acquisitionStage,
        lastContactAt: iso(op.lastContactAt),
        nextAction: op.nextAction,
        nextActionDate: iso(op.nextActionDate),
        approachNotes: op.approachNotes,
        owner: op.owner
          ? { name: op.owner.name, ownerType: op.owner.ownerType, phone: op.owner.phone, email: op.owner.email, mailingAddress: op.owner.mailingAddress, notes: op.owner.notes }
          : null,
        activities: op.activities.map((a) => ({
          id: a.id,
          type: a.type,
          note: a.note,
          activityDate: a.activityDate.toISOString(),
          nextAction: a.nextAction,
          nextActionDate: iso(a.nextActionDate),
          stageFrom: a.stageFrom,
          stageTo: a.stageTo,
        })),
      };
    }),
  };
}

export async function loadOpportunity(id: string) {
  return prisma.opportunity.findUnique({ where: { id }, include: opportunityInclude });
}

/** Recalculate the opportunity and persist summary + per-lot computed fields (used by lists and the CRM board). */
export async function recomputeOpportunity(id: string) {
  const opp = await loadOpportunity(id);
  if (!opp) return null;
  const inputs = parseOpportunityInputs(opp.inputs);
  const a = mergeAssumptions(await getGlobalAssumptions(), inputs.overrides);
  const analysis = analyseOpportunity(toOpportunityLots(opp), a, inputs);
  const f = analysis.base.feasibility;
  const alloc = new Map(analysis.allocation.lots.map((l) => [l.id, l]));
  const crit = new Map(analysis.critical.map((c) => [c.id, c]));

  await prisma.$transaction([
    prisma.opportunity.update({
      where: { id },
      data: {
        score: analysis.score.score,
        scoreFactors: analysis.score as unknown as Prisma.InputJsonValue,
        totalSiteArea: analysis.site.siteAreaSqm,
        grv: f.grv,
        maxLandBudget: f.maxAcquisitionBudget,
        residualLandValue: f.residualLandValue,
        profit: f.profit,
        marginOnCost: f.marginOnCost,
        combinedMarketValue: analysis.combinedMarketValue,
      },
    }),
    ...opp.parcels.map((op) => {
      const al = alloc.get(op.id);
      const c = crit.get(op.id);
      return prisma.opportunityParcel.update({
        where: { id: op.id },
        data: {
          maximumOffer: al?.maximumOffer ?? null,
          openingOffer: al?.openingOffer ?? null,
          ownerPremium: al?.openingPremium ?? null,
          critical: c ? c.status === "CRITICAL" : null,
        },
      });
    }),
    ...(["BASE", "UPSIDE", "DOWNSIDE"] as const).map((k) => {
      const s = analysis.scenarios[k];
      const results = {
        grv: s.feasibility.grv,
        gfa: s.yield.gfa,
        dwellings: s.yield.dwellings,
        nonLandCosts: s.feasibility.nonLandCosts,
        residualLandValue: s.feasibility.residualLandValue,
        maxAcquisitionBudget: s.feasibility.maxAcquisitionBudget,
        profit: s.feasibility.profit,
        marginOnCost: s.feasibility.marginOnCost,
        marginOnRevenue: s.feasibility.marginOnRevenue,
      };
      return prisma.feasibilityScenario.upsert({
        where: { opportunityId_scenarioType: { opportunityId: id, scenarioType: k } },
        create: { opportunityId: id, scenarioType: k, name: k[0] + k.slice(1).toLowerCase(), assumptions: s.adjustment, results },
        update: { assumptions: s.adjustment, results },
      });
    }),
  ]);
  return analysis;
}

/** Store (or refresh) a parcel from NSW data plus a planning snapshot. Returns the Parcel id. */
export async function upsertParcel(tx: Prisma.TransactionClient, p: ParcelData): Promise<string> {
  const pl = p.planning;
  const checked = pl ? new Date(p.retrievedAt) : null;
  const data = {
    source: p.source,
    lot: p.lot,
    section: p.section,
    dp: p.dp,
    lotIdString: p.lotIdString,
    address: p.address,
    suburb: p.suburb,
    geometry: p.geometry as unknown as Prisma.InputJsonValue,
    centroidLng: p.centroid[0],
    centroidLat: p.centroid[1],
    areaSqm: p.areaSqm,
    isStrata: p.isStrata,
    ...(pl
      ? {
          zone: pl.zone,
          zoneName: pl.zoneName,
          fsr: pl.fsr,
          heightM: pl.heightM,
          minLotSizeSqm: pl.minLotSizeSqm,
          heritage: pl.heritage,
          planningInstrument: pl.planningInstrument,
          lga: pl.lga,
          planningCheckedAt: checked,
        }
      : {}),
  };
  const row = await tx.parcel.upsert({
    where: { externalParcelId: p.externalParcelId },
    create: { externalParcelId: p.externalParcelId, ...data },
    update: data,
  });
  if (pl) {
    await tx.planningSnapshot.create({
      data: { parcelId: row.id, source: p.source, data: { ...pl, planningStatus: p.planningStatus } as unknown as Prisma.InputJsonValue, retrievedAt: checked ?? new Date() },
    });
  }
  return row.id;
}

export async function createOpportunity(input: { name: string; parcels: ParcelData[]; userId?: string | null; demoFinancialData?: boolean; notes?: string; inputs?: unknown }) {
  const suburbs = input.parcels.map((p) => p.suburb).filter(Boolean) as string[];
  const suburb = suburbs.sort((a, b) => suburbs.filter((s) => s === b).length - suburbs.filter((s) => s === a).length)[0] ?? null;
  const opp = await prisma.$transaction(async (tx) => {
    const created = await tx.opportunity.create({
      data: {
        name: input.name,
        suburb,
        lga: input.parcels.find((p) => p.planning?.lga)?.planning?.lga ?? null,
        status: "ANALYSING",
        demoFinancialData: input.demoFinancialData ?? false,
        notes: input.notes,
        inputs: (input.inputs ?? {}) as Prisma.InputJsonValue,
        createdById: input.userId ?? null,
      },
    });
    let i = 0;
    for (const p of input.parcels) {
      const parcelId = await upsertParcel(tx, p);
      await tx.opportunityParcel.create({ data: { opportunityId: created.id, parcelId, sortOrder: i++ } });
    }
    return created;
  }, { timeout: 20000 });
  await recomputeOpportunity(opp.id);
  return opp;
}
