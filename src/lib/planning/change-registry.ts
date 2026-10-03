import type { PlanningChangeRecord } from "./types";

/**
 * Curated official planning-change watchlist for MVP.
 * Sourced from NSW / council announcements — status is PROPOSED/GATEWAY/EXHIBITED only.
 * Numerical proposed controls are only stored when machine-readable; otherwise flagged.
 *
 * Refresh via /api/cron/planning-watch (does not silently rewrite CURRENT law).
 */
export const CURATED_PLANNING_CHANGES: PlanningChangeRecord[] = [
  {
    id: "nsw:pp-2026-1946-mosman-masterplan",
    title: "Mosman Masterplan & Affordable Housing Contributions Scheme",
    description:
      "Draft Mosman Masterplan and draft Affordable Housing Contributions Scheme lodged with NSW DPHI for Gateway assessment. Potential future local uplift and contribution settings — NOT current development rights.",
    status: "GATEWAY",
    instrumentName: "Mosman Local Environmental Plan — proposed amendment (Masterplan)",
    planningProposalNumber: "PP-2026-1946",
    authority: "Mosman Council / NSW DPHI",
    sourceUrl: "https://www.planningportal.nsw.gov.au/",
    sourceAuthority: "NSW Planning Portal / Mosman Council",
    announcementDate: "2026-09-01",
    effectiveDate: null,
    lastChecked: new Date().toISOString(),
    lgas: ["MOSMAN"],
    suburbs: ["Mosman", "Balmoral", "Beauty Point", "Clifton Gardens", "Georges Heights", "Spit Junction"],
    // Approximate Mosman LGA envelope (WGS84) for overlap screening.
    bbox: { west: 151.22, south: -33.88, east: 151.27, north: -33.8 },
    proposedControls: {
      machineReadable: false,
      notes: "PROPOSED CONTROL NOT YET MACHINE-READABLE — inspect Gateway documents for numerical FSR/height. Do not invent values.",
    },
    timeline: [
      { date: "2026-08", label: "Council endorsed draft Masterplan / AHCS" },
      { date: "2026-09", label: "Planning proposal lodged with NSW DPHI" },
      { date: "2026-09", label: "Gateway Determination (current)" },
      { date: "future", label: "Possible public exhibition (if Gateway allows)" },
      { date: "future", label: "Possible finalisation / commencement (not assumed)" },
    ],
  },
  {
    id: "nsw:edgecliff-woollahra-draft-rezoning-2026",
    title: "Edgecliff–Woollahra draft rezoning proposal",
    description:
      "NSW Government draft Edgecliff–Woollahra rezoning on public exhibition. Substantial proposed housing uplift (reported ~9,400 homes) with towers up to ~34 storeys near Edgecliff and affordable-housing contributions (reported from ~3% rising toward ~15% on certain sites). Exhibition to 7 October 2026. NOT current law.",
    status: "EXHIBITED",
    instrumentName: "Draft Edgecliff–Woollahra rezoning (State-led)",
    planningProposalNumber: null,
    authority: "NSW DPHI",
    sourceUrl: "https://www.planning.nsw.gov.au/",
    sourceAuthority: "NSW Department of Planning, Housing and Infrastructure",
    announcementDate: "2026-09-01",
    exhibitionEndDate: "2026-10-07",
    effectiveDate: null,
    lastChecked: new Date().toISOString(),
    lgas: ["WOOLLAHRA"],
    suburbs: ["Edgecliff", "Woollahra", "Paddington", "Double Bay", "Darling Point"],
    // Approximate Edgecliff / Woollahra corridor envelope.
    bbox: { west: 151.22, south: -33.895, east: 151.265, north: -33.86 },
    proposedControls: {
      machineReadable: false,
      storeys: 34,
      affordableHousingContributionPct: 0.03,
      notes:
        "PROPOSED CONTROL NOT YET FULLY MACHINE-READABLE. Contribution % and heights vary by site in exhibition material — treat as indication only. NOT CURRENT LAW.",
    },
    timeline: [
      { date: "2026-08-21", label: "Separate Woollahra LEP FSR amendment commenced (CURRENT via LEP layer — not this draft)" },
      { date: "2026-09", label: "Edgecliff–Woollahra draft rezoning on public exhibition" },
      { date: "2026-10-07", label: "Exhibition closes (as announced)" },
      { date: "future", label: "Possible post-exhibition review / finalisation (not assumed)" },
    ],
  },
];

export function pointInBBox(
  lng: number,
  lat: number,
  bbox: { west: number; south: number; east: number; north: number },
): boolean {
  return lng >= bbox.west && lng <= bbox.east && lat >= bbox.south && lat <= bbox.north;
}

export function matchPlanningChanges(input: {
  lng: number;
  lat: number;
  lga?: string | null;
  suburb?: string | null;
  registry?: PlanningChangeRecord[];
}): PlanningChangeRecord[] {
  const list = input.registry ?? CURATED_PLANNING_CHANGES;
  const lga = (input.lga ?? "").toUpperCase();
  const suburb = (input.suburb ?? "").toLowerCase();
  return list.filter((c) => {
    // Never surface CURRENT here — this registry is pending/proposed only.
    if (c.status === "CURRENT" || c.status === "SUPERSEDED" || c.status === "WITHDRAWN") return false;
    if (c.bbox && pointInBBox(input.lng, input.lat, c.bbox)) return true;
    if (lga && c.lgas?.some((x) => lga.includes(x) || x.includes(lga))) return true;
    if (suburb && c.suburbs?.some((x) => suburb.includes(x.toLowerCase()))) return true;
    return false;
  });
}
