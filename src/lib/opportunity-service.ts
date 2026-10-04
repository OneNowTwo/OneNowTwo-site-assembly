import type { Polygon, MultiPolygon } from "geojson";
import { prisma } from "@/lib/db";
import type { ParcelData, FsrControl, FsrMappedStatus } from "@/lib/types";
import { mergeAssumptions, parseOpportunityInputs, DEFAULT_ASSUMPTIONS, type Assumptions } from "@/lib/analysis/assumptions";
import { analyseOpportunity, type OpportunityLot } from "@/lib/analysis/opportunity";
import { resolveAssemblyModelledControls } from "@/lib/analysis/resolve-assembly-controls";
import { fetchNominatedCentres } from "@/lib/data-sources/housing-sepp-lmr";
import { lotDp } from "@/lib/format";
import type { Prisma } from "@/generated/prisma/client";
import type { ComparableSaleDTO, LotDTO, OpportunityDTO, UnitTypeDTO } from "@/lib/opportunity-dto";
import { toParcelValuation, valueParcels } from "@/lib/data-sources/valuation-service";
import type { MarketValueSource } from "@/generated/prisma/client";

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
      ownerName: op.owner?.name ?? null,
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
export async function recomputeOpportunity(id: string, meta?: { reason?: string; source?: string }) {
  const opp = await loadOpportunity(id);
  if (!opp) return null;
  const before = {
    status: opp.status,
    score: opp.score,
    acquisitionHeadroom: opp.acquisitionHeadroom,
    maxLandBudget: opp.maxLandBudget,
    grv: opp.grv,
    combinedMarketValue: opp.combinedMarketValue,
  };
  const inputs = parseOpportunityInputs(opp.inputs);
  const hadPersistedMix = inputs.unitMix.length > 0 || opp.unitTypes.length > 0;
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
  // After FSR pathway refresh clears unit mix, persist the regenerated mix so Yield/Feasibility stay aligned.
  const shouldPersistRegeneratedMix = !hadPersistedMix && analysis.unitMix.length > 0;

  await prisma.$transaction([
    prisma.opportunity.update({
      where: { id },
      data: {
        ...(shouldPersistRegeneratedMix
          ? { inputs: { ...inputs, unitMix: analysis.unitMix } as unknown as Prisma.InputJsonValue }
          : {}),
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

  if (shouldPersistRegeneratedMix) {
    await syncUnitTypes(id, analysis.unitMix);
  }

  // Phase 2: append change-history + feed movements (never silently overwrite history).
  try {
    const { recordMetricChanges } = await import("@/lib/monitoring/change-history");
    const { publishFeedItem } = await import("@/lib/monitoring/feed");
    const after = {
      status: opp.status,
      score: analysis.score.score,
      acquisitionHeadroom: analysis.acquisitionHeadroom,
      maxLandBudget: f.maxAcquisitionBudget,
      grv: f.grv,
      combinedMarketValue: analysis.combinedExistingValue,
    };
    const deltas = await recordMetricChanges(id, before, after, meta);
    const headroomDelta = (after.acquisitionHeadroom ?? 0) - (before.acquisitionHeadroom ?? 0);
    const scoreDelta = (after.score ?? 0) - (before.score ?? 0);
    if (Math.abs(headroomDelta) >= 25_000 || Math.abs(scoreDelta) >= 2) {
      await publishFeedItem({
        kind: headroomDelta >= 0 && scoreDelta >= 0 ? "IMPROVED" : headroomDelta < 0 || scoreDelta < 0 ? "DECLINED" : "IMPROVED",
        title: `${opp.name} ${headroomDelta >= 0 ? "improved" : "declined"}`,
        summary: deltas.map((d) => d.title).slice(0, 3).join(" · ") || "Metrics recalculated",
        opportunityId: id,
        score: after.score,
        headroom: after.acquisitionHeadroom,
        maxPayable: after.maxLandBudget,
        scoreDelta,
        headroomDelta,
        importance: Math.min(12, Math.abs(headroomDelta) / 250_000 + Math.abs(scoreDelta)),
      });
    }
  } catch {
    // Monitoring must not break core recompute.
  }

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
    marketValueNote:
      v.note ??
      (source === "COMPARABLE_DERIVED"
        ? `COMPARABLE-DERIVED SCREENING ESTIMATE${v.numberOfComps ? ` · ${v.numberOfComps} NSW registered sales` : ""}`
        : source === "LIVE_AVM" && v.provider === "DOMAIN"
          ? "Domain Price Estimate"
          : null),
  };
}

/** Auto-value any parcels missing a trusted mid via NSW comps waterfall. */
export async function ensureParcelValuations(parcels: ParcelData[]): Promise<{ parcels: ParcelData[]; valued: number; messages: string[] }> {
  const need = parcels.filter((p) => !(p.valuation?.mid != null && p.valuation.mid > 0));
  if (!need.length) return { parcels, valued: 0, messages: [] };
  const batch = await valueParcels(need, { concurrency: 2, prefer: "auto" });
  const byId = new Map(batch.parcels.map((p) => [p.externalParcelId, p]));
  return {
    parcels: parcels.map((p) => byId.get(p.externalParcelId) ?? p),
    valued: batch.valued,
    messages: batch.messages,
  };
}

export async function createOpportunity(input: { name: string; parcels: ParcelData[]; userId?: string | null; demoFinancialData?: boolean; notes?: string; inputs?: unknown }) {
  // Always attempt automatic NSW comps when Analyse is created without values.
  const ensured = await ensureParcelValuations(input.parcels);
  const parcels = ensured.parcels;

  const suburbs = parcels.map((p) => p.suburb).filter(Boolean) as string[];
  const suburb = suburbs.sort((a, b) => suburbs.filter((s) => s === b).length - suburbs.filter((s) => s === a).length)[0] ?? null;
  const parsedInputs = parseOpportunityInputs(input.inputs ?? {});
  // Ensure parcel valuations (NSW comps) are stored for Analyse transparency.
  const lotValuationDetails = { ...parsedInputs.lotValuationDetails };
  for (const p of parcels) {
    if (!p.valuation) continue;
    lotValuationDetails[p.externalParcelId] = {
      mid: p.valuation.mid,
      low: p.valuation.low,
      high: p.valuation.high,
      confidence: p.valuation.confidence,
      source: p.valuation.source,
      provider: p.valuation.provider,
      numberOfComps: p.valuation.numberOfComps ?? null,
      valuationLabel: p.valuation.valuationLabel ?? null,
      subjectLastSale: p.valuation.subjectLastSale ?? null,
      comps: p.valuation.comps ?? undefined,
    };
  }
  const inputsWithVals = { ...parsedInputs, lotValuationDetails };
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
          inputs: inputsWithVals as unknown as Prisma.InputJsonValue,
          createdById: input.userId ?? null,
        },
      });
      let i = 0;
      for (const p of parcels) {
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
    { timeout: 60000 },
  );
  await ensureModelledPlanningOverride(opp.id);
  await recomputeOpportunity(opp.id, { reason: "opportunity created", source: "createOpportunity" });
  try {
    const { publishFeedItem } = await import("@/lib/monitoring/feed");
    const { recordOpportunityChange } = await import("@/lib/monitoring/change-history");
    const fresh = await prisma.opportunity.findUnique({ where: { id: opp.id } });
    await recordOpportunityChange({
      opportunityId: opp.id,
      kind: "OTHER",
      title: "Opportunity created",
      summary: `${opp.name} saved from Analyse`,
      after: { status: "ANALYSING", lotCount: parcels.length },
      source: "createOpportunity",
    });
    await publishFeedItem({
      kind: "NEW",
      title: `New opportunity: ${opp.name}`,
      summary: `${suburb ?? "NSW"} · ${parcels.length} lots`,
      opportunityId: opp.id,
      score: fresh?.score,
      headroom: fresh?.acquisitionHeadroom,
      maxPayable: fresh?.maxLandBudget,
      importance: 6,
    });
    if (input.userId) {
      const { evaluateAlertsForOpportunity } = await import("@/lib/monitoring/alerts");
      await evaluateAlertsForOpportunity(input.userId, {
        id: opp.id,
        name: opp.name,
        suburb,
        score: fresh?.score,
        acquisitionHeadroom: fresh?.acquisitionHeadroom,
        acquisitionHeadroomPercent: fresh?.acquisitionHeadroomPercent,
        lotCount: parcels.length,
        isNew: true,
      });
    }
  } catch {
    // feed/alerts optional
  }
  return opp;
}

function opportunityParcelsToData(opp: OpportunityWithRelations): ParcelData[] {
  return opp.parcels
    .filter((op) => op.included)
    .map((op) => {
      const p = op.parcel;
      const snap = p.snapshots[0]?.data as { fsrStatus?: FsrMappedStatus; fsrControls?: FsrControl[] } | undefined;
      return {
        externalParcelId: p.externalParcelId,
        source: p.source,
        lot: p.lot,
        section: p.section,
        dp: p.dp,
        lotIdString: p.lotIdString,
        address: p.address,
        suburb: p.suburb,
        geometry: p.geometry as unknown as ParcelData["geometry"],
        centroid: [p.centroidLng, p.centroidLat] as [number, number],
        areaSqm: p.areaSqm,
        isStrata: p.isStrata,
        planning: p.zone
          ? {
              zone: p.zone,
              zoneName: p.zoneName,
              fsr: p.fsr,
              fsrStatus: snap?.fsrStatus ?? (p.fsr != null ? "MAPPED" : "NO_MAPPED"),
              fsrControls: snap?.fsrControls ?? [],
              heightM: p.heightM,
              minLotSizeSqm: p.minLotSizeSqm,
              heritage: p.heritage,
              planningInstrument: p.planningInstrument,
              lga: p.lga,
              sources: {},
            }
          : null,
        planningStatus: p.zone ? "ok" : "unavailable",
        retrievedAt: (p.planningCheckedAt ?? p.updatedAt).toISOString(),
      };
    });
}

/**
 * When LEP FSR is unmapped, apply CURRENT State pathway modelled FSR (e.g. LMR)
 * as SCAN_MODELLED override — never invent a silent 0:1.
 *
 * Stale SCAN_MODELLED values (e.g. scan-time 1.5:1) are superseded when the planning
 * engine later resolves a different current modelled FSR (e.g. 2.2:1). USER overrides
 * remain authoritative. Clearing persisted unit mix forces full yield/feasibility recalc.
 */
export async function ensureModelledPlanningOverride(id: string): Promise<{ applied: boolean; modelledFsr: number | null; messages: string[] }> {
  const opp = await loadOpportunity(id);
  if (!opp) return { applied: false, modelledFsr: null, messages: ["Opportunity not found"] };
  const inputs = parseOpportunityInputs(opp.inputs);
  const parcels = opportunityParcelsToData(opp);
  if (!parcels.length) return { applied: false, modelledFsr: null, messages: ["No included parcels"] };

  const lngs = parcels.map((p) => p.centroid[0]);
  const lats = parcels.map((p) => p.centroid[1]);
  const pad = 0.02;
  const centres = await fetchNominatedCentres({
    west: Math.min(...lngs) - pad,
    south: Math.min(...lats) - pad,
    east: Math.max(...lngs) + pad,
    north: Math.max(...lats) + pad,
  }).catch(() => []);
  const modelled = resolveAssemblyModelledControls(parcels, centres);

  // Manual USER FSR stays authoritative — only backfill pathway snapshot for display.
  if (inputs.fsrOverrideKind === "USER" && inputs.fsrOverride != null) {
    if (!inputs.pathwaySnapshot && modelled.usedStatePathway) {
      await prisma.opportunity.update({
        where: { id },
        data: {
          inputs: {
            ...inputs,
            pathwaySnapshot: {
              lepFsr: modelled.lepFsr,
              statePathwayFsr: modelled.statePathwayFsr,
              statePathwayName: modelled.statePathwayName,
              modelledFsr: modelled.modelledFsr,
              certainty: modelled.certainty,
              lmrCentre: modelled.lmrCentre,
              nearestDistanceM: modelled.nearestDistanceM,
              furthestDistanceM: modelled.furthestDistanceM,
              proximityScreen: modelled.proximityScreen,
              proximityLabel: modelled.proximityLabel,
            },
          } as unknown as Prisma.InputJsonValue,
        },
      });
      return { applied: true, modelledFsr: inputs.fsrOverride, messages: ["Backfilled pathway snapshot; USER FSR left unchanged"] };
    }
    return { applied: false, modelledFsr: inputs.fsrOverride, messages: ["USER FSR override left authoritative"] };
  }

  const needsPathway = parcels.some((p) => p.planning?.fsr == null);
  if (!needsPathway) {
    return { applied: false, modelledFsr: inputs.fsrOverride, messages: ["LEP FSR already mapped on included lots"] };
  }

  if (modelled.modelledFsr == null || modelled.modelledFsr <= 0) {
    return {
      applied: false,
      modelledFsr: null,
      messages: [
        "NO MAPPED LEP FSR and no usable State pathway FSR resolved — feasibility stays REQUIRES PLANNING INPUT (not FSR 0:1).",
        ...modelled.notes.slice(0, 3),
      ],
    };
  }

  if (!modelled.usedStatePathway || modelled.proximityScreen !== "PASS") {
    return {
      applied: false,
      modelledFsr: null,
      messages: [
        modelled.proximityScreen === "FAIL" || modelled.proximityScreen === "MIXED"
          ? "LMR proximity screen did not PASS for all lots — State LMR FSR not applied to modelled yield."
          : "NO MAPPED LEP FSR and no usable State pathway FSR resolved — feasibility stays REQUIRES PLANNING INPUT (not FSR 0:1).",
        ...modelled.notes.slice(0, 3),
      ],
    };
  }

  const current = inputs.fsrOverride;
  const fsrChanged =
    current == null ||
    inputs.fsrOverrideKind !== "SCAN_MODELLED" ||
    Math.abs(current - modelled.modelledFsr) > 0.0005;
  const heightChanged =
    modelled.modelledHeightM != null &&
    (inputs.heightOverrideM == null || Math.abs(inputs.heightOverrideM - modelled.modelledHeightM) > 0.05);
  const snap = inputs.pathwaySnapshot;
  const snapshotStale =
    !snap ||
    snap.modelledFsr !== modelled.modelledFsr ||
    snap.statePathwayFsr !== modelled.statePathwayFsr ||
    snap.proximityScreen !== modelled.proximityScreen ||
    snap.nearestDistanceM !== modelled.nearestDistanceM;

  if (!fsrChanged && !heightChanged && !snapshotStale) {
    return { applied: false, modelledFsr: modelled.modelledFsr, messages: ["Current modelled pathway FSR already applied"] };
  }

  const originalScanFsr =
    inputs.originalScanFsr ??
    (inputs.fsrOverrideKind === "SCAN_MODELLED" && current != null && fsrChanged ? current : null);
  const recalculated = fsrChanged && current != null && inputs.fsrOverrideKind === "SCAN_MODELLED";

  const next = {
    ...inputs,
    fsrOverride: modelled.modelledFsr,
    fsrOverrideKind: "SCAN_MODELLED" as const,
    fsrOverrideCertainty: modelled.certainty,
    heightOverrideM: modelled.modelledHeightM ?? inputs.heightOverrideM,
    originalScanFsr,
    fsrRecalculationStatus: recalculated
      ? "RECALCULATED_FROM_UPDATED_PLANNING_PATHWAY"
      : inputs.fsrRecalculationStatus,
    // Drop stale mix so dwellings / GRV rebuild from the new saleable area.
    ...(fsrChanged ? { unitMix: [] } : {}),
    pathwaySnapshot: {
      lepFsr: modelled.lepFsr,
      statePathwayFsr: modelled.statePathwayFsr,
      statePathwayName: modelled.statePathwayName,
      modelledFsr: modelled.modelledFsr,
      certainty: modelled.certainty,
      lmrCentre: modelled.lmrCentre,
      nearestDistanceM: modelled.nearestDistanceM,
      furthestDistanceM: modelled.furthestDistanceM,
      proximityScreen: modelled.proximityScreen,
      proximityLabel: modelled.proximityLabel,
    },
  };

  if (fsrChanged) {
    await prisma.unitType.deleteMany({ where: { opportunityId: id } });
  }

  await prisma.opportunity.update({
    where: { id },
    data: { inputs: next as unknown as Prisma.InputJsonValue },
  });

  const messages: string[] = [];
  if (recalculated) {
    messages.push(
      `RECALCULATED FROM UPDATED PLANNING PATHWAY — original scan FSR ${originalScanFsr}:1 superseded by current modelled FSR ${modelled.modelledFsr}:1` +
        (modelled.lmrCentre ? ` near ${modelled.lmrCentre}` : "") +
        ` · ${modelled.proximityLabel ?? "PASS — ESTIMATED"}.`,
    );
  } else if (fsrChanged) {
    messages.push(
      `Applied CURRENT State pathway modelled FSR ${modelled.modelledFsr}:1` +
        (modelled.lmrCentre ? ` near ${modelled.lmrCentre}` : "") +
        ` · 800 m proximity ${modelled.proximityLabel ?? "PASS — ESTIMATED"}` +
        ` (${modelled.certainty.replaceAll("_", " ")}). NOT a silent LEP invent.`,
    );
  } else {
    messages.push("Refreshed LEP vs State pathway snapshot for display");
  }
  messages.push(...modelled.notes.slice(0, 4));

  return { applied: true, modelledFsr: modelled.modelledFsr, messages };
}

/**
 * Re-run NSW comps (or other waterfall) for lots missing market values on a saved opportunity.
 * Used when Analyse was opened before comps landed, or user clicks Auto-value.
 */
export async function autoValueOpportunity(id: string): Promise<{ valued: number; messages: string[] }> {
  const opp = await loadOpportunity(id);
  if (!opp) throw new Error("Opportunity not found");
  const missing = opp.parcels.filter((op) => !(op.marketValue != null && op.marketValue > 0) && op.included);
  if (!missing.length) return { valued: 0, messages: ["All included lots already have values"] };

  const asParcels: ParcelData[] = missing.map((op) => {
    const p = op.parcel;
    const snap = p.snapshots[0]?.data as { fsrStatus?: FsrMappedStatus; fsrControls?: FsrControl[] } | undefined;
    return {
      externalParcelId: p.externalParcelId,
      source: p.source,
      lot: p.lot,
      section: p.section,
      dp: p.dp,
      lotIdString: p.lotIdString,
      address: p.address,
      suburb: p.suburb,
      geometry: p.geometry as unknown as ParcelData["geometry"],
      centroid: [p.centroidLng, p.centroidLat],
      areaSqm: p.areaSqm,
      isStrata: p.isStrata,
      planning: p.zone
        ? {
            zone: p.zone,
            zoneName: p.zoneName,
            fsr: p.fsr,
            fsrStatus: snap?.fsrStatus ?? (p.fsr != null ? "MAPPED" : "NO_MAPPED"),
            fsrControls: snap?.fsrControls ?? [],
            heightM: p.heightM,
            minLotSizeSqm: p.minLotSizeSqm,
            heritage: p.heritage,
            planningInstrument: p.planningInstrument,
            lga: p.lga,
            sources: {},
          }
        : null,
      planningStatus: p.zone ? "ok" : "unavailable",
      retrievedAt: (p.planningCheckedAt ?? p.updatedAt).toISOString(),
    };
  });

  const batch = await valueParcels(asParcels, { concurrency: 2 });
  const inputs = parseOpportunityInputs(opp.inputs);
  const lotValuationDetails = { ...inputs.lotValuationDetails };

  for (const valued of batch.parcels) {
    const op = missing.find((m) => m.parcel.externalParcelId === valued.externalParcelId);
    if (!op || !valued.valuation?.mid) continue;
    const v = toParcelValuation(valued.valuation as never);
    const source = (v.source === "COMPARABLE_DERIVED" || v.status === "COMPARABLE_DERIVED"
      ? "COMPARABLE_DERIVED"
      : v.source === "LIVE_AVM" || v.status === "LIVE_AVM"
        ? "LIVE_AVM"
        : "USER_ESTIMATE") as MarketValueSource;
    await prisma.opportunityParcel.update({
      where: { id: op.id },
      data: {
        marketValue: v.mid,
        marketValueLow: v.low,
        marketValueHigh: v.high,
        marketValueSource: source,
        marketValueConfidence: v.confidence,
        marketValueProvider: v.provider,
        marketValueMethod: v.method,
        marketValueCheckedAt: v.checkedAt ? new Date(v.checkedAt) : new Date(),
        marketValueNote: v.note,
      },
    });
    lotValuationDetails[valued.externalParcelId] = {
      mid: v.mid,
      low: v.low,
      high: v.high,
      confidence: v.confidence,
      source: v.source,
      provider: v.provider,
      numberOfComps: v.numberOfComps ?? null,
      valuationLabel: v.valuationLabel ?? null,
      subjectLastSale: v.subjectLastSale ?? null,
      comps: v.comps ?? undefined,
    };
  }

  await prisma.opportunity.update({
    where: { id },
    data: { inputs: { ...inputs, lotValuationDetails } as unknown as Prisma.InputJsonValue },
  });
  const planning = await ensureModelledPlanningOverride(id);
  await recomputeOpportunity(id);
  return { valued: batch.valued, messages: [...batch.messages, ...planning.messages] };
}
