import type { BBox } from "@/lib/types";

/**
 * Neutral Bay Assembly Demo — five REAL adjoining cadastral lots (geometry, Lot/DP and planning are
 * retrieved from NSW Spatial Services and the NSW Planning Portal). Market values, owners and contact
 * details below are FICTIONAL and always displayed as DEMO FINANCIAL DATA.
 */
export const DEMO_OPPORTUNITY_NAME = "Neutral Bay Assembly Demo";

export const DEMO_BBOX: BBox = { west: 151.2168, south: -33.8370, east: 151.2186, north: -33.8358 };

export const DEMO_LOTS: {
  lotIdString: string;
  marketValue: number;
  owner: { name: string; ownerType: string; notes: string };
  stage: "NOT_RESEARCHED" | "OWNER_IDENTIFIED" | "READY_TO_APPROACH" | "LETTER_SENT" | "CONTACT_MADE" | "INTERESTED";
  approachNotes: string;
}[] = [
  {
    lotIdString: "1//DP21192",
    marketValue: 1_480_000,
    owner: { name: "DEMO — J. & M. Example", ownerType: "Owner-occupier", notes: "Fictional demo owner. Long-term owners, downsizing interest (demo note)." },
    stage: "INTERESTED",
    approachNotes: "Demo: corner-adjacent lot with the largest area; owners indicated openness at the door.",
  },
  {
    lotIdString: "2//DP21192",
    marketValue: 1_250_000,
    owner: { name: "DEMO — Sample Holdings Pty Ltd", ownerType: "Investor", notes: "Fictional demo owner. Tenanted; lease expires in 8 months (demo note)." },
    stage: "LETTER_SENT",
    approachNotes: "Demo: investor owner, likely price-driven.",
  },
  {
    lotIdString: "3//DP21192",
    marketValue: 1_320_000,
    owner: { name: "DEMO — Estate of A. Placeholder", ownerType: "Estate / deceased", notes: "Fictional demo owner. Executor contact pending (demo note)." },
    stage: "OWNER_IDENTIFIED",
    approachNotes: "Demo: approach via executor's solicitor.",
  },
  {
    lotIdString: "4//DP21192",
    marketValue: 1_210_000,
    owner: { name: "DEMO — R. Testcase", ownerType: "Owner-occupier", notes: "Fictional demo owner (demo note)." },
    stage: "READY_TO_APPROACH",
    approachNotes: "",
  },
  {
    lotIdString: "1//DP78216",
    marketValue: 1_450_000,
    owner: { name: "DEMO — Unknown", ownerType: "Unknown", notes: "Fictional demo placeholder — owner not yet identified." },
    stage: "NOT_RESEARCHED",
    approachNotes: "",
  },
];

/** Demo development assumptions — user assumptions testing an uplift over the mapped controls. */
export const DEMO_INPUTS = {
  overrides: { salePricePerSqm: 17_500, siteCoverage: 0.5 },
  fsrOverride: 1.4,
  heightOverrideM: 12,
  contactDetails: "0400 000 000 (demo)",
};

export const DEMO_NOTES =
  "DEMO FINANCIAL DATA: parcel boundaries, Lot/DP and planning controls are real NSW data; market values, owners and notes are fictional. " +
  "Mapped controls are R3 Medium Density Residential with an 8.5 m height limit and no mapped FSR. The yield uses a USER ASSUMPTION of FSR 1.4:1 and 12 m height " +
  "to test a planning-proposal scenario — it does not reflect current permissible development.";
