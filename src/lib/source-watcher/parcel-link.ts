/**
 * KeySite ↔ cadastral parcel linking.
 * Uses KeySite geometry/bbox against NSW cadastre when available; falls back to hints.
 */

import { buildUrl, fetchJson } from "@/lib/data-sources/http";
import { NSW_CADASTRE_BASE, splitNswAddress } from "@/lib/data-sources/nsw-cadastre";
import { esriToGeoJSON, type EsriQueryResponse } from "@/lib/data-sources/esri";
import { pointInGeometry } from "./geometry";
import type { BBox, KeySiteFact, KeySiteHit, PlanningChangeAreaFact, ProposedPlanningFindFields } from "./types";
import { loadFixturePlanningAreas, resolveKeySitesForPoint, resolveProposedPlanningAtPoint } from "./key-sites";

interface LotAttrs {
  cadid: number;
  lotidstring: string | null;
  planlabel: string | null;
  lotnumber: string | null;
}

interface PropertyAttrs {
  address: string | null;
  propid: number;
}

export interface LinkedParcel {
  externalParcelId: string;
  address: string | null;
  lotLabel: string | null;
}

function bboxFromSite(site: KeySiteFact): BBox | null {
  if (site.bbox) return site.bbox;
  const g = site.geometry;
  if (!g) return null;
  const coords =
    g.type === "Polygon"
      ? g.coordinates[0] ?? []
      : g.type === "MultiPolygon"
        ? g.coordinates.flatMap((p) => p[0] ?? [])
        : [];
  if (!coords.length) return null;
  const xs = coords.map((c) => c[0]!);
  const ys = coords.map((c) => c[1]!);
  return { west: Math.min(...xs), south: Math.min(...ys), east: Math.max(...xs), north: Math.max(...ys) };
}

/** Query cadastral lots intersecting a KeySite envelope. */
export async function resolveParcelsForKeySite(site: KeySiteFact): Promise<LinkedParcel[]> {
  const bbox = bboxFromSite(site);
  if (!bbox) {
    return (site.requiredParcelHints ?? []).map((h, i) => ({
      externalParcelId: `hint:${i}:${h}`,
      address: h,
      lotLabel: h,
    }));
  }

  try {
    const lotUrl = buildUrl(`${NSW_CADASTRE_BASE}/8/query`, {
      where: "1=1",
      geometry: `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
      geometryType: "esriGeometryEnvelope",
      inSR: 4326,
      spatialRel: "esriSpatialRelIntersects",
      outFields: "cadid,lotidstring,planlabel,lotnumber",
      returnGeometry: true,
      outSR: 4326,
      resultRecordCount: 80,
      f: "json",
    });
    const propUrl = buildUrl(`${NSW_CADASTRE_BASE}/12/query`, {
      where: "1=1",
      geometry: `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
      geometryType: "esriGeometryEnvelope",
      inSR: 4326,
      spatialRel: "esriSpatialRelIntersects",
      outFields: "address,propid",
      returnGeometry: false,
      resultRecordCount: 80,
      f: "json",
    });
    const [lots, props] = await Promise.all([
      fetchJson<EsriQueryResponse<LotAttrs>>(lotUrl, { service: "nsw-cadastre-lots", ttlMs: 10 * 60 * 1000 }),
      fetchJson<EsriQueryResponse<PropertyAttrs>>(propUrl, { service: "nsw-cadastre-props", ttlMs: 10 * 60 * 1000 }),
    ]);

    const addresses = (props.features ?? [])
      .map((f) => splitNswAddress(f.attributes.address).address)
      .filter(Boolean) as string[];

    const linked: LinkedParcel[] = [];
    for (const f of lots.features ?? []) {
      const geom = f.geometry ? esriToGeoJSON(f.geometry) : null;
      if (site.geometry && geom) {
        // Keep lot if its centroid-ish first ring point falls in key site (approx).
        const ring = geom.type === "Polygon" ? geom.coordinates[0] : geom.coordinates[0]?.[0];
        const pt = ring?.[0];
        if (pt && !pointInGeometry(pt[0]!, pt[1]!, site.geometry, site.bbox)) continue;
      }
      const id = f.attributes.lotidstring || `cad:${f.attributes.cadid}`;
      linked.push({
        externalParcelId: id,
        address: addresses[linked.length] ?? null,
        lotLabel: f.attributes.planlabel
          ? `Lot ${f.attributes.lotnumber ?? "?"} ${f.attributes.planlabel}`
          : id,
      });
    }

    if (linked.length) return linked;
  } catch {
    // Fall through to hints.
  }

  return (site.requiredParcelHints ?? []).map((h, i) => ({
    externalParcelId: `hint:${i}:${h}`,
    address: h,
    lotLabel: h,
  }));
}

/** Enrich KeySite hits with parcel links for Site page / ANALYSE REQUIRED ASSEMBLY. */
export async function resolveKeySitesWithParcels(input: {
  lng: number;
  lat: number;
  areas?: PlanningChangeAreaFact[];
}): Promise<KeySiteHit[]> {
  const hits = resolveKeySitesForPoint(input);
  const out: KeySiteHit[] = [];
  for (const hit of hits) {
    const parcels = await resolveParcelsForKeySite(hit.keySite);
    const requiredCount = parcels.length || hit.requiredCount;
    let yourIndex: number | null = hit.yourPropertyIndex;
    if (parcels.length) {
      // Approximate: first parcel if point is in site.
      yourIndex = 1;
    }
    out.push({
      ...hit,
      requiredCount,
      requiredParcelIds: parcels.map((p) => p.externalParcelId),
      requiredAddresses: parcels.map((p) => p.address ?? p.lotLabel ?? p.externalParcelId),
      keySite: {
        ...hit.keySite,
        requiredParcelIds: parcels.map((p) => p.externalParcelId),
        requiredParcelHints:
          hit.keySite.requiredParcelHints?.length
            ? hit.keySite.requiredParcelHints
            : parcels.map((p) => p.address ?? p.lotLabel ?? p.externalParcelId),
      },
      yourPropertyIndex: yourIndex,
    });
  }
  return out;
}

export function proposedFindFieldsAtPoint(input: {
  lng: number;
  lat: number;
  areas?: PlanningChangeAreaFact[];
}): ProposedPlanningFindFields {
  const areas = input.areas ?? loadFixturePlanningAreas();
  const proposed = resolveProposedPlanningAtPoint({ ...input, areas });
  const area = proposed.planningChangeAreas[0];
  const ks = proposed.keySites[0];
  const controls = ks?.keySite.incentiveControls ?? ks?.keySite.proposedControls ?? area?.proposedControls;
  return {
    insidePlanningChangeArea: proposed.planningChangeAreas.length > 0,
    planningChangeStatus: area?.status ?? null,
    proposedZone: controls?.zone ?? null,
    proposedFsr: controls?.incentiveFsr ?? controls?.fsr ?? null,
    proposedHeight: controls?.incentiveHeightM ?? controls?.heightM ?? null,
    keySiteId: ks?.keySite.externalKeySiteId ?? null,
    requiredParcelCount: ks?.requiredCount ?? null,
  };
}
