"use client";

import { useState } from "react";
import { useOpportunity } from "./context";
import { LotsMap } from "./lots-map";
import { SCORE_WEIGHTS } from "@/lib/analysis/assembly";
import { STAGE_LABELS } from "@/lib/constants";
import { fsr, lotDp, money, num, pct, sqm } from "@/lib/format";
import { Badge, DemoFinancialBadge, Panel, Stat, TextArea, cx } from "@/components/ui";

const COMPONENT_LABELS: Record<keyof typeof SCORE_WEIGHTS, string> = {
  siteSize: "Site size",
  planningCapacity: "Planning capacity",
  simplicity: "Assembly simplicity",
  uplift: "Development uplift",
  constraints: "Planning constraints",
};

export function OverviewTab() {
  const { dto, analysis, updateLot, updateOpportunity } = useOpportunity();
  const [selected, setSelected] = useState<string | null>(null);
  const f = analysis.base.feasibility;
  const y = analysis.base.yield;
  const mv = analysis.combinedMarketValue;
  const budget = Math.max(0, f.maxAcquisitionBudget);
  const maxBar = Math.max(mv, budget, 1);
  const crit = new Map(analysis.critical.map((c) => [c.id, c]));
  const alloc = new Map(analysis.allocation.lots.map((l) => [l.id, l]));

  return (
    <div className="grid grid-cols-12 gap-4">
      <div className="col-span-7 space-y-4">
        <Panel title="Why this assembly creates value" actions={dto.demoFinancialData ? <DemoFinancialBadge /> : null}>
          <div className="grid grid-cols-4 gap-4">
            <Stat label="Combined market value" value={money(mv, { compact: true })} sub={analysis.marketValueComplete ? `${analysis.includedIds.length} lots, as entered` : "Enter values on Acquisition tab"} />
            <Stat label="Max acquisition budget" value={money(budget, { compact: true })} tone="brand" sub="What the project can pay owners" />
            <Stat label="Assembly premium" value={money(analysis.marketValueComplete ? budget - mv : null, { compact: true })} tone={budget - mv > 0 ? "good" : "bad"} sub={mv > 0 ? `${pct(budget / mv - 1, 0, true)} over market value` : "—"} />
            <Stat label="Profit at target" value={money(f.profit, { compact: true })} sub={`${pct(f.marginOnCost)} on cost`} />
          </div>
          <div className="mt-5 space-y-2">
            <Bar label="Sum of individual house values" value={mv} max={maxBar} className="bg-stone-400" />
            <Bar label="Value of the assembled site to a developer (max budget)" value={budget} max={maxBar} className="bg-brand" />
          </div>
          <p className="mt-4 text-[12px] leading-relaxed text-muted">
            Individually these are {analysis.includedIds.length} houses worth about {money(mv, { compact: true })}. Combined into a {sqm(analysis.site.siteAreaSqm)} site supporting {num(y.gfa)} sqm GFA (~{y.dwellings} dwellings), the residual land value
            supports paying up to {money(budget, { compact: true })} while still achieving a {pct(analysis.base.assumptions.targetBasis === "REVENUE" ? analysis.base.assumptions.targetMarginOnRevenue : analysis.base.assumptions.targetMarginOnCost, 0)} margin.
          </p>
        </Panel>

        <Panel title="Lots in assembly" bodyClassName="p-0">
          <table className="w-full text-[12px]">
            <thead className="bg-canvas text-[10.5px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2 text-left">Include</th>
                <th className="px-3 py-2 text-left">Property</th>
                <th className="px-3 py-2 text-right">Area</th>
                <th className="px-3 py-2 text-left">Zone</th>
                <th className="px-3 py-2 text-right">Est. value</th>
                <th className="px-3 py-2 text-right">Max offer</th>
                <th className="px-3 py-2 text-left">Role</th>
                <th className="px-3 py-2 text-left">Stage</th>
              </tr>
            </thead>
            <tbody>
              {dto.lots.map((l) => {
                const c = crit.get(l.id);
                return (
                  <tr key={l.id} className={cx("border-t border-line", selected === l.id && "bg-brand-soft/50", !l.included && "text-muted")} onClick={() => setSelected(l.id)}>
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={l.included} onChange={(e) => updateLot(l.id, { included: e.target.checked })} aria-label={`Include ${l.label}`} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{l.label}</div>
                      <div className="text-[11px] text-muted">{lotDp(l)}</div>
                    </td>
                    <td className="num px-3 py-2 text-right">{sqm(l.areaSqm)}</td>
                    <td className="px-3 py-2">{l.zone ?? "—"}</td>
                    <td className="num px-3 py-2 text-right">{money(l.marketValue, { compact: true })}</td>
                    <td className="num px-3 py-2 text-right">{l.included ? money(alloc.get(l.id)?.maximumOffer, { compact: true }) : "—"}</td>
                    <td className="px-3 py-2">{!l.included ? <Badge>Excluded</Badge> : c?.status === "CRITICAL" ? <Badge tone="bad">Critical</Badge> : <Badge tone="good">Optional</Badge>}</td>
                    <td className="px-3 py-2 text-[11.5px]">{STAGE_LABELS[l.acquisitionStage]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="border-t border-line px-3 py-2 text-[11px] text-muted">Untick a lot to test the project without it — every figure recalculates.</p>
        </Panel>

        <Panel title="Notes">
          <TextArea rows={4} value={dto.notes ?? ""} onCommit={(notes) => updateOpportunity({ notes })} placeholder="Opportunity notes" />
        </Panel>
      </div>

      <div className="col-span-5 space-y-4">
        <div className="h-[340px] overflow-hidden rounded-[3px] border border-line">
          <LotsMap lots={dto.lots} selectedId={selected} onSelect={setSelected} />
        </div>
        <Panel title={`Opportunity score · ${analysis.score.score}/100`}>
          <div className="space-y-1.5">
            {(Object.keys(SCORE_WEIGHTS) as (keyof typeof SCORE_WEIGHTS)[]).map((k) => (
              <div key={k} className="grid grid-cols-[150px_1fr_70px] items-center gap-2 text-[11.5px]">
                <span className="text-muted">
                  {COMPONENT_LABELS[k]} <span className="text-[10px]">({SCORE_WEIGHTS[k] * 100}%)</span>
                </span>
                <div className="h-1.5 rounded-full bg-canvas">
                  <div className="h-full rounded-full bg-brand" style={{ width: `${analysis.score.components[k]}%` }} />
                </div>
                <span className="num text-right">{Math.round(analysis.score.components[k])}/100</span>
              </div>
            ))}
          </div>
          <ul className="mt-3 space-y-0.5 text-[12px]">
            {analysis.score.factors.map((x) => (
              <li key={x.text} className={x.sign === "+" ? "text-good" : "text-bad"}>
                {x.sign === "+" ? "+" : "−"} {x.text}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Development summary (base case)">
          <div className="grid grid-cols-3 gap-4">
            <Stat size="md" label="FSR used" value={fsr(analysis.site.fsr)} sub={analysis.site.fsrSource === "OVERRIDE" ? "User assumption" : analysis.site.fsrSource === "OFFICIAL" ? "Official controls" : "Estimated"} />
            <Stat size="md" label="GFA" value={sqm(y.gfa)} />
            <Stat size="md" label="Dwellings" value={num(y.dwellings)} sub="Indicative only" />
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Bar({ label, value, max, className }: { label: string; value: number; max: number; className: string }) {
  return (
    <div>
      <div className="mb-0.5 flex justify-between text-[11.5px]">
        <span className="text-muted">{label}</span>
        <span className="num font-semibold">{money(value, { compact: true })}</span>
      </div>
      <div className="h-4 rounded-[2px] bg-canvas">
        <div className={cx("h-full rounded-[2px]", className)} style={{ width: `${Math.max(0, (value / max) * 100)}%` }} />
      </div>
    </div>
  );
}
