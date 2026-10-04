import type { BBox } from "@/lib/types";
import type { UnitMixRow } from "@/lib/analysis/unit-mix";

/**
 * Neutral Bay Assembly Demo — five REAL adjoining cadastral lots (geometry, Lot/DP and planning are
 * retrieved from NSW Spatial Services and the NSW Planning Portal). Market values, owners, comps and
 * contact details below are FICTIONAL and always displayed as DEMO FINANCIAL DATA.
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
    marketValue: 1_650_000,
    owner: { name: "DEMO — J. & M. Example", ownerType: "Owner-occupier", notes: "Fictional demo owner. Long-term owners, downsizing interest (demo note)." },
    stage: "INTERESTED",
    approachNotes: "Demo: corner-adjacent lot with the largest area; owners indicated openness at the door.",
  },
  {
    lotIdString: "2//DP21192",
    marketValue: 1_450_000,
    owner: { name: "DEMO — Sample Holdings Pty Ltd", ownerType: "Investor", notes: "Fictional demo owner. Tenanted; lease expires in 8 months (demo note)." },
    stage: "LETTER_SENT",
    approachNotes: "Demo: investor owner, likely price-driven.",
  },
  {
    lotIdString: "3//DP21192",
    marketValue: 1_520_000,
    owner: { name: "DEMO — Estate of A. Placeholder", ownerType: "Estate / deceased", notes: "Fictional demo owner. Executor contact pending (demo note)." },
    stage: "OWNER_IDENTIFIED",
    approachNotes: "Demo: approach via executor's solicitor.",
  },
  {
    lotIdString: "4//DP21192",
    marketValue: 1_400_000,
    owner: { name: "DEMO — R. Testcase", ownerType: "Owner-occupier", notes: "Fictional demo owner (demo note)." },
    stage: "READY_TO_APPROACH",
    approachNotes: "",
  },
  {
    lotIdString: "1//DP78216",
    marketValue: 1_780_000,
    owner: { name: "DEMO — Unknown", ownerType: "Unknown", notes: "Fictional demo placeholder — owner not yet identified." },
    stage: "NOT_RESEARCHED",
    approachNotes: "",
  },
];

/** Fictional unit mix sized to the Neutral Bay demo site (~3,400–3,900 sqm saleable) with GRV ≈ $75m. */
export const DEMO_UNIT_MIX: UnitMixRow[] = [
  { name: "1 Bed", count: 10, avgInternalArea: 55, avgExternalArea: 8, avgSaleableArea: 58, salePricePerUnit: 1_100_000 },
  { name: "2 Bed", count: 24, avgInternalArea: 80, avgExternalArea: 12, avgSaleableArea: 88, salePricePerUnit: 1_650_000 },
  { name: "3 Bed", count: 8, avgInternalArea: 110, avgExternalArea: 15, avgSaleableArea: 125, salePricePerUnit: 2_450_000 },
  { name: "Penthouse", count: 1, avgInternalArea: 160, avgExternalArea: 40, avgSaleableArea: 180, salePricePerUnit: 4_200_000 },
];

/** Demo development assumptions — user assumptions testing an uplift over the mapped controls. */
export const DEMO_INPUTS = {
  overrides: {
    revenueMode: "UNIT_MIX" as const,
    salePricePerSqm: 17_500,
    siteCoverage: 0.5,
    efficiency: 0.82,
    planningAdjustment: 0.9,
    constructionCostPerSqm: 4_154,
    targetMarginOnCost: 0.2,
  },
  fsrOverride: 2.0,
  heightOverrideM: 18,
  unitMix: DEMO_UNIT_MIX,
  contactDetails: "0400 000 000 (demo)",
};

/** Fictional acquisition comps — clearly labelled DEMO / MANUAL. */
export const DEMO_ACQUISITION_COMPS = [
  { address: "8 Undercliff St, Neutral Bay (DEMO)", salePrice: 1_420_000, saleDate: "2025-06-12", bedrooms: 3, bathrooms: 1, parking: 1, landArea: 420, propertyType: "House", distanceM: 85, notes: "Fictional comparable — not a real sale." },
  { address: "24 Ben Boyd Rd, Neutral Bay (DEMO)", salePrice: 1_560_000, saleDate: "2025-09-03", bedrooms: 3, bathrooms: 2, parking: 1, landArea: 455, propertyType: "House", distanceM: 140, notes: "Fictional comparable — not a real sale." },
  { address: "7 Yeo St, Neutral Bay (DEMO)", salePrice: 1_380_000, saleDate: "2025-03-21", bedrooms: 2, bathrooms: 1, parking: 1, landArea: 380, propertyType: "House", distanceM: 210, notes: "Fictional comparable — not a real sale." },
];

/** Fictional exit / new-apartment comps — clearly labelled DEMO / MANUAL. */
export const DEMO_EXIT_COMPS = [
  { address: "Demo Residences — 1 Bed, Neutral Bay", salePrice: 1_100_000, saleDate: "2025-11-01", bedrooms: 1, bathrooms: 1, parking: 1, saleableArea: 58, unitType: "1 Bed", newBuildStatus: "NEW", notes: "Fictional exit comparable — not a real sale." },
  { address: "Demo Residences — 2 Bed, Neutral Bay", salePrice: 1_650_000, saleDate: "2025-10-15", bedrooms: 2, bathrooms: 2, parking: 1, saleableArea: 88, unitType: "2 Bed", newBuildStatus: "NEW", notes: "Fictional exit comparable — not a real sale." },
  { address: "Demo Residences — 2 Bed corner, Cremorne", salePrice: 1_720_000, saleDate: "2025-08-20", bedrooms: 2, bathrooms: 2, parking: 1, saleableArea: 92, unitType: "2 Bed", newBuildStatus: "RECENTLY_COMPLETED", notes: "Fictional exit comparable — not a real sale." },
  { address: "Demo Residences — 3 Bed, Neutral Bay", salePrice: 2_450_000, saleDate: "2025-09-28", bedrooms: 3, bathrooms: 2, parking: 2, saleableArea: 125, unitType: "3 Bed", newBuildStatus: "NEW", notes: "Fictional exit comparable — not a real sale." },
  { address: "Demo Residences — Penthouse, Neutral Bay", salePrice: 4_200_000, saleDate: "2025-07-10", bedrooms: 3, bathrooms: 3, parking: 2, saleableArea: 180, unitType: "Penthouse", newBuildStatus: "NEW", notes: "Fictional exit comparable — not a real sale." },
];

export const DEMO_NOTES =
  "DEMO FINANCIAL DATA: parcel boundaries, Lot/DP and planning controls are real NSW data; market values, owners, comparable sales and notes are fictional. " +
  "Mapped controls are R3 Medium Density Residential with an 8.5 m height limit and no mapped FSR. The yield uses a USER ASSUMPTION of FSR 2.0:1 and 18 m height " +
  "with a 90% planning adjustment to test a planning-proposal scenario — it does not reflect current permissible development. " +
  "Primary revenue method is UNIT MIX (not $/sqm). Acquisition Headroom = Max Payable to Owners − Combined Existing Property Value.";
