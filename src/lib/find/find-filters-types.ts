import type { DevelopmentStrategy } from "@/lib/source-watcher/strategy-profile";

export interface FindFilters {
  state?: string;
  lga?: string | null;
  suburb?: string | null;
  centreQuery?: string | null;
  strategy?: DevelopmentStrategy;
  zone?: string | null;
  minCurrentFsr?: number | null;
  maxCurrentFsr?: number | null;
  minProposedFsr?: number | null;
  maxProposedFsr?: number | null;
  minSiteAreaSqm?: number | null;
  maxSiteAreaSqm?: number | null;
  singleLotOnly?: boolean | null;
  maxOwners?: number | null;
  excludeStrata?: boolean | null;
  maxStationDistanceM?: number | null;
  insidePlanningChangeArea?: boolean | null;
  keySiteOnly?: boolean | null;
  minRequiredParcelCount?: number | null;
  minHeadroom?: number | null;
  minScore?: number | null;
  naturalLanguage?: string | null;
  west?: number;
  south?: number;
  east?: number;
  north?: number;
  maxResults?: number;
  /**
   * index (default) — query SiteCandidateIndex first for fast results.
   * live — run the existing parcel/assembly deep scan on demand.
   */
  mode?: "index" | "live";
}
