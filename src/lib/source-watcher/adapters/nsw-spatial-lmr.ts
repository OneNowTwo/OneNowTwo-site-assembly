/**
 * NSW Spatial Portal LMR Viewer Experience — resolve + audit only.
 * Does not duplicate EPI current-control ingestion.
 */

import { portalHostFromUrl, resolveArcGisExperience } from "../arcgis-experience";
import type { FetchResult, SourceAdapter } from "../types";

export const NSW_SPATIAL_LMR_URL =
  "https://spatialportal.dpie.nsw.gov.au/portal/apps/experiencebuilder/experience/?id=c53d5767b677454c8a26d6790a296bc2";

export interface NswSpatialAudit {
  uniqueLayers: string[];
  duplicateOfEpi: string[];
  authoritativeOrFallback: string;
  suitableForScheduledIngestion: boolean;
  notes: string[];
}

export function auditNswSpatialServices(serviceUrls: string[]): NswSpatialAudit {
  const unique: string[] = [];
  const duplicate: string[] = [];
  for (const u of serviceUrls) {
    if (/mapprod3\.environment\.nsw\.gov\.au.*Principal_Planning|EPI_Primary/i.test(u)) {
      duplicate.push(u);
    } else if (/LMR\/LMR/i.test(u) || /spatialportalarcgis/i.test(u)) {
      unique.push(u);
    } else if (/AddressSearch|World_Imagery|Boundaries_and_Places/i.test(u)) {
      duplicate.push(u);
    } else {
      unique.push(u);
    }
  }
  return {
    uniqueLayers: unique,
    duplicateOfEpi: duplicate,
    authoritativeOrFallback:
      "LMR MapServer is useful as LMR proximity fallback; do not replace official EPI Primary Planning Layers for CURRENT law.",
    suitableForScheduledIngestion: unique.some((u) => /LMR\/LMR/i.test(u)),
    notes: [
      "Experience resolves to WebMap LMR_Map → spatialportalarcgis LMR/LMR MapServer.",
      "Cadastre AddressSearch duplicates existing NSW cadastre provider.",
      "Imagery/basemap layers are not planning controls.",
    ],
  };
}

export class NswSpatialLmrAdapter implements SourceAdapter {
  readonly id = "nsw-spatial-lmr-viewer";

  async fetch(): Promise<FetchResult> {
    const resolved = await resolveArcGisExperience(NSW_SPATIAL_LMR_URL, {
      portalHost: portalHostFromUrl(NSW_SPATIAL_LMR_URL),
      enrichServices: true,
    });
    const audit = auditNswSpatialServices(resolved.services.map((s) => s.url));
    const checkedAt = new Date().toISOString();
    return {
      raw: { experience: resolved, audit },
      normalised: {
        kind: "spatial_portal_audit",
        checkedAt,
        records: [{ audit, experienceItemId: resolved.experienceItemId }],
        meta: {
          discoveryFingerprint: resolved.discoveryFingerprint,
          audit,
          webMapItemIds: resolved.webMapItemIds,
        },
      },
      sourceModifiedAt: resolved.modified ? new Date(resolved.modified).toISOString() : null,
    };
  }
}

export const nswSpatialLmrAdapter = new NswSpatialLmrAdapter();
