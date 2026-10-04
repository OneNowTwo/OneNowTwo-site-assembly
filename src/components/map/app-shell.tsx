"use client";

import { usePathname, useSearchParams } from "next/navigation";
import type { Assumptions } from "@/lib/analysis/assumptions";
import { MapWorkspace } from "@/components/map/map-workspace";

/**
 * Keeps the map workspace mounted across nav tabs so Leaflet state and in-flight
 * area scans survive leaving /map (and returning) without a full reset.
 */
export function AppShell({ assumptions, children }: { assumptions: Assumptions; children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const onMap = pathname === "/map";
  const scanQuery = searchParams.get("scan");

  return (
    <div className="relative h-full min-h-0">
      <div
        className="absolute inset-0"
        style={{
          visibility: onMap ? "visible" : "hidden",
          pointerEvents: onMap ? "auto" : "none",
          zIndex: onMap ? 1 : 0,
        }}
        aria-hidden={!onMap}
      >
        <MapWorkspace assumptions={assumptions} initialScanQuery={scanQuery} mapVisible={onMap} />
      </div>
      <div className={onMap ? "hidden" : "relative z-[2] h-full min-h-0 overflow-auto bg-canvas"}>{children}</div>
    </div>
  );
}
