/**
 * Deterministic "why it matters" engine — structured rules, not vague AI copy.
 */

import type { DevelopmentActivity } from "./development-activity";
import type { KeySiteHit, ProposedPlanningFindFields } from "./types";

export type WhyItMattersKind =
  | "PROPOSED_FSR_UPLIFT"
  | "PROPOSED_HEIGHT_UPLIFT"
  | "KEY_SITE"
  | "DA_NEARBY"
  | "HDA_NEARBY"
  | "SSD_NEARBY"
  | "FINANCIAL_HEADROOM"
  | "PLANNING_CHANGE"
  | "SITE_SIZE"
  | "STATION_PROXIMITY"
  | "NOT_STRATA"
  | "OTHER";

export interface WhyItMattersItem {
  kind: WhyItMattersKind;
  title: string;
  body: string;
  matched?: boolean;
}

export function theoreticalGfaIncreaseSqm(
  siteAreaSqm: number | null | undefined,
  currentFsr: number | null | undefined,
  proposedFsr: number | null | undefined,
): number | null {
  if (siteAreaSqm == null || currentFsr == null || proposedFsr == null) return null;
  if (!(proposedFsr > currentFsr)) return null;
  return Math.round(siteAreaSqm * (proposedFsr - currentFsr));
}

export function whyProposedFsrUplift(input: {
  currentFsr: number | null | undefined;
  proposedFsr: number | null | undefined;
  siteAreaSqm?: number | null;
}): WhyItMattersItem | null {
  if (input.currentFsr == null || input.proposedFsr == null) return null;
  if (!(input.proposedFsr > input.currentFsr)) return null;
  const gfa = theoreticalGfaIncreaseSqm(input.siteAreaSqm, input.currentFsr, input.proposedFsr);
  return {
    kind: "PROPOSED_FSR_UPLIFT",
    title: "Proposed FSR uplift",
    body:
      `Current FSR ${input.currentFsr} → Proposed FSR ${input.proposedFsr}` +
      (gfa != null ? `. Potential theoretical GFA increase: +${gfa.toLocaleString("en-AU")} sqm.` : "."),
    matched: true,
  };
}

export function whyKeySite(hit: KeySiteHit | null | undefined): WhyItMattersItem | null {
  if (!hit) return null;
  const req = hit.requiredCount;
  return {
    kind: "KEY_SITE",
    title: "Key Site",
    body:
      `Higher incentive controls require ${req} parcel${req === 1 ? "" : "s"}` +
      (hit.yourPropertyIndex != null ? ` (your parcel is ${hit.yourPropertyIndex} of ${req}).` : "."),
    matched: true,
  };
}

export function whyNearbyActivity(activity: DevelopmentActivity): WhyItMattersItem {
  const dist = activity.distanceM != null ? ` ${activity.distanceM}m away` : "";
  if (activity.type === "HDA") {
    return {
      kind: "HDA_NEARBY",
      title: "HDA",
      body:
        (activity.dwellings != null ? `${activity.dwellings}-home proposal` : "HDA proposal") +
        dist +
        (activity.recommendation ? ` — ${activity.recommendation}` : "") +
        (activity.status === "RECOMMENDED" ? " recommended for SSD pathway." : "."),
      matched: true,
    };
  }
  if (activity.type === "SSD") {
    return {
      kind: "SSD_NEARBY",
      title: "SSD / Major Project",
      body: `${activity.developmentType ?? activity.description ?? "Major project"}${dist}. Status: ${activity.status}.`,
      matched: true,
    };
  }
  const storeyBit = activity.storeys != null ? `${activity.storeys}-storey ` : "";
  const dwellBit = activity.dwellings != null ? `${activity.dwellings} apartments` : activity.developmentType ?? "development";
  return {
    kind: "DA_NEARBY",
    title: activity.status === "APPROVED" ? "DA approved nearby" : "DA nearby",
    body: `${storeyBit}${dwellBit}${dist}${activity.determinedAt ? ` · ${activity.determinedAt.slice(0, 10)}` : ""}.`,
    matched: true,
  };
}

export function whyFinancialHeadroom(headroom: number | null | undefined): WhyItMattersItem | null {
  if (headroom == null) return null;
  const sign = headroom >= 0 ? "+" : "−";
  const abs = Math.abs(headroom);
  const compact =
    abs >= 1_000_000 ? `$${(abs / 1_000_000).toFixed(1)}m` : abs >= 1000 ? `$${Math.round(abs / 1000)}k` : `$${Math.round(abs)}`;
  return {
    kind: "FINANCIAL_HEADROOM",
    title: "Financial",
    body: `Current quick feasibility: ${sign}${compact} acquisition headroom.`,
    matched: headroom > 0,
  };
}

export function findMatchReasons(input: {
  fields: ProposedPlanningFindFields;
  siteAreaSqm?: number | null;
  currentFsr?: number | null;
  minSiteArea?: number | null;
  maxStationDistanceM?: number | null;
  stationDistanceM?: number | null;
  isStrata?: boolean | null;
  excludeStrata?: boolean | null;
  headroom?: number | null;
  requirePositiveHeadroom?: boolean | null;
}): WhyItMattersItem[] {
  const items: WhyItMattersItem[] = [];
  const uplift = whyProposedFsrUplift({
    currentFsr: input.currentFsr,
    proposedFsr: input.fields.proposedFsr,
    siteAreaSqm: input.siteAreaSqm,
  });
  if (uplift) items.push(uplift);
  else if (input.fields.insidePlanningChangeArea) {
    items.push({
      kind: "PLANNING_CHANGE",
      title: "Inside planning change area",
      body: `Status: ${input.fields.planningChangeStatus ?? "monitored"}.`,
      matched: true,
    });
  }
  if (input.fields.keySiteId) {
    items.push({
      kind: "KEY_SITE",
      title: "Key Site assembly",
      body: `Key site ${input.fields.keySiteId}${input.fields.requiredParcelCount != null ? ` · ${input.fields.requiredParcelCount} parcels required` : ""}.`,
      matched: true,
    });
  }
  if (input.minSiteArea != null && input.siteAreaSqm != null && input.siteAreaSqm >= input.minSiteArea) {
    items.push({
      kind: "SITE_SIZE",
      title: `>${input.minSiteArea} sqm`,
      body: `Site area ${Math.round(input.siteAreaSqm)} sqm.`,
      matched: true,
    });
  }
  if (
    input.maxStationDistanceM != null &&
    input.stationDistanceM != null &&
    input.stationDistanceM <= input.maxStationDistanceM
  ) {
    items.push({
      kind: "STATION_PROXIMITY",
      title: `<${input.maxStationDistanceM}m station`,
      body: `${Math.round(input.stationDistanceM)}m from nominated centre / station sample.`,
      matched: true,
    });
  }
  if (input.excludeStrata && input.isStrata === false) {
    items.push({ kind: "NOT_STRATA", title: "Not strata", body: "Title is not a strata scheme.", matched: true });
  }
  const fin = whyFinancialHeadroom(input.headroom);
  if (fin && (input.requirePositiveHeadroom ? fin.matched : true)) items.push(fin);
  return items;
}

export function summariseIntelEvent(input: {
  kind: string;
  title: string;
  summary?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  siteAreaSqm?: number | null;
}): WhyItMattersItem {
  const nv = input.newValue as Record<string, unknown> | null | undefined;
  const ov = input.oldValue as Record<string, unknown> | null | undefined;
  if (input.kind.includes("FSR") || (nv && ("fsr" in (nv as object) || "proposedFsr" in (nv as object)))) {
    const from = (ov?.fsr ?? ov?.proposedFsr) as number | undefined;
    const to = (nv?.fsr ?? nv?.proposedFsr ?? nv?.incentiveFsr) as number | undefined;
    if (typeof from === "number" && typeof to === "number") {
      const gfa = theoreticalGfaIncreaseSqm(input.siteAreaSqm, from, to);
      return {
        kind: "PROPOSED_FSR_UPLIFT",
        title: "Proposed FSR change",
        body:
          `Proposed FSR ${from} → ${to}` +
          (gfa != null ? `. Potential theoretical GFA increase: +${gfa.toLocaleString("en-AU")} sqm.` : "."),
      };
    }
  }
  if (input.kind.includes("KEY_SITE") || input.kind.includes("ASSEMBLY")) {
    return {
      kind: "KEY_SITE",
      title: "Key site / assembly",
      body: input.summary ?? input.title,
    };
  }
  return {
    kind: "PLANNING_CHANGE",
    title: input.title,
    body: input.summary ?? "Monitored planning intelligence change.",
  };
}
