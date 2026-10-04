import type { Polygon, MultiPolygon } from "geojson";
import type { Assumptions, OpportunityInputs } from "@/lib/analysis/assumptions";
import type { OpportunityLot } from "@/lib/analysis/opportunity";
import type { AcquisitionStageValue, OpportunityStatusValue } from "@/lib/constants";
import type { DataOrigin, FieldSource, FsrControl, FsrMappedStatus } from "@/lib/types";

export interface OwnerDTO {
  name: string | null;
  ownerType: string | null;
  phone: string | null;
  email: string | null;
  mailingAddress: string | null;
  notes: string | null;
}

export interface ActivityDTO {
  id: string;
  type: string;
  note: string | null;
  activityDate: string;
  nextAction: string | null;
  nextActionDate: string | null;
  stageFrom: AcquisitionStageValue | null;
  stageTo: AcquisitionStageValue | null;
}

export interface ComparableSaleDTO {
  id: string;
  type: "ACQUISITION" | "EXIT";
  parcelId: string | null;
  address: string;
  salePrice: number;
  saleDate: string | null;
  propertyType: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  parking: number | null;
  landArea: number | null;
  internalArea: number | null;
  externalArea: number | null;
  saleableArea: number | null;
  pricePerSqm: number | null;
  newBuildStatus: string | null;
  unitType: string | null;
  source: string;
  sourceReference: string | null;
  included: boolean;
  notes: string | null;
  distanceM: number | null;
  dataDate: string | null;
}

export interface UnitTypeDTO {
  id: string;
  name: string;
  sortOrder: number;
  count: number;
  avgInternalArea: number;
  avgExternalArea: number;
  avgSaleableArea: number;
  salePricePerUnit: number;
  pricePerSqm: number | null;
  revenue: number | null;
}

export interface LotDTO {
  id: string;
  parcelId: string;
  externalParcelId: string;
  source: DataOrigin;
  lot: string | null;
  section: string | null;
  dp: string | null;
  address: string | null;
  label: string;
  suburb: string | null;
  geometry: Polygon | MultiPolygon;
  centroid: [number, number];
  areaSqm: number;
  isStrata: boolean;
  zone: string | null;
  zoneName: string | null;
  fsr: number | null;
  fsrStatus: FsrMappedStatus | null;
  fsrControls: FsrControl[];
  heightM: number | null;
  minLotSizeSqm: number | null;
  heritage: string | null;
  planningInstrument: string | null;
  lga: string | null;
  planningCheckedAt: string | null;
  planningSnapshotSource: DataOrigin | null;
  planningSources: Partial<Record<string, FieldSource>>;
  included: boolean;
  marketValue: number | null;
  marketValueLow: number | null;
  marketValueHigh: number | null;
  marketValueSource: "USER_ESTIMATE" | "COMPARABLE_DERIVED" | "LIVE_PROVIDER" | "LIVE_AVM" | "SYSTEM_ESTIMATE" | "SUBURB_FALLBACK" | "DEMO" | "NO_VALUE" | null;
  marketValueConfidence: string | null;
  marketValueProvider: string | null;
  marketValueMethod: string | null;
  marketValueCheckedAt: string | null;
  marketValueNote: string | null;
  landValuePerSqm: number | null;
  comparableValue: number | null;
  maxAllocationOverride: number | null;
  openingOfferOverride: number | null;
  strategicWeight: number | null;
  negotiationHeadroom: number | null;
  ownerPremiumAmount: number | null;
  ownerPremiumPercent: number | null;
  criticalityScore: number | null;
  acquisitionStage: AcquisitionStageValue;
  lastContactAt: string | null;
  nextAction: string | null;
  nextActionDate: string | null;
  approachNotes: string | null;
  owner: OwnerDTO | null;
  activities: ActivityDTO[];
}

export interface OpportunityDTO {
  id: string;
  name: string;
  status: OpportunityStatusValue;
  suburb: string | null;
  lga: string | null;
  demoFinancialData: boolean;
  notes: string | null;
  inputs: OpportunityInputs;
  createdAt: string;
  updatedAt: string;
  globalAssumptions: Assumptions;
  acquisitionHeadroom: number | null;
  acquisitionHeadroomPercent: number | null;
  assemblyUplift: number | null;
  theoreticalGfa: number | null;
  achievableGfa: number | null;
  saleableArea: number | null;
  unitCount: number | null;
  totalNonLandCost: number | null;
  targetMoc: number | null;
  comparableSales: ComparableSaleDTO[];
  unitTypes: UnitTypeDTO[];
  lots: LotDTO[];
}

export function dtoToLots(dto: OpportunityDTO): OpportunityLot[] {
  return dto.lots.map((l) => ({
    id: l.id,
    label: l.label,
    areaSqm: l.areaSqm,
    zone: l.zone,
    zoneName: l.zoneName,
    fsr: l.fsr,
    fsrStatus: l.fsrStatus,
    fsrControls: l.fsrControls,
    heightM: l.heightM,
    minLotSizeSqm: l.minLotSizeSqm,
    heritage: l.heritage,
    isStrata: l.isStrata,
    planningKnown: l.planningCheckedAt != null,
    marketValue: l.marketValue,
    marketValueLow: l.marketValueLow,
    marketValueHigh: l.marketValueHigh,
    marketValueSource: l.marketValueSource,
    marketValueConfidence: l.marketValueConfidence,
    marketValueProvider: l.marketValueProvider,
    marketValueMethod: l.marketValueMethod,
    marketValueCheckedAt: l.marketValueCheckedAt,
    geometry: l.geometry,
    included: l.included,
    maxAllocationOverride: l.maxAllocationOverride,
    openingOfferOverride: l.openingOfferOverride,
    strategicWeight: l.strategicWeight,
    ownerName: l.owner?.name ?? null,
  }));
}
