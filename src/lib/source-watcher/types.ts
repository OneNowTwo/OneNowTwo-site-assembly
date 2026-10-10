/**
 * Source Watcher — development intelligence types.
 * Proposed / pending facts never silently become current LEP law.
 */

export type SourceTransport = "API" | "ARCGIS" | "WFS" | "JSON" | "HTML" | "PDF" | "RSS" | "FIXTURE" | "OTHER";

export type SourceCategory =
  | "CURRENT_CONTROLS"
  | "PLANNING_PROPOSAL"
  | "STATE_LED_REZONING"
  | "COUNCIL_STRATEGIC"
  | "KEY_SITE"
  | "HDA"
  | "MAJOR_PROJECTS"
  | "DA_CDC_PCC"
  | "DCP"
  | "COUNCIL_AGENDA"
  | "ENVIRONMENT"
  | "TRANSPORT"
  | "PROPERTY_SALES"
  | "OTHER";

export type IntelChangeKind =
  | "PLANNING_PROPOSAL_CREATED"
  | "PLANNING_STATUS_CHANGED"
  | "ZONE_PROPOSED_CHANGE"
  | "FSR_PROPOSED_CHANGE"
  | "HEIGHT_PROPOSED_CHANGE"
  | "KEY_SITE_CREATED"
  | "KEY_SITE_CHANGED"
  | "ASSEMBLY_REQUIREMENT_CHANGED"
  | "AFFORDABLE_HOUSING_RATE_CHANGED"
  | "DCP_CHANGED"
  | "HDA_RECORD_PUBLISHED"
  | "HDA_RECOMMENDATION_CHANGED"
  | "SSD_DECLARED"
  | "SSD_STATUS_CHANGED"
  | "DA_LODGED"
  | "DA_APPROVED"
  | "PCC_ISSUED"
  | "COUNCIL_RESOLUTION"
  | "ENVIRONMENTAL_LAYER_CHANGED"
  | "SOURCE_REFRESHED"
  | "SOURCE_DOCUMENT_CHANGED"
  | "OTHER";

export interface SourceDefinition {
  id: string;
  name: string;
  authority: string;
  category: SourceCategory;
  jurisdiction?: string;
  sourceType: SourceTransport;
  pollFrequency: string;
  parserVersion?: string;
  licence?: string;
  config?: Record<string, unknown>;
  enabled?: boolean;
}

export interface BBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface ProposedControls {
  legalStatus: "PROPOSED" | "UNDER_EXHIBITION" | "GATEWAY" | "CURRENT_LAW";
  zone?: string | null;
  fsr?: number | null;
  incentiveFsr?: number | null;
  heightM?: number | null;
  incentiveHeightM?: number | null;
  nonResidentialFsr?: number | null;
  affordableHousingContributionPct?: number | null;
  activeStreetFrontage?: boolean | null;
  storeys?: number | null;
  notes?: string | null;
  machineReadable?: boolean;
}

export type GeometrySource =
  | "OFFICIAL_FEATURE_SERVICE"
  | "OFFICIAL_GEOJSON"
  | "OFFICIAL_MAP_DERIVED"
  | "MANUALLY_STRUCTURED_FIXTURE";

export type KeySiteConditionType =
  | "AFFORDABLE_HOUSING"
  | "COMMUNITY_FACILITY"
  | "THROUGH_SITE_LINK"
  | "PUBLIC_VEHICLE_ACCESS"
  | "ROAD_WIDENING"
  | "DRAINAGE_CORRIDOR"
  | "OPEN_SPACE"
  | "ACTIVE_STREET_FRONTAGE"
  | "NON_RESIDENTIAL_FSR"
  | "OTHER";

export interface KeySiteCondition {
  type: KeySiteConditionType;
  value?: string | null;
  description?: string | null;
}

export interface KeySiteFact {
  externalKeySiteId: string;
  name: string;
  bbox?: BBox | null;
  geometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  geometrySource?: GeometrySource | null;
  requiredParcelHints?: string[];
  /** Resolved cadastral externalParcelIds when linked. */
  requiredParcelIds?: string[];
  optionalParcelHints?: string[];
  currentControls?: ProposedControls | null;
  proposedControls?: ProposedControls | null;
  incentiveControls?: ProposedControls | null;
  requirements?: string[];
  /** Legacy string conditions — prefer structuredConditions. */
  conditions?: string[];
  structuredConditions?: KeySiteCondition[];
}

export interface PlanningChangeAreaFact {
  id: string;
  title: string;
  status: string;
  authority?: string | null;
  lgas?: string[];
  suburbs?: string[];
  sourceUrl?: string | null;
  exhibitionEnd?: string | null;
  bbox?: BBox | null;
  geometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  proposedControls: ProposedControls;
  keySites?: KeySiteFact[];
}

export interface NormalisedSourcePayload {
  kind: string;
  checkedAt: string;
  planningChangeAreas?: PlanningChangeAreaFact[];
  keySites?: KeySiteFact[];
  records?: Array<Record<string, unknown>>;
  meta?: Record<string, unknown>;
}

export interface FetchResult {
  raw: unknown;
  normalised: NormalisedSourcePayload;
  sourceModifiedAt?: string | null;
  etag?: string | null;
}

export interface SourceAdapter {
  readonly id: string;
  fetch(): Promise<FetchResult>;
}

export interface DiffEvent {
  kind: IntelChangeKind;
  title: string;
  summary: string;
  changeKey: string;
  oldValue?: unknown;
  newValue?: unknown;
  geometry?: unknown;
  affectedParcelHints?: string[];
  importance?: number;
  href?: string;
  payload?: unknown;
}

export interface KeySiteHit {
  planningChangeAreaId: string;
  planningChangeAreaTitle: string;
  status: string;
  legalStatus: string;
  keySite: KeySiteFact;
  yourPropertyIndex: number | null;
  requiredCount: number;
  requiredParcelIds?: string[];
  requiredAddresses?: string[];
}

/** Queryable Find / scanner fields for proposed planning (Phase 2 minimal). */
export interface ProposedPlanningFindFields {
  insidePlanningChangeArea: boolean;
  planningChangeStatus: string | null;
  proposedZone: string | null;
  proposedFsr: number | null;
  proposedHeight: number | null;
  keySiteId: string | null;
  requiredParcelCount: number | null;
}
