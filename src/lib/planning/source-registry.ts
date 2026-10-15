/**
 * Central planning / development-data source registry.
 *
 * Prefer official API / ArcGIS / WFS / JSON. Public scrape/parse only where permitted.
 * App reads versioned stored evidence — not live government hits on every page load.
 *
 * Extends (does not replace) source-watcher definitions with Site Assembly–oriented metadata.
 */

export type PlanningAccessType = "API" | "ARCGIS" | "WFS" | "JSON" | "HTML" | "PDF" | "MANUAL";

export type PlanningDataType =
  | "cadastre"
  | "zoning"
  | "fsr"
  | "height"
  | "minimum_lot"
  | "heritage"
  | "dcp"
  | "da"
  | "cdc"
  | "ssd"
  | "hda"
  | "sepp"
  | "lmr"
  | "tod"
  | "flood"
  | "bushfire"
  | "biodiversity"
  | "contamination"
  | "infrastructure"
  | "property_sales"
  | "planning_proposal"
  | "contributions";

export type PlanningAvailability =
  | "AVAILABLE_NOW"
  | "PUBLIC_SCRAPE_PARSE"
  | "PUBLIC_STRUCTURED_ENDPOINT"
  | "API_KEY_REQUIRED"
  | "LICENSE_REVIEW_REQUIRED"
  | "NOT_CURRENTLY_AVAILABLE";

export type PlanningSourceLevel = "NSW" | "council" | "federal" | "market";

export interface PlanningSourceEntry {
  id: string;
  name: string;
  jurisdiction: string;
  level: PlanningSourceLevel;
  dataTypes: PlanningDataType[];
  accessType: PlanningAccessType;
  baseUrl: string;
  requiresApiKey: boolean;
  commercialUseNote: string;
  refreshFrequency: string;
  /** Adapter / parser id when wired; null = registry-only. */
  parserAdapter: string | null;
  fallbackSourceId: string | null;
  lastSuccessfulFetch: string | null;
  lastFailure: string | null;
  provenanceLabel: string;
  availability: PlanningAvailability;
  notes?: string;
}

/**
 * Initial registry — current NSW sources + council planning concept.
 * Do not invent credentials. Commercial portals excluded.
 */
export const PLANNING_SOURCE_REGISTRY: PlanningSourceEntry[] = [
  {
    id: "nsw-epi-primary-planning",
    name: "NSW EPI Primary Planning Layers",
    jurisdiction: "NSW",
    level: "NSW",
    dataTypes: ["zoning", "fsr", "height", "minimum_lot", "heritage"],
    accessType: "ARCGIS",
    baseUrl: "https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/Planning/EPI_Primary_Planning_Layers/MapServer",
    requiresApiKey: false,
    commercialUseNote: "NSW Government open planning data — retain attribution; cache evidence",
    refreshFrequency: "weekly",
    parserAdapter: "existing:nsw-planning",
    fallbackSourceId: null,
    lastSuccessfulFetch: null,
    lastFailure: null,
    provenanceLabel: "LIVE / STORED OFFICIAL NSW PLANNING",
    availability: "AVAILABLE_NOW",
  },
  {
    id: "nsw-cadastre",
    name: "NSW Cadastre / Lot Property Theme",
    jurisdiction: "NSW",
    level: "NSW",
    dataTypes: ["cadastre"],
    accessType: "ARCGIS",
    baseUrl: "https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Cadastre/MapServer",
    requiresApiKey: false,
    commercialUseNote: "NSW Spatial Services open data",
    refreshFrequency: "weekly",
    parserAdapter: "existing:nsw-cadastre",
    fallbackSourceId: null,
    lastSuccessfulFetch: null,
    lastFailure: null,
    provenanceLabel: "NSW CADASTRE",
    availability: "AVAILABLE_NOW",
  },
  {
    id: "nsw-registered-sales",
    name: "NSW registered property sales",
    jurisdiction: "NSW",
    level: "NSW",
    dataTypes: ["property_sales"],
    accessType: "ARCGIS",
    baseUrl: "https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Property_Sales/MapServer",
    requiresApiKey: false,
    commercialUseNote: "NSW Valuer General / SIX — official registered sales",
    refreshFrequency: "weekly",
    parserAdapter: "existing:nsw-property-sales",
    fallbackSourceId: null,
    lastSuccessfulFetch: null,
    lastFailure: null,
    provenanceLabel: "NSW REGISTERED SALES",
    availability: "AVAILABLE_NOW",
  },
  {
    id: "nsw-sepp-housing-lmr",
    name: "Housing SEPP 2021 — Low & Mid-Rise Housing centres",
    jurisdiction: "NSW",
    level: "NSW",
    dataTypes: ["sepp", "lmr"],
    accessType: "ARCGIS",
    baseUrl: "https://www.planning.nsw.gov.au/",
    requiresApiKey: false,
    commercialUseNote: "State pathway — straight-line screen until walking-distance eligibility",
    refreshFrequency: "weekly",
    parserAdapter: "existing:housing-sepp-lmr",
    fallbackSourceId: "nsw-epi-primary-planning",
    lastSuccessfulFetch: null,
    lastFailure: null,
    provenanceLabel: "STATE PATHWAY · SCREENING / ESTIMATED",
    availability: "AVAILABLE_NOW",
  },
  {
    id: "nsw-planning-proposal-agency",
    name: "NSW Planning Proposal Agency layers",
    jurisdiction: "NSW",
    level: "NSW",
    dataTypes: ["planning_proposal"],
    accessType: "ARCGIS",
    baseUrl: "https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Proposal_Agency/MapServer",
    requiresApiKey: false,
    commercialUseNote: "Proposed / pending — never silent current LEP",
    refreshFrequency: "every_6_hours",
    parserAdapter: "existing:nsw-planning-proposals",
    fallbackSourceId: null,
    lastSuccessfulFetch: null,
    lastFailure: null,
    provenanceLabel: "PROPOSED / PENDING",
    availability: "AVAILABLE_NOW",
  },
  {
    id: "nsw-hda-records",
    name: "Housing Delivery Authority published records",
    jurisdiction: "NSW",
    level: "NSW",
    dataTypes: ["hda", "ssd"],
    accessType: "HTML",
    baseUrl: "https://www.planning.nsw.gov.au/the-planning-system/housing/housing-delivery-authority/published-records",
    requiresApiKey: false,
    commercialUseNote: "Public official pages/PDFs — parse where permitted; cache evidence",
    refreshFrequency: "every_6_hours",
    parserAdapter: "hda-live",
    fallbackSourceId: null,
    lastSuccessfulFetch: null,
    lastFailure: null,
    provenanceLabel: "HDA PUBLISHED RECORD",
    availability: "PUBLIC_SCRAPE_PARSE",
  },
  {
    id: "nsw-major-projects",
    name: "NSW Major Projects / SSD Application Tracker",
    jurisdiction: "NSW",
    level: "NSW",
    dataTypes: ["ssd", "da"],
    accessType: "HTML",
    baseUrl: "https://www.planningportal.nsw.gov.au/major-projects/projects",
    requiresApiKey: false,
    commercialUseNote: "Public listing scrape — cache, do not hit on every page load",
    refreshFrequency: "every_6_hours",
    parserAdapter: "major-projects-live",
    fallbackSourceId: null,
    lastSuccessfulFetch: null,
    lastFailure: null,
    provenanceLabel: "SSD / MAJOR PROJECTS",
    availability: "PUBLIC_SCRAPE_PARSE",
  },
  {
    id: "nsw-da-cdc-pcc",
    name: "NSW Planning Portal Online DA API",
    jurisdiction: "NSW",
    level: "NSW",
    dataTypes: ["da", "cdc"],
    accessType: "API",
    baseUrl: "https://api.apps1.nsw.gov.au/eplanning/data/v1/OnlineDA",
    requiresApiKey: true,
    commercialUseNote: "Requires NSW_ONLINE_DA_SUBSCRIPTION_KEY — do not invent credentials",
    refreshFrequency: "nightly",
    parserAdapter: "da-cdc-pcc-live",
    fallbackSourceId: null,
    lastSuccessfulFetch: null,
    lastFailure: null,
    provenanceLabel: "ONLINE DA (API KEY)",
    availability: "API_KEY_REQUIRED",
    notes: "Official APIM v1; subscription key required for production ingest",
  },
  {
    id: "nsw-tod-precincts",
    name: "Transport Oriented Development (TOD) precincts",
    jurisdiction: "NSW",
    level: "NSW",
    dataTypes: ["tod", "sepp"],
    accessType: "HTML",
    baseUrl: "https://www.planning.nsw.gov.au/",
    requiresApiKey: false,
    commercialUseNote: "Public official pages / map packs — parse + cache when geometry published",
    refreshFrequency: "weekly",
    parserAdapter: null,
    fallbackSourceId: "nsw-sepp-housing-lmr",
    lastSuccessfulFetch: null,
    lastFailure: null,
    provenanceLabel: "TOD (REGISTRY)",
    availability: "PUBLIC_STRUCTURED_ENDPOINT",
    notes: "Prefer official ArcGIS when published; HTML/PDF interim",
  },
  {
    id: "nsw-flood",
    name: "NSW flood planning / SES layers",
    jurisdiction: "NSW",
    level: "NSW",
    dataTypes: ["flood"],
    accessType: "ARCGIS",
    baseUrl: "https://www.ses.nsw.gov.au/",
    requiresApiKey: false,
    commercialUseNote: "Public hazard layers where published — license review per dataset",
    refreshFrequency: "monthly",
    parserAdapter: null,
    fallbackSourceId: null,
    lastSuccessfulFetch: null,
    lastFailure: null,
    provenanceLabel: "FLOOD (REGISTRY)",
    availability: "LICENSE_REVIEW_REQUIRED",
  },
  {
    id: "nsw-bushfire",
    name: "NSW Bush Fire Prone Land",
    jurisdiction: "NSW",
    level: "NSW",
    dataTypes: ["bushfire"],
    accessType: "ARCGIS",
    baseUrl: "https://www.rfs.nsw.gov.au/",
    requiresApiKey: false,
    commercialUseNote: "RFS / Planning bushfire prone land — open where published",
    refreshFrequency: "monthly",
    parserAdapter: null,
    fallbackSourceId: null,
    lastSuccessfulFetch: null,
    lastFailure: null,
    provenanceLabel: "BUSHFIRE (REGISTRY)",
    availability: "PUBLIC_STRUCTURED_ENDPOINT",
  },
  {
    id: "nsw-biodiversity",
    name: "NSW Biodiversity Values / BAM layers",
    jurisdiction: "NSW",
    level: "NSW",
    dataTypes: ["biodiversity"],
    accessType: "ARCGIS",
    baseUrl: "https://www.environment.nsw.gov.au/",
    requiresApiKey: false,
    commercialUseNote: "License review before commercial productisation",
    refreshFrequency: "monthly",
    parserAdapter: null,
    fallbackSourceId: null,
    lastSuccessfulFetch: null,
    lastFailure: null,
    provenanceLabel: "BIODIVERSITY (REGISTRY)",
    availability: "LICENSE_REVIEW_REQUIRED",
  },
  {
    id: "nsw-contamination",
    name: "EPA contaminated land public register",
    jurisdiction: "NSW",
    level: "NSW",
    dataTypes: ["contamination"],
    accessType: "HTML",
    baseUrl: "https://www.epa.nsw.gov.au/",
    requiresApiKey: false,
    commercialUseNote: "Public register — scrape/parse where permitted; cache",
    refreshFrequency: "monthly",
    parserAdapter: null,
    fallbackSourceId: null,
    lastSuccessfulFetch: null,
    lastFailure: null,
    provenanceLabel: "CONTAMINATION (REGISTRY)",
    availability: "PUBLIC_SCRAPE_PARSE",
  },
  {
    id: "council-lep-concept",
    name: "Council LEP / planning instrument (per LGA)",
    jurisdiction: "NSW councils",
    level: "council",
    dataTypes: ["zoning", "fsr", "height", "minimum_lot", "heritage"],
    accessType: "HTML",
    baseUrl: "https://legislation.nsw.gov.au/",
    requiresApiKey: false,
    commercialUseNote: "Prefer statewide EPI layers; council LEP pages as documentary fallback",
    refreshFrequency: "on_change",
    parserAdapter: null,
    fallbackSourceId: "nsw-epi-primary-planning",
    lastSuccessfulFetch: null,
    lastFailure: null,
    provenanceLabel: "COUNCIL LEP (CONCEPT)",
    availability: "PUBLIC_SCRAPE_PARSE",
    notes: "Concept entry — wire per-council only when EPI insufficient",
  },
  {
    id: "council-dcp-concept",
    name: "Council DCP / design & character controls",
    jurisdiction: "NSW councils",
    level: "council",
    dataTypes: ["dcp"],
    accessType: "PDF",
    baseUrl: "https://www.planningportal.nsw.gov.au/",
    requiresApiKey: false,
    commercialUseNote: "Official PDFs — download + parse with version/date/page evidence",
    refreshFrequency: "on_change",
    parserAdapter: null,
    fallbackSourceId: null,
    lastSuccessfulFetch: null,
    lastFailure: null,
    provenanceLabel: "COUNCIL DCP (CONCEPT)",
    availability: "PUBLIC_SCRAPE_PARSE",
  },
  {
    id: "council-da-register-concept",
    name: "Council DA / planning application registers",
    jurisdiction: "NSW councils",
    level: "council",
    dataTypes: ["da", "cdc"],
    accessType: "HTML",
    baseUrl: "https://www.planningportal.nsw.gov.au/",
    requiresApiKey: false,
    commercialUseNote: "Prefer statewide Online DA API when key available; council HTML interim",
    refreshFrequency: "nightly",
    parserAdapter: null,
    fallbackSourceId: "nsw-da-cdc-pcc",
    lastSuccessfulFetch: null,
    lastFailure: null,
    provenanceLabel: "COUNCIL DA REGISTER (CONCEPT)",
    availability: "PUBLIC_SCRAPE_PARSE",
  },
  {
    id: "council-contributions-concept",
    name: "Local contribution plans",
    jurisdiction: "NSW councils",
    level: "council",
    dataTypes: ["contributions", "infrastructure"],
    accessType: "PDF",
    baseUrl: "https://www.planningportal.nsw.gov.au/",
    requiresApiKey: false,
    commercialUseNote: "Official PDFs — versioned evidence store",
    refreshFrequency: "on_change",
    parserAdapter: null,
    fallbackSourceId: null,
    lastSuccessfulFetch: null,
    lastFailure: null,
    provenanceLabel: "CONTRIBUTIONS (CONCEPT)",
    availability: "PUBLIC_SCRAPE_PARSE",
  },
];

export function getPlanningSource(id: string): PlanningSourceEntry | undefined {
  return PLANNING_SOURCE_REGISTRY.find((s) => s.id === id);
}

export function planningSourcesByAvailability(status: PlanningAvailability): PlanningSourceEntry[] {
  return PLANNING_SOURCE_REGISTRY.filter((s) => s.availability === status);
}

export function planningSourcesScrapeableNow(): PlanningSourceEntry[] {
  return PLANNING_SOURCE_REGISTRY.filter(
    (s) =>
      s.availability === "AVAILABLE_NOW" ||
      s.availability === "PUBLIC_SCRAPE_PARSE" ||
      s.availability === "PUBLIC_STRUCTURED_ENDPOINT",
  );
}

export function planningSourcesNeedingKeysOrLicense(): PlanningSourceEntry[] {
  return PLANNING_SOURCE_REGISTRY.filter(
    (s) =>
      s.availability === "API_KEY_REQUIRED" ||
      s.availability === "LICENSE_REVIEW_REQUIRED" ||
      s.requiresApiKey,
  );
}
