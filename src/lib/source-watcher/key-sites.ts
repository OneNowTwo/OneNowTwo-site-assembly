import { pointInGeometry } from "./geometry";
import type { KeySiteHit, NormalisedSourcePayload, PlanningChangeAreaFact } from "./types";
import edgecliff from "./fixtures/edgecliff-woollahra.json";
import innerWest from "./fixtures/inner-west-fairer-future.json";

/** In-process proposed planning areas (fixtures + any runtime merges). Never current law. */
export function loadFixturePlanningAreas(): PlanningChangeAreaFact[] {
  const packs = [edgecliff, innerWest] as NormalisedSourcePayload[];
  return packs.flatMap((p) => p.planningChangeAreas ?? []);
}

/**
 * Intersect a parcel point with KeySite geometries from proposed planning packs.
 * Returns KEY SITE cards for the Site page — legal status stays PROPOSED / UNDER_EXHIBITION.
 */
export function resolveKeySitesForPoint(input: {
  lng: number;
  lat: number;
  areas?: PlanningChangeAreaFact[];
}): KeySiteHit[] {
  const areas = input.areas ?? loadFixturePlanningAreas();
  const hits: KeySiteHit[] = [];
  for (const area of areas) {
    for (const site of area.keySites ?? []) {
      if (!pointInGeometry(input.lng, input.lat, site.geometry ?? null, site.bbox ?? null)) continue;
      const required = site.requiredParcelHints ?? [];
      hits.push({
        planningChangeAreaId: area.id,
        planningChangeAreaTitle: area.title,
        status: area.status,
        legalStatus: site.proposedControls?.legalStatus ?? area.proposedControls.legalStatus ?? "PROPOSED",
        keySite: site,
        yourPropertyIndex: required.length ? 1 : null,
        requiredCount: required.length,
      });
    }
  }
  return hits;
}

/** Which proposed layers apply at a point (area-level + key-site level). */
export function resolveProposedPlanningAtPoint(input: { lng: number; lat: number; areas?: PlanningChangeAreaFact[] }) {
  const areas = input.areas ?? loadFixturePlanningAreas();
  const inArea = areas.filter((a) => pointInGeometry(input.lng, input.lat, a.geometry ?? null, a.bbox ?? null));
  const keySites = resolveKeySitesForPoint({ ...input, areas });
  return {
    legalDisclaimer: "PROPOSED / UNDER EXHIBITION — not current LEP law. PlanningSnapshot current controls remain authoritative for feasibility.",
    planningChangeAreas: inArea,
    keySites,
    applies: {
      proposedZoning: inArea.some((a) => !!a.proposedControls.zone) || keySites.some((k) => !!k.keySite.proposedControls?.zone),
      incentiveFsr: keySites.some((k) => k.keySite.incentiveControls?.incentiveFsr != null),
      incentiveHeight: keySites.some((k) => k.keySite.incentiveControls?.incentiveHeightM != null),
      keySite: keySites.length > 0,
      nonResidentialFsr: keySites.some((k) => k.keySite.proposedControls?.nonResidentialFsr != null),
      affordableHousing: keySites.some(
        (k) =>
          k.keySite.incentiveControls?.affordableHousingContributionPct != null ||
          k.keySite.proposedControls?.affordableHousingContributionPct != null,
      ),
      activeStreetFrontage: keySites.some((k) => k.keySite.proposedControls?.activeStreetFrontage === true),
    },
  };
}
