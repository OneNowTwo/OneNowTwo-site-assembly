/**
 * Future: NSW Planning Portal Online DA Data API (applications from 2019).
 * Stub only — do not fabricate competition / “untapped” scores.
 */
export interface DevelopmentActivitySummary {
  precinctId: string;
  status: "NOT_CONNECTED";
  message: string;
  daCount?: null;
  cdcCount?: null;
  retrievedAt: null;
}

export interface DevelopmentActivityProvider {
  name: string;
  getActivityForPrecinct(precinctId: string): Promise<DevelopmentActivitySummary>;
}

export class StubDevelopmentActivityProvider implements DevelopmentActivityProvider {
  readonly name = "NSW Planning Portal Online DA Data API (not connected)";

  async getActivityForPrecinct(precinctId: string): Promise<DevelopmentActivitySummary> {
    return {
      precinctId,
      status: "NOT_CONNECTED",
      message: "DEVELOPMENT ACTIVITY DATA NOT CONNECTED — DA/CDC volume will feed an opportunity/competition index once wired.",
      daCount: null,
      cdcCount: null,
      retrievedAt: null,
    };
  }
}

export const developmentActivityProvider = new StubDevelopmentActivityProvider();
