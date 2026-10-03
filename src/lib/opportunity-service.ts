import type { Polygon, MultiPolygon } from "geojson";
import { prisma } from "@/lib/db";
import type { ParcelData, FsrControl, FsrMappedStatus } from "@/lib/types";
import { mergeAssumptions, parseOpportunityInputs, DEFAULT_ASSUMPTIONS, type Assumptions } from "@/lib/analysis/assumptions";
import { analyseOpportunity, type OpportunityLot } from "@/lib/analysis/opportunity";
import { lotDp } from "@/lib/format";
import type { Prisma } from "@/generated/prisma/client";
import type { ComparableSaleDTO, LotDTO, OpportunityDTO, UnitTypeDTO } from "@/lib/opportunity-dto";

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
  comparableSales: { orderBy: { createdAt: "asc" } },
  unitTypes: { orderBy: { sortOrder: "asc" } },
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
  return opp.parcels.map((op) => {
    const snap = op.parcel.snapshots[0];
    const snapData = (snap?.data ?? {}) as { fsrStatus?: FsrMappedStatus; fsrControls?: FsrControl[] };
    return {
      id: op.id,
      label: lotLabel(op.parcel),
      areaSqm: op.parcel.areaSqm,
      zone: op.parcel.zone,
      zoneName: op.parcel.zoneName,
      fsr: op.parcel.fsr,
      fsrStatus: snapData.fsrStatus ?? (op.parcel.fsr != null ? "MAPPED" : op.parcel.planningCheckedAt ? "NO_MAPPED" : null),
      fsrControls: snapData.fsrControls ?? [],
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
      strategicWeight: op.strategicWeight,
    };
  });
}

function serializeComp(c: OpportunityWithRelations["comparableSales"][number]): ComparableSaleDTO {
  return {
    id: c.id,
    type: c.type,
    parcelId: c.parcelId,
    address: c.address,
    salePrice: c.salePrice,
    saleDate: c.saleDate?.toISOString() ?? null,
    propertyType: c.propertyType,
    bedrooms: c.bedrooms,
    bathrooms: c.bathrooms,
    parking: c.parking,
    landArea: c.landArea,
    internalArea: c.internalArea,
    externalArea: c.externalArea,
    saleableArea: c.saleableArea,
    pricePerSqm: c.pricePerSqm,
    newBuildStatus: c.newBuildStatus,
    unitType: c.unitType,
    source: c.source,
    sourceReference: c.sourceReference,
    included: c.included,
    notes: c.notes,
    distanceM: c.distanceM,
    dataDate: c.dataDate?.toISOString() ?? null,
  };
}

function serializeUnit(u: OpportunityWithRelations["unitTypes"][number]): UnitTypeDTO {
  return {
    id: u.id,
    name: u.name,
    sortOrder: u.sortOrder,
    count: u.count,
    avgInternalArea: u.avgInternalArea,
    avgExternalArea: u.avgExternalArea,
    avgSaleableArea: u.avgSaleableArea,
    salePricePerUnit: u.salePricePerUnit,
    pricePerSqm: u.pricePerSqm,
    revenue: u.revenue,
  };
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
    acquisitionHeadroom: opp.acquisitionHeadroom,
    acquisitionHeadroomPercent: opp.acquisitionHeadroomPercent,
    assemblyUplift: opp.assemblyUplift,
    theoreticalGfa: opp.theoreticalGfa,
    achievableGfa: opp.achievableGfa,
    saleableArea: opp.saleableArea,
    unitCount: opp.unitCount,
    totalNonLandCost: opp.totalNonLandCost,
    targetMoc: opp.targetMoc,
    comparableSales: opp.comparableSales.map(serializeComp),
    unitTypes: opp.unitTypes.map(serializeUnit),
    lots: opp.parcels.map((op) => {
      const p = op.parcel;
      const snap = p.snapshots[0];
      const snapData = (snap?.data ?? {}) as {
        sources?: LotDTO["planningSources"];
        fsrStatus?: FsrMappedStatus;
        fsrControls?: FsrControl[];
      };
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
        fsrStatus: snapData.fsrStatus ?? (p.fsr != null ? "MAPPED" : p.planningCheckedAt ? "NO_MAPPED" : null),
        fsrControls: snapData.fsrControls ?? [],
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
        marketValueLow: op.marketValueLow,
        marketValueHigh: op.marketValueHigh,
        marketValueSource: op.marketValueSource,
        marketValueConfidence: op.marketValueConfidence,
        marketValueProvider: op.marketValueProvider,
        marketValueMethod: op.marketValueMethod,
        marketValueCheckedAt: iso(op.marketValueCheckedAt),
        marketValueNote: op.marketValueNote,
        landValuePerSqm: op.landValuePerSqm,
        comparableValue: op.comparableValue,
        maxAllocationOverride: op.maxAllocationOverride,
        openingOfferOverride: op.openingOfferOverride,
        strategicWeight: op.strategicWeight,
        negotiationHeadroom: op.negotiationHeadroom,
        ownerPremiumAmount: op.ownerPremiumAmount,
        ownerPremiumPercent: op.ownerPremiumPercent,
        criticalityScore: op.criticalityScore,
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
  // Prefer persisted unitTypes when inputs.unitMix is empty
  if (!inputs.unitMix.length && opp.unitTypes.length) {
    inputs.unitMix = opp.unitTypes.map((u) => ({
      id: u.id,
      name: u.name,
      count: u.count,
      avgInternalArea: u.avgInternalArea,
      avgExternalArea: u.avgExternalArea,
      avgSaleableArea: u.avgSaleableArea,
      salePricePerUnit: u.salePricePerUnit,
    }));
  }
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
        combinedMarketValue: analysis.combinedExistingValue,
        acquisitionHeadroom: analysis.acquisitionHeadroom,
        acquisitionHeadroomPercent: analysis.acquisitionHeadroomPercent,
        assemblyUplift: analysis.assemblyUplift,
        theoreticalGfa: analysis.base.yield.theoreticalGfa,
        achievableGfa: analysis.base.yield.achievableGfa,
        saleableArea: analysis.base.yield.saleableArea,
        unitCount: analysis.base.yield.dwellings,
        totalNonLandCost: f.nonLandCosts,
        targetMoc: a.targetMarginOnCost,
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
          negotiationHeadroom: al?.negotiationHeadroom ?? null,
          ownerPremiumAmount: al?.ownerPremiumAmount ?? null,
          ownerPremiumPercent: al?.ownerPremiumPercent ?? null,
          ownerPremium: al?.openingPremium ?? null,
          criticalityScore: c ? (c.status === "CRITICAL" ? 1 : 0.2) + (c.connector ? 0.3 : 0) : null,
          critical: c ? c.status === "CRITICAL" : null,
        },
      });
    }),
    ...(["BASE", "UPSIDE", "DOWNSIDE"] as const).map((k) => {
      const s = analysis.scenarios[k];
      const results = {
        grv: s.feasibility.grv,
        gfa: s.yield.achievableGfa,
        theoreticalGfa: s.yield.theoreticalGfa,
        dwellings: s.yield.dwellings,
        nonLandCosts: s.feasibility.nonLandCosts,
        residualLandValue: s.feasibility.residualLandValue,
        maxAcquisitionBudget: s.feasibility.maxAcquisitionBudget,
        maxPayableToOwners: s.maxPayableToOwners,
        combinedExistingValue: s.combinedExistingValue,
        acquisitionHeadroom: s.acquisitionHeadroom,
        acquisitionHeadroomPercent: s.acquisitionHeadroomPercent,
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

/** Persist unit mix rows from opportunity inputs into UnitType table. */
export async function syncUnitTypes(opportunityId: string, rows: { name: string; count: number; avgInternalArea: number; avgExternalArea: number; avgSaleableArea: number; salePricePerUnit: number }[]) {
  await prisma.$transaction([
    prisma.unitType.deleteMany({ where: { opportunityId } }),
    ...rows.map((r, i) => {
      const saleable = r.avgSaleableArea || r.avgInternalArea + r.avgExternalArea;
      const revenue = r.count * r.salePricePerUnit;
      return prisma.unitType.create({
        data: {
          opportunityId,
          name: r.name,
          sortOrder: i,
          count: r.count,
          avgInternalArea: r.avgInternalArea,
          avgExternalArea: r.avgExternalArea,
          avgSaleableArea: saleable,
          salePricePerUnit: r.salePricePerUnit,
          pricePerSqm: saleable > 0 ? r.salePricePerUnit / saleable : null,
          revenue,
        },
      });
    }),
  ]);
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

function marketValueFieldsFromParcel(p: ParcelData): {
  marketValue: number | null;
  marketValueLow: number | null;
  marketValueHigh: number | null;
  marketValueSource: "LIVE_AVM" | "COMPARABLE_DERIVED" | "USER_ESTIMATE" | "NO_VALUE" | null;
  marketValueConfidence: string | null;
  marketValueProvider: string | null;
  marketValueMethod: string | null;
  marketValueCheckedAt: Date | null;
  marketValueNote: string | null;
} {
  const v = p.valuation;
  if (!v || v.mid == null || !(v.mid > 0)) {
    return {
      marketValue: null,
      marketValueLow: null,
      marketValueHigh: null,
      marketValueSource: null,
      marketValueConfidence: null,
      marketValueProvider: null,
      marketValueMethod: null,
      marketValueCheckedAt: null,
      marketValueNote: null,
    };
  }
  const source =
    v.source === "LIVE_AVM" || v.status === "LIVE_AVM"
      ? "LIVE_AVM"
      : v.source === "COMPARABLE_DERIVED" || v.status === "COMPARABLE_DERIVED"
        ? "COMPARABLE_DERIVED"
        : v.source === "USER_ESTIMATE" || v.status === "USER_ESTIMATE"
          ? "USER_ESTIMATE"
          : "LIVE_AVM";
  return {
    marketValue: v.mid,
    marketValueLow: v.low,
    marketValueHigh: v.high,
    marketValueSource: source,
    marketValueConfidence: v.confidence ?? null,
    marketValueProvider: v.provider ?? null,
    marketValueMethod: v.method ?? null,
    marketValueCheckedAt: v.checkedAt ? new Date(v.checkedAt) : new Date(),
    marketValueNote: v.note ?? (source === "LIVE_AVM" && v.provider === "DOMAIN" ? "Domain Price Estimate" : null),
  };
}

export async function createOpportunity(input: { name: string; parcels: ParcelData[]; userId?: string | null; demoFinancialData?: boolean; notes?: string; inputs?: unknown }) {
  const suburbs = input.parcels.map((p) => p.suburb).filter(Boolean) as string[];
  const suburb = suburbs.sort((a, b) => suburbs.filter((s) => s === b).length - suburbs.filter((s) => s === a).length)[0] ?? null;
  const parsedInputs = parseOpportunityInputs(input.inputs ?? {});
  const opp = await prisma.$transaction(
    async (tx) => {
      const created = await tx.opportunity.create({
        data: {
          name: input.name,
          suburb,
          lga: input.parcels.find((p) => p.planning?.lga)?.planning?.lga ?? null,
          status: "ANALYSING",
          demoFinancialData: input.demoFinancialData ?? false,
          notes: input.notes,
          inputs: parsedInputs as unknown as Prisma.InputJsonValue,
          createdById: input.userId ?? null,
        },
      });
      let i = 0;
      for (const p of input.parcels) {
        const parcelId = await upsertParcel(tx, p);
        const mv = marketValueFieldsFromParcel(p);
        await tx.opportunityParcel.create({
          data: {
            opportunityId: created.id,
            parcelId,
            sortOrder: i++,
            ...mv,
          },
        });
      }
      return created;
    },
    { timeout: 20000 },
  );
  await recomputeOpportunity(opp.id);
  return opp;
}
