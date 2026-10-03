"use client";

import { createContext, useContext } from "react";
import type { OpportunityDTO, LotDTO, OwnerDTO } from "@/lib/opportunity-dto";
import type { OpportunityAnalysis } from "@/lib/analysis/opportunity";
import type { Assumptions, OpportunityInputs } from "@/lib/analysis/assumptions";
import type { OpportunityStatusValue } from "@/lib/constants";

export type LotPatch = Partial<
  Pick<
    LotDTO,
    | "included"
    | "marketValue"
    | "marketValueLow"
    | "marketValueHigh"
    | "marketValueSource"
    | "marketValueConfidence"
    | "marketValueProvider"
    | "marketValueMethod"
    | "marketValueCheckedAt"
    | "marketValueNote"
    | "landValuePerSqm"
    | "comparableValue"
    | "maxAllocationOverride"
    | "openingOfferOverride"
    | "strategicWeight"
    | "acquisitionStage"
    | "nextAction"
    | "nextActionDate"
    | "lastContactAt"
    | "approachNotes"
  >
> & {
  owner?: Partial<OwnerDTO>;
  planning?: Partial<Pick<LotDTO, "zone" | "zoneName" | "fsr" | "heightM" | "minLotSizeSqm" | "heritage">>;
};

export interface OpportunityCtx {
  dto: OpportunityDTO;
  analysis: OpportunityAnalysis;
  a: Assumptions;
  saving: boolean;
  error: string | null;
  updateInputs: (patch: Partial<OpportunityInputs>) => void;
  updateOverrides: (patch: Partial<Assumptions>) => void;
  updateLot: (lotId: string, patch: LotPatch) => Promise<void>;
  updateOpportunity: (patch: { name?: string; status?: OpportunityStatusValue; notes?: string | null }) => Promise<void>;
  addActivity: (lotId: string, body: { type: string; note?: string; nextAction?: string | null; nextActionDate?: string | null; activityDate?: string }) => Promise<void>;
  refreshPlanning: () => Promise<{ ok: boolean; message?: string }>;
  refresh: () => Promise<void>;
  setDto: React.Dispatch<React.SetStateAction<OpportunityDTO | null>>;
}

export const Ctx = createContext<OpportunityCtx | null>(null);

export function useOpportunity(): OpportunityCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useOpportunity outside provider");
  return c;
}
