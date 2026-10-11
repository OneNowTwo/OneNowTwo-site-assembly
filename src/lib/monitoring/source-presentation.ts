/**
 * User-facing source provenance for TODAY / intel feeds.
 * Never show fixture-* implementation IDs to end users.
 */

export interface PresentedSource {
  label: string;
  href: string | null;
}

const SOURCE_PRESENTATION: Record<string, PresentedSource> = {
  "live-edgecliff-woollahra": {
    label: "NSW Planning Portal — Edgecliff-Woollahra State-led Rezoning",
    href: "https://www.planningportal.nsw.gov.au/ppr/under-exhibition/edgecliff-woollahra-precinct",
  },
  "live-inner-west-fairer-future": {
    label: "Inner West Council — Our Fairer Future",
    href: "https://experience.arcgis.com/experience/2b5ffd9da4f44cd7b7886b632a180556/page/Page",
  },
  "nsw-planning-proposal-register": {
    label: "NSW Planning Portal — Planning Proposal Register",
    href: "https://www.planningportal.nsw.gov.au/",
  },
  "nsw-hda-records": {
    label: "NSW Housing Delivery Authority — published records",
    href: "https://www.planning.nsw.gov.au/the-planning-system/housing/housing-delivery-authority/published-records",
  },
  "nsw-major-projects": {
    label: "NSW Planning Portal — Major Projects",
    href: "https://www.planningportal.nsw.gov.au/major-projects/projects",
  },
  "nsw-da-cdc-pcc": {
    label: "NSW Planning Portal — Online DA",
    href: "https://www.data.nsw.gov.au/data/dataset/online-da-data-api",
  },
  "nsw-spatial-lmr-viewer": {
    label: "NSW Spatial Portal — LMR viewer",
    href: null,
  },
};

/** True when this source is test/fixture-only and must not appear in production Today. */
export function isFixtureOnlySource(sourceId: string | null | undefined): boolean {
  if (!sourceId) return false;
  return sourceId.startsWith("fixture-") || sourceId.includes("fixture-");
}

/**
 * Map persisted PlanningChangeArea / KeySite ids onto registry source ids
 * when PCA.sourceId was not written (common for early persist paths).
 */
export function resolveSourceIdFromPlanningEntity(input: {
  sourceId?: string | null;
  planningChangeAreaId?: string | null;
}): string | null {
  if (input.sourceId && !isFixtureOnlySource(input.sourceId)) return input.sourceId;
  if (input.sourceId && isFixtureOnlySource(input.sourceId)) return null;
  const pca = input.planningChangeAreaId ?? "";
  if (!pca) return null;
  if (pca.startsWith("fixture-") || pca.includes("fixture-")) return null;
  if (pca.startsWith("council:inner-west") || pca.includes("inner-west-our-fairer")) {
    return "live-inner-west-fairer-future";
  }
  if (pca.startsWith("nsw:edgecliff") || pca.includes("edgecliff-woollahra")) {
    return "live-edgecliff-woollahra";
  }
  if (pca.startsWith("nsw-ppr:")) return "nsw-planning-proposal-register";
  return null;
}

/** Human label for production UI — null when the record must be omitted. */
export function presentSourceForUser(sourceId: string | null | undefined): PresentedSource | null {
  if (!sourceId || isFixtureOnlySource(sourceId)) return null;
  const known = SOURCE_PRESENTATION[sourceId];
  if (known) return known;
  // Fallback: readable label without leaking fixture-*
  const label = sourceId
    .replace(/^live-/, "")
    .replace(/^nsw-/, "NSW ")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return { label, href: null };
}

/** Present planning-entity provenance for Today cards. */
export function presentPlanningEntitySource(input: {
  sourceId?: string | null;
  planningChangeAreaId?: string | null;
  sourceUrl?: string | null;
}): PresentedSource | null {
  const resolved = resolveSourceIdFromPlanningEntity(input);
  const presented = presentSourceForUser(resolved);
  if (!presented) return null;
  return {
    label: presented.label,
    href: presented.href ?? input.sourceUrl ?? null,
  };
}
