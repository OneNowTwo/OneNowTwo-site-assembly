/**
 * Acquisition property vs cadastral lot.
 * Multiple cadastral lots may form one physical/saleable property (same address).
 * Existing acquisition value should not double-count those lots as separate houses.
 */

export interface CadastralLotRef {
  id: string;
  address: string | null;
  areaSqm: number;
  marketValue: number | null;
  marketValueLow?: number | null;
  marketValueHigh?: number | null;
  marketValueSource?: string | null;
  marketValueConfidence?: string | null;
}

export interface AcquisitionProperty {
  id: string;
  label: string;
  address: string | null;
  lotIds: string[];
  areaSqm: number;
  /** Mid acquisition value at property level (not sum of duplicate house AVMs). */
  marketValue: number | null;
  marketValueLow: number | null;
  marketValueHigh: number | null;
  /** How the property value was derived from lot valuations. */
  valueBasis: "SINGLE_LOT" | "MAX_OF_SHARED_ADDRESS" | "SUM_DISTINCT_ADDRESSES" | "INCOMPLETE";
  note: string | null;
}

function normAddress(address: string | null | undefined): string | null {
  if (!address?.trim()) return null;
  return address
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/,/g, "");
}

/**
 * Group included cadastral lots into acquisition properties.
 * Same normalised street address → one property; value = max mid among lots
 * (avoids treating one dual-lot title as two houses).
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
    const mids = members.map((m) => m.marketValue).filter((v): v is number => v != null && v > 0);
    const lows = members.map((m) => m.marketValueLow).filter((v): v is number => v != null && v > 0);
    const highs = members.map((m) => m.marketValueHigh).filter((v): v is number => v != null && v > 0);

    let marketValue: number | null = null;
    let marketValueLow: number | null = null;
    let marketValueHigh: number | null = null;
    let valueBasis: AcquisitionProperty["valueBasis"] = "INCOMPLETE";
    let note: string | null = null;

    if (members.length === 1) {
      marketValue = mids[0] ?? null;
      marketValueLow = lows[0] ?? null;
      marketValueHigh = highs[0] ?? null;
      valueBasis = marketValue != null ? "SINGLE_LOT" : "INCOMPLETE";
    } else if (mids.length) {
      // Shared address → one acquisition property. Use the higher mid (same comps often
      // value the dual-lot holding once); do NOT sum as two separate dwellings.
      marketValue = Math.max(...mids);
      marketValueLow = lows.length ? Math.max(...lows) : null;
      marketValueHigh = highs.length ? Math.max(...highs) : null;
      valueBasis = "MAX_OF_SHARED_ADDRESS";
      note = `${members.length} cadastral lots share address — valued as one acquisition property (not sum of lot AVMs).`;
    }

    properties.push({
      id: `acq:${key}`,
      label: address ?? members.map((m) => m.id).join(" + "),
      address,
      lotIds: members.map((m) => m.id),
      areaSqm,
      marketValue,
      marketValueLow,
      marketValueHigh,
      valueBasis,
      note,
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
