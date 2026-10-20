"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { ParcelData } from "@/lib/types";
import { fetchApiJson } from "@/lib/api-json";

const LeafletMap = dynamic(() => import("@/components/map/leaflet-map"), {
  ssr: false,
  loading: () => <div className="flex h-full w-full items-center justify-center bg-[#e8e4da] text-[12px] text-muted">Loading map…</div>,
});

type IndexCandidateBody = {
  geometryStatus?: "OK" | "MISSING";
  parcels?: ParcelData[];
  centroid?: { lat: number; lng: number } | null;
  error?: string;
};

/** Real geographic preview for a Today indexed candidate — assembly boundary fitted to extent. */
export function SelectedSiteMapPreview({ candidateId }: { candidateId: string }) {
  const [parcels, setParcels] = useState<ParcelData[]>([]);
  const [status, setStatus] = useState<"loading" | "ok" | "missing" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setParcels([]);
    void (async () => {
      try {
        const body = await fetchApiJson<IndexCandidateBody>(
          `/api/map/index-candidate?id=${encodeURIComponent(candidateId)}`,
        );
        if (cancelled) return;
        const list = (body.parcels ?? []).filter((p) => !!p.geometry);
        if (body.geometryStatus === "MISSING" || list.length === 0) {
          setParcels([]);
          setStatus("missing");
          return;
        }
        setParcels(list);
        setStatus("ok");
      } catch {
        if (!cancelled) {
          setParcels([]);
          setStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [candidateId]);

  const initial = useMemo(() => {
    const c = parcels[0]?.centroid;
    return { lat: c?.[1] ?? -33.87, lng: c?.[0] ?? 151.2, zoom: 18 };
  }, [parcels]);

  const assemblyIds = useMemo(() => parcels.map((p) => p.externalParcelId), [parcels]);

  if (status === "loading") {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#e8e4da] text-[12px] text-muted">Loading map…</div>
    );
  }

  if (status === "missing" || status === "error") {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-canvas px-4 text-center">
        <div className="text-[13px] font-semibold text-ink">Map preview unavailable</div>
        <p className="max-w-[240px] text-[12px] leading-snug text-muted">
          {status === "missing"
            ? "No stored parcel geometry for this site yet."
            : "Could not load site geometry."}
        </p>
      </div>
    );
  }

  return (
    <div className="selected-site-map-preview h-full w-full [&_.absolute.bottom-14]:hidden">
      <LeafletMap
        key={candidateId}
        parcels={parcels}
        selectedId={null}
        assemblyIds={assemblyIds}
        highlightIds={[]}
        neighbourIds={[]}
        zoning={false}
        zoningWms={false}
        parcelTheme="none"
        flyTo={null}
        initial={initial}
        onParcelClick={() => {}}
        onViewportChange={() => {}}
        fitToParcels
        fitPadding={[56, 56]}
        fitMaxZoom={17}
        interactive={false}
      />
    </div>
  );
}
