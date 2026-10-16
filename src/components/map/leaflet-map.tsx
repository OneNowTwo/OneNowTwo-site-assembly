"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, WMSTileLayer, useMap, useMapEvents, ScaleControl, ZoomControl } from "react-leaflet";
import type { Feature, Polygon, MultiPolygon } from "geojson";
import type { BBox, ParcelData } from "@/lib/types";
import type { NominatedCentre } from "@/lib/data-sources/housing-sepp-lmr";
import type { TrainStation } from "@/lib/data-sources/nsw-train-stations";
import type { DevelopmentActivity } from "@/lib/source-watcher/development-activity";
import { activityPlotLatLng } from "@/lib/source-watcher/development-activity";
import type { WatchedSiteMarker } from "@/lib/map/watched-site-marker";
import { zoneColour } from "./zone-colours";
import {
  fsrColour,
  heightColour,
  heritageColour,
  isHeritageMapped,
  heritageKind,
  STRATA_COLOUR,
  FSR_LEGEND,
  HEIGHT_LEGEND,
  FSR_BUCKET_COLOURS,
  HEIGHT_BUCKET_COLOURS,
  HERITAGE_COLOURS,
  type ParcelTheme,
} from "@/lib/map/layer-styles";

export type { ParcelTheme };

export interface MapProps {
  parcels: ParcelData[];
  selectedId: string | null;
  assemblyIds: string[];
  highlightIds: string[];
  neighbourIds: string[];
  /** Current LEP zone fill (parcel colours). */
  zoning: boolean;
  /** Official NSW zoning WMS underlay (same Zoning control — no jargon in UI). */
  zoningWms: boolean;
  /** Thematic fill when not using plain zoning — mutually prioritised in ParcelLayer. */
  parcelTheme: ParcelTheme;
  /** PROPOSED PLANNING overlay (PlanningChangeArea / KeySite) — never current LEP. */
  proposedPlanning?: boolean;
  proposedPlanningData?: GeoJSON.FeatureCollection | null;
  centres?: NominatedCentre[];
  showCentres?: boolean;
  showCatchments?: boolean;
  stations?: TrainStation[];
  showStations?: boolean;
  activities?: DevelopmentActivity[];
  showDaCdc?: boolean;
  showMajorProjects?: boolean;
  watchedMarkers?: WatchedSiteMarker[];
  showWatched?: boolean;
  flyTo: { lat: number; lng: number; zoom?: number; bbox?: BBox; nonce: number } | null;
  initial: { lat: number; lng: number; zoom: number };
  onParcelClick: (id: string, shift: boolean) => void;
  /** Click on empty map space (not a parcel) — clear detail selection. */
  onBlankClick?: () => void;
  onViewportChange: (bbox: BBox, zoom: number) => void;
  /** Polygons outlined without interaction (e.g. a saved opportunity). */
  fitToParcels?: boolean;
  interactive?: boolean;
  /** When the persistent shell shows the map again, invalidate Leaflet size. */
  visible?: boolean;
}

const ZONING_WMS =
  process.env.NEXT_PUBLIC_NSW_PLANNING_WMS_URL ??
  "https://mapprod3.environment.nsw.gov.au/arcgis/services/Planning/EPI_Primary_Planning_Layers/MapServer/WMSServer";

function ViewportEvents({
  onViewportChange,
  onBlankClick,
}: {
  onViewportChange: MapProps["onViewportChange"];
  onBlankClick?: MapProps["onBlankClick"];
}) {
  const blankRef = useRef(onBlankClick);
  useEffect(() => {
    blankRef.current = onBlankClick;
  }, [onBlankClick]);
  const map = useMapEvents({
    moveend: () => emit(),
    zoomend: () => emit(),
    click: (e) => {
      // Parcel layers stopPropagation; bare map clicks clear selection.
      const t = e.originalEvent.target as HTMLElement | null;
      if (t && (t.classList.contains("leaflet-interactive") || t.closest?.(".leaflet-interactive"))) return;
      blankRef.current?.();
    },
  });
  const emit = () => {
    const b = map.getBounds();
    onViewportChange({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }, map.getZoom());
  };
  useEffect(() => {
    emit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function FlyTo({ target }: { target: MapProps["flyTo"] }) {
  const map = useMap();
  useEffect(() => {
    if (!target) return;
    if (target.bbox && target.bbox.east - target.bbox.west < 0.03) {
      map.flyToBounds(
        [
          [target.bbox.south, target.bbox.west],
          [target.bbox.north, target.bbox.east],
        ],
        { maxZoom: 18, duration: 0.8 },
      );
    } else map.flyTo([target.lat, target.lng], target.zoom ?? 17, { duration: 0.8 });
  }, [target, map]);
  return null;
}

function InvalidateOnShow({ visible }: { visible?: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (visible === false) return;
    const t = window.setTimeout(() => {
      map.invalidateSize({ animate: false });
    }, 50);
    return () => window.clearTimeout(t);
  }, [visible, map]);
  return null;
}

function parcelFill(p: ParcelData | undefined, theme: ParcelTheme, zoning: boolean): { fillColor: string; fillOpacity: number } {
  if (!p) return { fillColor: "#ffffff", fillOpacity: 0.08 };
  if (theme === "fsr") {
    return {
      fillColor: fsrColour(p.planning?.fsr, p.planning?.fsrStatus, p.planningStatus),
      fillOpacity: 0.55,
    };
  }
  if (theme === "height") {
    return { fillColor: heightColour(p.planning?.heightM, p.planningStatus), fillOpacity: 0.55 };
  }
  if (theme === "heritage") {
    return { fillColor: heritageColour(p.planning?.heritage), fillOpacity: isHeritageMapped(p.planning?.heritage) ? 0.55 : 0.12 };
  }
  if (theme === "strata") {
    return {
      fillColor: p.isStrata ? STRATA_COLOUR : "#ffffff",
      fillOpacity: p.isStrata ? 0.45 : 0.06,
    };
  }
  if (theme === "zoning" || zoning) {
    return { fillColor: zoneColour(p.planning?.zone), fillOpacity: 0.45 };
  }
  return { fillColor: "#ffffff", fillOpacity: 0.08 };
}

function parcelTooltip(p: ParcelData, theme: ParcelTheme): string {
  const base = `${p.address ?? "No address"} · Lot ${p.lot ?? "?"} ${p.dp ?? ""} · ${p.areaSqm.toLocaleString("en-AU")} sqm`;
  const zone = p.planning?.zone ?? "—";
  if (theme === "fsr") {
    const mapped =
      p.planning?.fsrStatus === "MAPPED" || p.planning?.fsrStatus === "SPLIT"
        ? p.planning.fsr != null
          ? `${p.planning.fsr}:1`
          : "Not mapped"
        : "Not mapped";
    const src = p.planning?.sources?.fsr?.source ?? "NSW Planning";
    return `${base}<br/>Zone ${zone} · Current FSR ${mapped}<br/><em>${src}</em>`;
  }
  if (theme === "height") {
    const h = p.planning?.heightM != null ? `${p.planning.heightM} m` : "Not mapped";
    return `${base}<br/>Zone ${zone} · Current height ${h}`;
  }
  if (theme === "heritage") {
    const k = heritageKind(p.planning?.heritage);
    const label = k === "item" || k === "conservation" ? p.planning?.heritage ?? "Heritage" : k === "none" ? "None mapped" : "Unknown";
    return `${base}<br/>Heritage: ${label}`;
  }
  if (theme === "strata") {
    return p.isStrata ? `${base}<br/><strong>Strata parcel</strong>` : base;
  }
  return base;
}

function ParcelLayer(
  props: Pick<
    MapProps,
    | "parcels"
    | "selectedId"
    | "assemblyIds"
    | "highlightIds"
    | "neighbourIds"
    | "zoning"
    | "parcelTheme"
    | "onParcelClick"
    | "fitToParcels"
    | "interactive"
  >,
) {
  const map = useMap();
  const layerRef = useRef<L.GeoJSON | null>(null);
  const byId = useRef(new Map<string, L.Path>());
  const clickRef = useRef(props.onParcelClick);
  useEffect(() => {
    clickRef.current = props.onParcelClick;
  }, [props.onParcelClick]);

  useEffect(() => {
    const layer = L.geoJSON(undefined, {
      onEachFeature: (feature, l) => {
        const id = feature.properties.id as string;
        byId.current.set(id, l as L.Path);
        if (props.interactive !== false) {
          l.on("click", (e: L.LeafletMouseEvent) => {
            L.DomEvent.stopPropagation(e);
            clickRef.current(id, e.originalEvent.shiftKey || e.originalEvent.metaKey);
          });
        }
      },
    }).addTo(map);
    layerRef.current = layer;
    const ids = byId.current;
    return () => {
      layer.remove();
      ids.clear();
    };
  }, [map, props.interactive]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const have = new Set(byId.current.keys());
    const want = new Set(props.parcels.map((p) => p.externalParcelId));
    for (const id of have) {
      if (!want.has(id)) {
        layer.removeLayer(byId.current.get(id)!);
        byId.current.delete(id);
      }
    }
    for (const p of props.parcels) {
      if (have.has(p.externalParcelId)) continue;
      const f: Feature<Polygon | MultiPolygon> = {
        type: "Feature",
        geometry: p.geometry,
        properties: { id: p.externalParcelId },
      };
      layer.addData(f);
    }
    if (props.fitToParcels && props.parcels.length) map.fitBounds(layer.getBounds(), { padding: [30, 30], maxZoom: 19 });
  }, [props.parcels, props.fitToParcels, map]);

  useEffect(() => {
    const assembly = new Set(props.assemblyIds);
    const highlight = new Set(props.highlightIds);
    const neighbours = new Set(props.neighbourIds);
    const byParcel = new Map(props.parcels.map((p) => [p.externalParcelId, p]));
    for (const [id, l] of byId.current) {
      const p = byParcel.get(id);
      const selected = id === props.selectedId;
      const inAssembly = assembly.has(id);
      const hl = highlight.has(id);
      const nb = neighbours.has(id);
      const fill = parcelFill(p, props.parcelTheme, props.zoning);
      const strataStroke = props.parcelTheme === "strata" && p?.isStrata;
      const heritageStroke = props.parcelTheme === "heritage" && p && isHeritageMapped(p.planning?.heritage);
      l.setStyle({
        color: selected
          ? "#0f3d5e"
          : hl
            ? "#b4541a"
            : inAssembly
              ? "#0f3d5e"
              : strataStroke
                ? STRATA_COLOUR
                : heritageStroke
                  ? HERITAGE_COLOURS.item
                  : nb
                    ? "#5b6573"
                    : "#4b5563",
        weight: selected ? 3 : hl || inAssembly || strataStroke || heritageStroke ? 2.5 : nb ? 1.5 : 0.7,
        dashArray: nb && !hl && !inAssembly && !selected ? "3 3" : undefined,
        fillColor: hl ? "#f0a36b" : inAssembly ? "#3b82c4" : fill.fillColor,
        fillOpacity: hl ? 0.6 : inAssembly ? 0.5 : selected ? 0.55 : fill.fillOpacity,
      });
      if (p && props.interactive !== false) {
        const tip = parcelTooltip(p, props.parcelTheme);
        if (l.getTooltip()) l.setTooltipContent(tip);
        else l.bindTooltip(tip, { sticky: true, className: "parcel-tooltip", direction: "top", opacity: 0.9 });
      }
      if (selected || hl || inAssembly) l.bringToFront();
    }
  }, [props.parcels, props.selectedId, props.assemblyIds, props.highlightIds, props.neighbourIds, props.zoning, props.parcelTheme, props.interactive]);

  return null;
}

function ProposedPlanningLayer({
  enabled,
  data,
}: {
  enabled?: boolean;
  data?: GeoJSON.FeatureCollection | null;
}) {
  const map = useMap();
  const layerRef = useRef<L.GeoJSON | null>(null);
  useEffect(() => {
    if (!enabled || !data?.features?.length) {
      layerRef.current?.remove();
      layerRef.current = null;
      return;
    }
    layerRef.current?.remove();
    const layer = L.geoJSON(data as GeoJSON.GeoJsonObject, {
      style: (feat) => {
        const isKey = Boolean(feat?.properties && (feat.properties as { keySite?: boolean }).keySite);
        return {
          color: isKey ? "#b45309" : "#9a3412",
          weight: isKey ? 2.5 : 1.5,
          dashArray: isKey ? undefined : "6 4",
          fillColor: isKey ? "#f59e0b" : "#fdba74",
          fillOpacity: isKey ? 0.28 : 0.14,
        };
      },
      onEachFeature: (feat, lyr) => {
        const p = (feat.properties ?? {}) as Record<string, unknown>;
        const title = String(p.title ?? p.id ?? "Proposed");
        const status = String(p.status ?? "PROPOSED");
        const fsr = p.fsr != null ? `Proposed FSR ${p.fsr}` : "";
        const height = p.heightM != null ? `Proposed height ${p.heightM} m` : "";
        const req = p.requiredParcelCount != null ? `${p.requiredParcelCount} required parcels` : "";
        const src = p.source ? String(p.source) : "";
        const date = p.updatedAt || p.asAt || p.date ? String(p.updatedAt ?? p.asAt ?? p.date) : "";
        lyr.bindPopup(
          `<strong>${title}</strong><br/>Status: ${status}<br/>${[fsr, height, req].filter(Boolean).join(" · ")}` +
            (src ? `<br/>Source: ${src}` : "") +
            (date ? `<br/>${date}` : "") +
            `<br/><em>PROPOSED — not current law</em>`,
        );
      },
    });
    layer.addTo(map);
    layerRef.current = layer;
    return () => {
      layer.remove();
      layerRef.current = null;
    };
  }, [enabled, data, map]);
  return null;
}

function CentresCatchmentsLayer({
  centres,
  showCentres,
  showCatchments,
}: {
  centres?: NominatedCentre[];
  showCentres?: boolean;
  showCatchments?: boolean;
}) {
  const map = useMap();
  const groupRef = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    groupRef.current?.remove();
    groupRef.current = null;
    if (!centres?.length || (!showCentres && !showCatchments)) return;
    const group = L.layerGroup();
    for (const c of centres) {
      if (showCatchments) {
        L.circle([c.lat, c.lng], {
          radius: 800,
          color: "#0369a1",
          weight: 1,
          dashArray: "4 4",
          fillColor: "#38bdf8",
          fillOpacity: 0.06,
          interactive: false,
        }).addTo(group);
        L.circle([c.lat, c.lng], {
          radius: 400,
          color: "#0c4a6e",
          weight: 1.5,
          fillColor: "#0ea5e9",
          fillOpacity: 0.1,
          interactive: false,
        }).addTo(group);
      }
      if (showCentres) {
        L.circleMarker([c.lat, c.lng], {
          radius: 6,
          color: "#0c4a6e",
          weight: 2,
          fillColor: "#38bdf8",
          fillOpacity: 0.9,
        })
          .bindPopup(
            `<strong>${c.label}</strong><br/>Nominated LMR centre<br/><em>Approximate 400 m / 800 m screening around nominated centres — confirm planning eligibility.</em>`,
          )
          .addTo(group);
      }
    }
    group.addTo(map);
    groupRef.current = group;
    return () => {
      group.remove();
      groupRef.current = null;
    };
  }, [centres, showCentres, showCatchments, map]);
  return null;
}

function StationsLayer({ stations, enabled }: { stations?: TrainStation[]; enabled?: boolean }) {
  const map = useMap();
  const groupRef = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    groupRef.current?.remove();
    groupRef.current = null;
    if (!enabled || !stations?.length) return;
    const group = L.layerGroup();
    for (const s of stations) {
      L.circleMarker([s.lat, s.lng], {
        radius: 5,
        color: "#1e3a5f",
        weight: 1.5,
        fillColor: "#f8fafc",
        fillOpacity: 1,
      })
        .bindPopup(`<strong>${s.label}</strong><br/>Station / stop`)
        .addTo(group);
    }
    group.addTo(map);
    groupRef.current = group;
    return () => {
      group.remove();
      groupRef.current = null;
    };
  }, [stations, enabled, map]);
  return null;
}

function ActivityLayer({
  activities,
  showDaCdc,
  showMajorProjects,
}: {
  activities?: DevelopmentActivity[];
  showDaCdc?: boolean;
  showMajorProjects?: boolean;
}) {
  const map = useMap();
  const groupRef = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    groupRef.current?.remove();
    groupRef.current = null;
    if (!activities?.length || (!showDaCdc && !showMajorProjects)) return;
    const group = L.layerGroup();
    for (const a of activities) {
      const isDa = a.type === "DA" || a.type === "CDC" || a.type === "PCC";
      const isMajor = a.type === "HDA" || a.type === "SSD" || a.type === "OTHER";
      if (isDa && !showDaCdc) continue;
      if (isMajor && !showMajorProjects) continue;
      if (!isDa && !isMajor) continue;
      // Point / Polygon / MultiPolygon → marker at centroid (do not drop valid HDA/SSD polygons).
      const pt = activityPlotLatLng(a);
      if (!pt) continue;
      const colour = isDa ? "#b45309" : "#9f1239";
      L.circleMarker(pt, {
        radius: isMajor ? 7 : 5,
        color: colour,
        weight: 2,
        fillColor: colour,
        fillOpacity: 0.75,
      })
        .bindPopup(
          `<strong>${a.type}${a.externalId ? ` ${a.externalId}` : ""}</strong><br/>` +
            `${a.status}<br/>` +
            `${a.address ?? a.suburb ?? "Address unknown"}<br/>` +
            (a.lodgedAt ? `Lodged ${a.lodgedAt.slice(0, 10)}<br/>` : "") +
            (a.developmentType ? `${a.developmentType}<br/>` : "") +
            (a.sourceUrl ? `<a href="${a.sourceUrl}" target="_blank" rel="noreferrer">Source</a>` : ""),
        )
        .addTo(group);
    }
    group.addTo(map);
    groupRef.current = group;
    return () => {
      group.remove();
      groupRef.current = null;
    };
  }, [activities, showDaCdc, showMajorProjects, map]);
  return null;
}

function WatchedLayer({ markers, enabled }: { markers?: WatchedSiteMarker[]; enabled?: boolean }) {
  const map = useMap();
  const groupRef = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    groupRef.current?.remove();
    groupRef.current = null;
    if (!enabled || !markers?.length) return;
    const group = L.layerGroup();
    for (const m of markers) {
      L.circleMarker([m.lat, m.lng], {
        radius: 8,
        color: "#0f3d5e",
        weight: 2,
        fillColor: "#fbbf24",
        fillOpacity: 0.9,
      })
        .bindPopup(
          `<strong>${m.label}</strong><br/>` +
            `Watched · ${m.kind.replaceAll("_", " ")}` +
            (m.status ? `<br/>Status: ${m.status}` : "") +
            (m.href ? `<br/><a href="${m.href}">Open opportunity</a>` : ""),
        )
        .addTo(group);
    }
    group.addTo(map);
    groupRef.current = group;
    return () => {
      group.remove();
      groupRef.current = null;
    };
  }, [markers, enabled, map]);
  return null;
}

function MapLegend({ theme, showCatchments }: { theme: ParcelTheme; showCatchments?: boolean }) {
  if (theme === "none" && !showCatchments) return null;
  if (theme === "zoning" || theme === "none") {
    if (!showCatchments) return null;
  }
  return (
    <div className="pointer-events-none absolute bottom-14 left-3 z-[1000] max-w-[200px] rounded-[3px] border border-line bg-white/95 px-2.5 py-2 text-[10.5px] shadow-sm">
      {theme === "fsr" && (
        <>
          <div className="mb-1 font-semibold uppercase tracking-wide text-muted">FSR (current)</div>
          {FSR_LEGEND.map((row) => (
            <div key={row.key} className="flex items-center gap-1.5 py-0.5">
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-[1px]" style={{ background: FSR_BUCKET_COLOURS[row.key] }} />
              {row.label}
            </div>
          ))}
        </>
      )}
      {theme === "height" && (
        <>
          <div className="mb-1 font-semibold uppercase tracking-wide text-muted">Height (current)</div>
          {HEIGHT_LEGEND.map((row) => (
            <div key={row.key} className="flex items-center gap-1.5 py-0.5">
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-[1px]" style={{ background: HEIGHT_BUCKET_COLOURS[row.key] }} />
              {row.label}
            </div>
          ))}
        </>
      )}
      {theme === "heritage" && (
        <>
          <div className="mb-1 font-semibold uppercase tracking-wide text-muted">Heritage</div>
          <div className="flex items-center gap-1.5 py-0.5">
            <span className="inline-block h-2.5 w-2.5 shrink-0" style={{ background: HERITAGE_COLOURS.item }} /> Item
          </div>
          <div className="flex items-center gap-1.5 py-0.5">
            <span className="inline-block h-2.5 w-2.5 shrink-0" style={{ background: HERITAGE_COLOURS.conservation }} /> Conservation area
          </div>
          <div className="flex items-center gap-1.5 py-0.5">
            <span className="inline-block h-2.5 w-2.5 shrink-0" style={{ background: HERITAGE_COLOURS.none }} /> None mapped
          </div>
          <div className="flex items-center gap-1.5 py-0.5">
            <span className="inline-block h-2.5 w-2.5 shrink-0" style={{ background: HERITAGE_COLOURS.unknown }} /> Unknown
          </div>
        </>
      )}
      {theme === "strata" && (
        <>
          <div className="mb-1 font-semibold uppercase tracking-wide text-muted">Strata</div>
          <div className="flex items-center gap-1.5 py-0.5">
            <span className="inline-block h-2.5 w-2.5 shrink-0" style={{ background: STRATA_COLOUR }} /> Strata parcel
          </div>
        </>
      )}
      {showCatchments && (
        <div className={theme !== "none" && theme !== "zoning" ? "mt-1.5 border-t border-line pt-1.5" : ""}>
          <div className="mb-0.5 font-semibold uppercase tracking-wide text-muted">LMR screening</div>
          <div className="text-[10px] text-muted">
            Approximate 400 m / 800 m screening around nominated centres. Confirm planning eligibility.
          </div>
        </div>
      )}
    </div>
  );
}

export default function LeafletMap(props: MapProps) {
  return (
    <div className="relative h-full w-full">
      <MapContainer center={[props.initial.lat, props.initial.lng]} zoom={props.initial.zoom} maxZoom={20} className="h-full w-full" zoomControl={false} scrollWheelZoom={props.interactive !== false}>
        <ZoomControl position="bottomright" />
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxNativeZoom={19}
          maxZoom={20}
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · Cadastre &copy; NSW Spatial Services · Planning &copy; NSW DPHI'
        />
        {props.zoningWms && <WMSTileLayer url={ZONING_WMS} params={{ layers: "2", format: "image/png", transparent: true }} opacity={0.45} maxZoom={20} />}
        <ProposedPlanningLayer enabled={props.proposedPlanning} data={props.proposedPlanningData} />
        <CentresCatchmentsLayer centres={props.centres} showCentres={props.showCentres} showCatchments={props.showCatchments} />
        <StationsLayer stations={props.stations} enabled={props.showStations} />
        <ActivityLayer activities={props.activities} showDaCdc={props.showDaCdc} showMajorProjects={props.showMajorProjects} />
        <WatchedLayer markers={props.watchedMarkers} enabled={props.showWatched} />
        <ScaleControl position="bottomleft" imperial={false} />
        <ViewportEvents onViewportChange={props.onViewportChange} onBlankClick={props.onBlankClick} />
        <InvalidateOnShow visible={props.visible} />
        <FlyTo target={props.flyTo} />
        <ParcelLayer
          parcels={props.parcels}
          selectedId={props.selectedId}
          assemblyIds={props.assemblyIds}
          highlightIds={props.highlightIds}
          neighbourIds={props.neighbourIds}
          zoning={props.zoning}
          parcelTheme={props.parcelTheme}
          onParcelClick={props.onParcelClick}
          fitToParcels={props.fitToParcels}
          interactive={props.interactive}
        />
      </MapContainer>
      <MapLegend theme={props.parcelTheme} showCatchments={props.showCatchments} />
    </div>
  );
}
