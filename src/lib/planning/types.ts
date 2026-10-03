/** Versioned planning-policy statuses — never confuse CURRENT with PROPOSED. */
export type PlanningRuleStatus =
  | "CURRENT"
  | "PROPOSED"
  | "EXHIBITED"
  | "GATEWAY"
  | "APPROVED_NOT_COMMENCED"
  | "SUPERSEDED"
  | "WITHDRAWN";

export type PlanningLayerKind = "CURRENT_STATUTORY" | "CURRENT_PATHWAY" | "PROPOSED_CHANGE";

export interface PlanningRuleMeta {
  id: string;
  status: PlanningRuleStatus;
  instrumentName: string;
  instrumentVersion?: string | null;
  planningProposalNumber?: string | null;
  authority: string;
  sourceUrl: string;
  sourceAuthority: string;
  effectiveDate?: string | null;
  announcementDate?: string | null;
  exhibitionEndDate?: string | null;
  lastChecked: string;
  clauseRef?: string | null;
}

export interface ProposedControls {
  zone?: string | null;
  fsr?: number | null;
  heightM?: number | null;
  storeys?: number | null;
  affordableHousingContributionPct?: number | null;
  notes?: string | null;
  machineReadable: boolean;
}

export interface PlanningChangeRecord extends PlanningRuleMeta {
  title: string;
  description: string;
  /** Bounding box for spatial match (WGS84). */
  bbox?: { west: number; south: number; east: number; north: number } | null;
  /** Optional GeoJSON polygon/multipolygon. */
  geometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
  lgas?: string[];
  suburbs?: string[];
  proposedControls?: ProposedControls | null;
  timeline?: { date: string; label: string }[];
}

export interface CurrentStatutoryControls {
  zone: string | null;
  zoneName: string | null;
  fsr: number | null;
  heightM: number | null;
  minLotSizeSqm: number | null;
  heritage: string | null;
  planningInstrument: string | null;
  lga: string | null;
  fsrStatus: string | null;
  sources: string[];
  retrievedAt: string | null;
}

export interface CurrentPathway {
  id: string;
  kind: "LMR" | "INFILL_AFFORDABLE_HOUSING" | "TOD" | "SSD_HOUSING" | "OTHER";
  title: string;
  status: "AVAILABLE" | "CANDIDATE" | "REQUIRES_PLANNING_CONFIRMATION" | "NOT_APPLICABLE";
  summary: string;
  meta: PlanningRuleMeta;
  controls?: {
    baseFsr?: number | null;
    pathwayFsr?: number | null;
    bonusFsrPct?: number | null;
    effectiveFsr?: number | null;
    baseHeightM?: number | null;
    pathwayHeightM?: number | null;
    bonusHeightPct?: number | null;
    effectiveHeightM?: number | null;
    howCalculated?: string[];
  };
  eligibilityNotes: string[];
}

export interface ParcelPlanningContext {
  currentStatutory: CurrentStatutoryControls;
  currentPathways: CurrentPathway[];
  pendingChanges: PlanningChangeRecord[];
  /** Explicit safety: proposed controls must not be used as current rights. */
  safetyNote: string;
}

export interface PlanningRuleProvider {
  readonly name: string;
  getPendingPlanningChanges(input: {
    lng: number;
    lat: number;
    lga?: string | null;
    suburb?: string | null;
  }): Promise<PlanningChangeRecord[]>;
  refreshFromOfficialSources?(): Promise<{ upserted: number; messages: string[] }>;
}
