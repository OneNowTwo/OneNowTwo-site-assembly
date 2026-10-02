import type { AnalysisLot } from "@/lib/analysis/assembly";
import type { ParcelData } from "@/lib/types";

export function parcelLabel(p: Pick<ParcelData, "address" | "lot" | "dp">): string {
  return p.address ? p.address.replace(/,\s*[^,]+$/, "") : `Lot ${p.lot ?? "?"} ${p.dp ?? ""}`.trim();
}

export function parcelToAnalysisLot(p: ParcelData): AnalysisLot {
  return {
    id: p.externalParcelId,
    label: parcelLabel(p),
    areaSqm: p.areaSqm,
    zone: p.planning?.zone ?? null,
    zoneName: p.planning?.zoneName ?? null,
    fsr: p.planning?.fsr ?? null,
    fsrStatus: p.planning?.fsrStatus ?? null,
    fsrControls: p.planning?.fsrControls ?? [],
    heightM: p.planning?.heightM ?? null,
    minLotSizeSqm: p.planning?.minLotSizeSqm ?? null,
    heritage: p.planning?.heritage ?? null,
    isStrata: p.isStrata,
    planningKnown: !!p.planning,
  };
}
