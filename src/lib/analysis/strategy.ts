import type { CriticalLotResult } from "./critical";

export interface StrategyLot {
  id: string;
  label: string;
  areaSqm: number;
  maximumPremium: number | null;
}

export interface StrategyStep {
  order: number;
  kind: "lot" | "milestone";
  lotId?: string;
  title: string;
  role?: "Critical connector" | "Critical" | "Optional";
  rationale: string;
}

/**
 * Indicative approach order. Critical connectors first (a holdout there breaks the site), then other
 * critical lots by centrality and size, a "secure the core" milestone, then optional lots by area.
 * Larger modelled premiums are approached earlier within a tier — more headroom to secure early agreement.
 */
export function buildAcquisitionSequence(lots: StrategyLot[], critical: CriticalLotResult[]): StrategyStep[] {
  const crit = new Map(critical.map((c) => [c.id, c]));
  const totalArea = lots.reduce((s, l) => s + l.areaSqm, 0) || 1;
  const priority = (l: StrategyLot) => {
    const c = crit.get(l.id);
    return (
      (c?.connector ? 1000 : 0) +
      (c?.status === "CRITICAL" ? 500 : 0) +
      (c?.degree ?? 0) * 40 +
      (l.areaSqm / totalArea) * 100 +
      Math.max(-1, Math.min(2, l.maximumPremium ?? 0)) * 10
    );
  };
  const ordered = [...lots].sort((a, b) => priority(b) - priority(a));
  const core = ordered.filter((l) => crit.get(l.id)?.status === "CRITICAL");
  const optional = ordered.filter((l) => crit.get(l.id)?.status !== "CRITICAL");

  const steps: StrategyStep[] = [];
  const premium = (l: StrategyLot) => (l.maximumPremium == null ? "" : `; modelled premium up to ${(l.maximumPremium * 100).toFixed(0)}% over value`);
  for (const l of core) {
    const c = crit.get(l.id)!;
    const role = c.connector ? "Critical connector" : "Critical";
    steps.push({
      order: steps.length + 1,
      kind: "lot",
      lotId: l.id,
      title: l.label,
      role,
      rationale: `${c.connector ? `Links ${c.degree} neighbouring lots — a holdout here fragments the site. ` : ""}${c.reasons[0]}${premium(l)}.`,
    });
  }
  if (core.length) {
    const coreArea = core.reduce((s, l) => s + l.areaSqm, 0);
    steps.push({
      order: steps.length + 1,
      kind: "milestone",
      title: "Secure the core",
      rationale: `Options/contracts over ${core.length} critical lot${core.length === 1 ? "" : "s"} (${Math.round(coreArea).toLocaleString("en-AU")} sqm, ${((coreArea / totalArea) * 100).toFixed(0)}% of site) before committing to optional lots.`,
    });
  }
  for (const l of optional) {
    const c = crit.get(l.id);
    steps.push({
      order: steps.length + 1,
      kind: "lot",
      lotId: l.id,
      title: `Optional — ${l.label}`,
      role: "Optional",
      rationale: `${c?.reasons[0] ?? "Project survives without it"}. Adds ${Math.round(l.areaSqm).toLocaleString("en-AU")} sqm${premium(l)}.`,
    });
  }
  return steps;
}
