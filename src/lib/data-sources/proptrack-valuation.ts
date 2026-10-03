import type { PropertyValuationProvider, PropertyValuationResult } from "./providers";

/**
 * PropTrack AVM adapter (architecture stub).
 * Disabled until legitimate commercial API credentials / terms are available.
 * Do NOT scrape realestate.com.au.
 *
 * Env (future): PROPTRACK_API_KEY, PROPTRACK_API_BASE
 */
export function propTrackValuationConfigured(): boolean {
  return !!(process.env.PROPTRACK_API_KEY && process.env.PROPTRACK_ENABLED === "true");
}

export class PropTrackValuationProvider implements PropertyValuationProvider {
  readonly name = "PropTrack AVM API";

  async estimate(input: {
    externalParcelId: string;
    address?: string | null;
    suburb?: string | null;
    areaSqm: number;
    userValue?: number | null;
    userLow?: number | null;
    userHigh?: number | null;
    comparableDerived?: number | null;
  }): Promise<PropertyValuationResult> {
    const checkedAt = new Date().toISOString();
    if (input.userValue != null && input.userValue > 0) {
      return {
        mid: input.userValue,
        low: input.userLow ?? null,
        high: input.userHigh ?? null,
        status: "USER_ESTIMATE",
        confidence: "UNKNOWN",
        source: "USER_ESTIMATE",
        provider: "MANUAL",
        method: "manual_override",
        checkedAt,
        note: "USER ENTERED EXTERNAL ESTIMATE",
      };
    }
    return {
      mid: null,
      low: null,
      high: null,
      status: "NO_VALUE",
      confidence: "UNKNOWN",
      source: "NO_VALUE",
      provider: "PROPTRACK",
      method: null,
      checkedAt,
      note: propTrackValuationConfigured()
        ? "PropTrack provider not yet implemented for live calls"
        : "PROPTRACK VALUATION NOT CONNECTED — commercial API credentials required (do not scrape REA)",
      cacheable: false,
    };
  }
}

export const propTrackValuationProvider = new PropTrackValuationProvider();
