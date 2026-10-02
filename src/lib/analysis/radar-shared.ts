/** Transparent V1 weights — planning-led until market/DA feeds connect. Safe for client import. */
export const RADAR_WEIGHTS = {
  planningUplift: 0.25,
  underdevelopment: 0.2,
  assemblyFriendly: 0.2,
  constraintBurden: 0.15,
  centreProximity: 0.1,
  developmentActivity: 0.1,
} as const;

export interface PrecinctRadarRowDTO {
  precinctId: string;
  name: string;
  score: number;
  components: {
    planningUplift: number;
    underdevelopment: number;
    assemblyFriendly: number;
    constraintBurden: number;
    centreProximity: number;
    developmentActivity: number | null;
  };
  summary: string[];
  sampleParcels: number;
  eligibleResidential: number;
  meanLepFsr: number | null;
  meanModelledFsr: number | null;
  meanFsrUplift: number;
  activityStatus: "NOT_CONNECTED";
  activityMessage: string;
  centre: {
    id: string;
    label: string;
    layClass: string | null;
    lng: number;
    lat: number;
    source: string;
    retrievedAt: string;
  };
  scanBbox: { west: number; south: number; east: number; north: number };
}
