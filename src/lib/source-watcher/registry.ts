import type { SourceDefinition } from "./types";

/**
 * Initial SourceRegistry seed — prefer official API / ArcGIS over HTML/PDF.
 * Existing NSW EPI adapters are registered here; new watchers plug in beside them.
 */
export const SOURCE_DEFINITIONS: SourceDefinition[] = [
  {
    id: "nsw-epi-primary-planning",
    name: "NSW EPI Primary Planning Layers",
    authority: "NSW DPHI / Spatial Services",
    category: "CURRENT_CONTROLS",
    sourceType: "ARCGIS",
    pollFrequency: "weekly",
    licence: "NSW Government open planning data",
    config: {
      adapter: "existing:nsw-planning",
      layers: ["zoning", "fsr", "hob", "min_lot_size", "heritage", "land_reservation"],
      note: "Feeds CURRENT PlanningSnapshot — do not conflate with proposed fixtures.",
    },
  },
  {
    id: "nsw-cadastre",
    name: "NSW Cadastre / Lot Property Theme",
    authority: "NSW Spatial Services",
    category: "PROPERTY_SALES",
    sourceType: "ARCGIS",
    pollFrequency: "weekly",
    config: { adapter: "existing:nsw-cadastre" },
  },
  {
    id: "nsw-registered-sales",
    name: "NSW registered property sales",
    authority: "NSW Valuer General / SIX",
    category: "PROPERTY_SALES",
    sourceType: "ARCGIS",
    pollFrequency: "weekly",
    config: { adapter: "existing:nsw-property-sales" },
  },
  {
    id: "nsw-planning-proposal-agency",
    name: "NSW Planning Proposal Agency layers",
    authority: "NSW DPHI",
    category: "PLANNING_PROPOSAL",
    sourceType: "ARCGIS",
    pollFrequency: "every_6_hours",
    config: {
      adapter: "existing:nsw-planning-proposals",
      stages: ["Under Assessment", "Pre-Exhibition", "Under Exhibition", "Post-Exhibition", "Finalisation", "Made", "Withdrawn"],
    },
  },
  {
    id: "nsw-planning-proposal-register",
    name: "NSW Planning Proposal Register (portal)",
    authority: "NSW Planning Portal",
    category: "PLANNING_PROPOSAL",
    sourceType: "HTML",
    pollFrequency: "every_6_hours",
    config: {
      adapter: "planning-proposal-register",
      url: "https://www.planningportal.nsw.gov.au/",
      status: "ADAPTER_STUB — ArcGIS agency layers remain primary until portal JSON feed wired",
    },
  },
  {
    id: "nsw-hda-records",
    name: "Housing Delivery Authority published records",
    authority: "NSW HDA / DPHI",
    category: "HDA",
    sourceType: "HTML",
    pollFrequency: "every_6_hours",
    config: {
      adapter: "hda",
      status: "ADAPTER_STUB — document watch + structured extract",
    },
  },
  {
    id: "nsw-major-projects",
    name: "NSW Major Projects / SSD Application Tracker",
    authority: "NSW Planning Portal",
    category: "MAJOR_PROJECTS",
    sourceType: "API",
    pollFrequency: "every_6_hours",
    config: {
      adapter: "major-projects",
      status: "ADAPTER_STUB — tracker feed pending",
    },
  },
  {
    id: "nsw-da-cdc-pcc",
    name: "NSW Planning Portal DA / CDC / PCC feeds",
    authority: "NSW Planning Portal",
    category: "DA_CDC_PCC",
    sourceType: "API",
    pollFrequency: "nightly",
    config: {
      adapter: "da-cdc-pcc",
      status: "ADAPTER_STUB — Online DA/CDC/PCC data feeds",
    },
  },
  {
    id: "fixture-edgecliff-woollahra",
    name: "Edgecliff–Woollahra proposed map pack (fixture)",
    authority: "NSW DPHI",
    category: "STATE_LED_REZONING",
    sourceType: "FIXTURE",
    pollFrequency: "daily",
    parserVersion: "edgecliff-1",
    config: {
      adapter: "fixture-edgecliff",
      legalStatus: "UNDER_EXHIBITION",
      exhibitionEnd: "2026-10-30",
    },
  },
  {
    id: "fixture-inner-west-fairer-future",
    name: "Inner West Our Fairer Future (fixture)",
    authority: "Inner West Council",
    category: "COUNCIL_STRATEGIC",
    sourceType: "FIXTURE",
    pollFrequency: "daily",
    parserVersion: "iwff-1",
    config: {
      adapter: "fixture-inner-west",
      legalStatus: "PROPOSED",
      preferredIngestion: "ArcGIS Experience → FeatureServer",
    },
  },
  {
    id: "nsw-sepp-housing-lmr",
    name: "Housing SEPP 2021 LMR centres",
    authority: "NSW DPHI",
    category: "CURRENT_CONTROLS",
    sourceType: "ARCGIS",
    pollFrequency: "weekly",
    config: { adapter: "existing:housing-sepp-lmr" },
  },
  {
    id: "tfnsw-gtfs-stops",
    name: "TfNSW GTFS stops / stations",
    authority: "Transport for NSW",
    category: "TRANSPORT",
    sourceType: "API",
    pollFrequency: "weekly",
    config: {
      adapter: "tfnsw-gtfs",
      status: "REGISTERED — adapter not yet implemented",
    },
  },
];

export function getSourceDefinition(id: string): SourceDefinition | undefined {
  return SOURCE_DEFINITIONS.find((s) => s.id === id);
}
