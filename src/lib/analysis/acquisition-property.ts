/**
 * Acquisition property vs cadastral lot.
 * Multiple cadastral lots may form one physical/saleable property (same address).
 * Value the whole property — never MAX-of-lot AVMs and never sum duplicate house AVMs.
 */

import type { CompSaleInput } from "./comparable-valuation";
import { estimatePropertyLevelValue } from "./property-level-valuation";

export interface CadastralLotRef {
  id: string;
  address: string | null;
  areaSqm: number;
  marketValue: number | null;
  marketValueLow?: number | null;
  marketValueHigh?: number | null;
  marketValueSource?: string | null;
  marketValueConfidence?: string | null;
  marketValueMethod?: string | null;
  suburb?: string | null;
  zone?: string | null;
  isStrata?: boolean;
  /** Stored NSW comps for property-level re-estimate on combined land area. */
  comps?: CompSaleInput[] | null;
}

export interface AcquisitionProperty {
  id: string;
  label: string;
  address: string | null;
  lotIds: string[];
  areaSqm: number;
  /** Mid acquisition value at property level (one estimate for the whole property). */
  marketValue: number | null;
  marketValueLow: number | null;
  marketValueHigh: number | null;
  /** How the property value was derived. */
  valueBasis:
    | "SINGLE_LOT"
    | "PROPERTY_LEVEL_COMPS"
    | "PROPERTY_LEVEL_AVM"
    | "SUM_DISTINCT_ADDRESSES"
    | "INCOMPLETE";
  note: string | null;
  sourceLabel: string | null;
}

function normAddress(address: string | null | undefined): string | null {
  if (!address?.trim()) return null;
  return address
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/,/g, "");
}

function poolComps(members: CadastralLotRef[]): CompSaleInput[] {
  const byId = new Map<string, CompSaleInput>();
  for (const m of members) {
    for (const c of m.comps ?? []) {
      if (!byId.has(c.id)) byId.set(c.id, c);
    }
  }
  return [...byId.values()];
}

/**
 * Whole-property estimate for shared-address cadastral lots.
 * Uses pooled registered-sale comps against combined land area.
 */
export function estimateWholePropertyValue(members: CadastralLotRef[]): {
  mid: number | null;
  low: number | null;
  high: number | null;
  valueBasis: AcquisitionProperty["valueBasis"];
  note: string | null;
  sourceLabel: string | null;
  numberOfComps: number;
} {
  const areaSqm = members.reduce((s, m) => s + m.areaSqm, 0);
  const suburb = members.find((m) => m.suburb)?.suburb ?? null;
  const zone = members.find((m) => m.zone)?.zone ?? null;
  const isStrata = members.some((m) => m.isStrata);
  const comps = poolComps(members);
  const methods = members.map((m) => m.marketValueMethod ?? "");
  const mids = members.map((m) => m.marketValue).filter((v): v is number => v != null && v > 0);

  // A whole-property result may be stamped onto each cadastral row for storage.
  // Consume that single estimate before attempting to rebuild it from the truncated
  // per-lot comp payload.
  if (
    mids.length === members.length &&
    (methods.some((method) => method.includes("property_level")) || mids.every((value) => value === mids[0]))
  ) {
    const lows = members.map((m) => m.marketValueLow).filter((v): v is number => v != null && v > 0);
    const highs = members.map((m) => m.marketValueHigh).filter((v): v is number => v != null && v > 0);
    return {
      mid: mids[0]!,
      low: lows[0] ?? null,
      high: highs[0] ?? null,
      valueBasis: "PROPERTY_LEVEL_AVM",
      note: `${members.length} cadastral lots share one address — one stored whole-property estimate applied once.`,
      sourceLabel: members[0]?.marketValueSource ?? "Property-level market estimate (shared address)",
      numberOfComps: 0,
    };
  }

  if (comps.length >= 3 && areaSqm > 0) {
    const built = estimatePropertyLevelValue({
      areaSqm,
      suburb,
      zone,
      isStrata,
      sales: comps,
    });
    if (built.mid != null) {
      const sourceLabel =
        built.methodDetail === "LOCAL_LAND_RATE"
          ? "NSW registered comps — property-level (local land rate × combined area)"
          : "NSW registered comps — property-level (combined land area)";
      return {
        mid: built.mid,
        low: built.low,
        high: built.high,
        valueBasis: "PROPERTY_LEVEL_COMPS",
        note: `${members.length} cadastral lots share one address — valued as one property on combined ${Math.round(areaSqm)} sqm (${built.numberOfComps} sales, ${built.methodDetail}).`,
        sourceLabel,
        numberOfComps: built.numberOfComps,
      };
    }
  }

  return {
    mid: null,
    low: null,
    high: null,
    valueBasis: "INCOMPLETE",
    note: `${members.length} cadastral lots share one address — property-level estimate required (lot AVMs not summed or maxed).`,
    sourceLabel: null,
    numberOfComps: 0,
  };
}

/**
 * Group included cadastral lots into acquisition properties.
 * Same normalised street address → one property valued as a whole.
 */
export function groupAcquisitionProperties(lots: CadastralLotRef[]): AcquisitionProperty[] {
  const groups = new Map<string, CadastralLotRef[]>();
  for (const lot of lots) {
    const key = normAddress(lot.address) ?? `lot:${lot.id}`;
    const g = groups.get(key) ?? [];
    g.push(lot);
    groups.set(key, g);
  }

  const properties: AcquisitionProperty[] = [];
  for (const [key, members] of groups) {
    const address = members.find((m) => m.address)?.address ?? null;
    const areaSqm = members.reduce((s, m) => s + m.areaSqm, 0);

    if (members.length === 1) {
      const m = members[0]!;
      properties.push({
        id: `acq:${key}`,
        label: address ?? m.id,
        address,
        lotIds: [m.id],
        areaSqm,
        marketValue: m.marketValue,
        marketValueLow: m.marketValueLow ?? null,
        marketValueHigh: m.marketValueHigh ?? null,
        valueBasis: m.marketValue != null ? "SINGLE_LOT" : "INCOMPLETE",
        note: null,
        sourceLabel: m.marketValueSource ?? null,
      });
      continue;
    }

    const whole = estimateWholePropertyValue(members);
    properties.push({
      id: `acq:${key}`,
      label: address ?? members.map((m) => m.id).join(" + "),
      address,
      lotIds: members.map((m) => m.id),
      areaSqm,
      marketValue: whole.mid,
      marketValueLow: whole.low,
      marketValueHigh: whole.high,
      valueBasis: whole.valueBasis,
      note: whole.note,
      sourceLabel: whole.sourceLabel,
    });
  }

  return properties;
}

/** Combined existing acquisition value at property level. */
export function acquisitionPropertyTotal(properties: AcquisitionProperty[]): {
  mid: number | null;
  low: number | null;
  high: number | null;
  complete: boolean;
  notes: string[];
} {
  const notes = properties.map((p) => p.note).filter(Boolean) as string[];
  if (!properties.length || properties.some((p) => p.marketValue == null)) {
    return { mid: null, low: null, high: null, complete: false, notes };
  }
  return {
    mid: properties.reduce((s, p) => s + (p.marketValue as number), 0),
    low: properties.every((p) => p.marketValueLow != null)
      ? properties.reduce((s, p) => s + (p.marketValueLow as number), 0)
      : null,
    high: properties.every((p) => p.marketValueHigh != null)
      ? properties.reduce((s, p) => s + (p.marketValueHigh as number), 0)
      : null,
    complete: true,
    notes,
  };
}
