"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, WMSTileLayer, useMap, useMapEvents, ScaleControl, ZoomControl } from "react-leaflet";
import type { Feature, Polygon, MultiPolygon } from "geojson";
import type { BBox, ParcelData } from "@/lib/types";
import { zoneColour } from "./zone-colours";

export interface MapProps {
  parcels: ParcelData[];
  selectedId: string | null;
  assemblyIds: string[];
  highlightIds: string[];
  neighbourIds: string[];
  zoneFill: boolean;
  zoningWms: boolean;
  flyTo: { lat: number; lng: number; zoom?: number; bbox?: BBox; nonce: number } | null;
  initial: { lat: number; lng: number; zoom: number };
  onParcelClick: (id: string, shift: boolean) => void;
  onViewportChange: (bbox: BBox, zoom: number) => void;
  /** Polygons outlined without interaction (e.g. a saved opportunity). */
  fitToParcels?: boolean;
  interactive?: boolean;
}

const ZONING_WMS =
  process.env.NEXT_PUBLIC_NSW_PLANNING_WMS_URL ??
  "https://mapprod3.environment.nsw.gov.au/arcgis/services/Planning/EPI_Primary_Planning_Layers/MapServer/WMSServer";

function ViewportEvents({ onViewportChange }: { onViewportChange: MapProps["onViewportChange"] }) {
  const map = useMapEvents({
    moveend: () => emit(),
    zoomend: () => emit(),
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

function ParcelLayer(props: Pick<MapProps, "parcels" | "selectedId" | "assemblyIds" | "highlightIds" | "neighbourIds" | "zoneFill" | "onParcelClick" | "fitToParcels" | "interactive">) {
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
          l.on("click", (e: L.LeafletMouseEvent) => clickRef.current(id, e.originalEvent.shiftKey || e.originalEvent.metaKey));
          (l as L.Path).bindTooltip(feature.properties.label as string, { sticky: true, className: "parcel-tooltip", direction: "top", opacity: 0.9 });
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
        properties: { id: p.externalParcelId, label: `${p.address ?? "No address"} · Lot ${p.lot ?? "?"} ${p.dp ?? ""} · ${p.areaSqm.toLocaleString("en-AU")} sqm`, zone: p.planning?.zone ?? null },
      };
      layer.addData(f);
    }
    if (props.fitToParcels && props.parcels.length) map.fitBounds(layer.getBounds(), { padding: [30, 30], maxZoom: 19 });
  }, [props.parcels, props.fitToParcels, map]);

  useEffect(() => {
    const assembly = new Set(props.assemblyIds);
    const highlight = new Set(props.highlightIds);
    const neighbours = new Set(props.neighbourIds);
    const zoneById = new Map(props.parcels.map((p) => [p.externalParcelId, p.planning?.zone ?? null]));
    for (const [id, l] of byId.current) {
      const selected = id === props.selectedId;
      const inAssembly = assembly.has(id);
      const hl = highlight.has(id);
      const nb = neighbours.has(id);
      l.setStyle({
        color: selected ? "#0f3d5e" : hl ? "#b4541a" : inAssembly ? "#0f3d5e" : nb ? "#5b6573" : "#4b5563",
        weight: selected ? 3 : hl || inAssembly ? 2.5 : nb ? 1.5 : 0.7,
        dashArray: nb && !hl && !inAssembly && !selected ? "3 3" : undefined,
        fillColor: hl ? "#f0a36b" : inAssembly ? "#3b82c4" : props.zoneFill ? zoneColour(zoneById.get(id)) : "#ffffff",
        fillOpacity: hl ? 0.6 : inAssembly ? 0.5 : selected ? 0.55 : props.zoneFill ? 0.45 : 0.08,
      });
      if (selected || hl || inAssembly) l.bringToFront();
    }
  }, [props.parcels, props.selectedId, props.assemblyIds, props.highlightIds, props.neighbourIds, props.zoneFill]);

  return null;
}

export default function LeafletMap(props: MapProps) {
  return (
    <MapContainer center={[props.initial.lat, props.initial.lng]} zoom={props.initial.zoom} maxZoom={20} className="h-full w-full" zoomControl={false} scrollWheelZoom={props.interactive !== false}>
      <ZoomControl position="bottomright" />
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxNativeZoom={19}
        maxZoom={20}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · Cadastre &copy; NSW Spatial Services · Planning &copy; NSW DPHI'
      />
      {props.zoningWms && <WMSTileLayer url={ZONING_WMS} params={{ layers: "2", format: "image/png", transparent: true }} opacity={0.45} maxZoom={20} />}
      <ScaleControl position="bottomleft" imperial={false} />
      <ViewportEvents onViewportChange={props.onViewportChange} />
      <FlyTo target={props.flyTo} />
      <ParcelLayer {...props} />
    </MapContainer>
  );
}
