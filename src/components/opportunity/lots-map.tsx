"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import type { LotDTO } from "@/lib/opportunity-dto";
import type { ParcelData } from "@/lib/types";

const LeafletMap = dynamic(() => import("@/components/map/leaflet-map"), { ssr: false, loading: () => <div className="h-full w-full bg-[#e8eaed]" /> });

export function lotToParcel(l: LotDTO): ParcelData {
  return {
    externalParcelId: l.id,
    source: l.source,
    lot: l.lot,
    section: l.section,
    dp: l.dp,
    lotIdString: null,
    address: l.address,
    suburb: l.suburb,
    geometry: l.geometry,
    centroid: l.centroid,
    areaSqm: l.areaSqm,
    isStrata: l.isStrata,
    planning: {
      zone: l.zone,
      zoneName: l.zoneName,
      fsr: l.fsr,
      fsrStatus: l.fsrStatus ?? (l.fsr != null ? "MAPPED" : "NO_MAPPED"),
      fsrControls: l.fsrControls ?? [],
      heightM: l.heightM,
      minLotSizeSqm: l.minLotSizeSqm,
      heritage: l.heritage,
      planningInstrument: l.planningInstrument,
      lga: l.lga,
      sources: l.planningSources,
    },
    planningStatus: "ok",
    retrievedAt: l.planningCheckedAt ?? "",
  };
}

export function LotsMap({ lots, selectedId, onSelect }: { lots: LotDTO[]; selectedId?: string | null; onSelect?: (id: string) => void }) {
  const parcels = useMemo(() => lots.map(lotToParcel), [lots]);
  const c = lots[0]?.centroid ?? [151.2, -33.85];
  return (
    <LeafletMap
      parcels={parcels}
      selectedId={selectedId ?? null}
      assemblyIds={lots.filter((l) => l.included).map((l) => l.id)}
      highlightIds={[]}
      neighbourIds={lots.filter((l) => !l.included).map((l) => l.id)}
      zoneFill={false}
      zoningWms={false}
      flyTo={null}
      initial={{ lat: c[1], lng: c[0], zoom: 18 }}
      onParcelClick={(id) => onSelect?.(id)}
      onViewportChange={() => {}}
      fitToParcels
    />
  );
}
