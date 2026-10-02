"use client";

import { useState } from "react";
import { useOpportunity } from "./context";
import { LotsMap } from "./lots-map";
import { SCORE_WEIGHTS } from "@/lib/analysis/assembly";
import { STAGE_LABELS } from "@/lib/constants";
import { fsr, lotDp, money, num, pct, sqm } from "@/lib/format";
import { Badge, DemoFinancialBadge, Panel, Stat, TextArea, cx } from "@/components/ui";

const COMPONENT_LABELS: Record<keyof typeof SCORE_WEIGHTS, string> = {
  acquisitionHeadroom: "Acquisition headroom",
  developmentUplift: "Development uplift",
  planningCapacity: "Planning capacity",
  simplicity: "Assembly simplicity",
  geometry: "Site geometry / connectivity",
  planningRisk: "Planning risk",
};

export function OverviewTab() {
  const { dto, analysis, updateLot, updateOpportunity } = useOpportunity();
  const [selected, setSelected] = useState<string | null>(null);
  const f = analysis.base.feasibility;
  const y = analysis.base.yield;
  const mv = analysis.combinedExistingValue;
  const maxPay = analysis.maxPayableToOwners;
  const headroom = analysis.acquisitionHeadroom;
  const maxBar = Math.max(mv, maxPay, 1);
  const crit = new Map(analysis.critical.map((c) => [c.id, c]));
  const alloc = new Map(analysis.allocation.lots.map((l) => [l.id, l]));
  const marginal = new Map(analysis.marginal.map((m) => [m.id, m]));

  return (
    <div className="grid grid-cols-12 gap-4">
      <div className="col-span-7 space-y-4">
        <Panel title="Opportunity summary" actions={dto.demoFinancialData ? <DemoFinancialBadge /> : null}>
          <div className="grid grid-cols-4 gap-5">
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">Site</div>
              <div className="mt-1 text-[13px] leading-relaxed">
                <div className="font-semibold">
                  {analysis.includedIds.length} lots · {sqm(analysis.site.siteAreaSqm)}
                </div>
                <div className="text-muted">FSR {fsr(analysis.site.fsr)}</div>
              </div>
            </div>
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">Acquisition</div>
              <div className="mt-1 space-y-0.5 text-[13px]">
                <div>
                  Existing combined value: <span className="num font-semibold">{money(mv, { compact: true })}</span>
                </div>
                <div>
                  Max payable to owners: <span className="num font-semibold text-brand">{money(maxPay, { compact: true })}</span>
                </div>
                <div>
                  Acquisition headroom: <span className="num font-semibold text-good">{money(headroom, { compact: true })}</span>
                </div>
                <div className="text-muted">Indicative owner premium capacity: {pct(analysis.acquisitionHeadroomPercent, 0, true)}</div>
              </div>
            </div>
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">Development</div>
              <div className="mt-1 space-y-0.5 text-[13px]">
                <div className="font-semibold">{num(y.dwellings)} dwellings</div>
                <div className="text-muted">{sqm(y.saleableArea)} saleable</div>
                <div>
                  GRV <span className="num font-semibold">{money(f.grv, { compact: true })}</span>
                </div>
              </div>
            </div>
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">Financial</div>
              <div className="mt-1 space-y-0.5 text-[13px]">
                <div>
                  Costs before land: <span className="num font-semibold">{money(f.nonLandCosts, { compact: true })}</span>
                </div>
                <div>
                  Target profit: <span className="num font-semibold">{money(f.profit, { compact: true })}</span>
                </div>
                <div className="text-muted">{pct(f.marginOnCost)} MOC</div>
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Why this assembly creates value" actions={dto.demoFinancialData ? <DemoFinancialBadge /> : null}>
          <div className="grid grid-cols-4 gap-4">
            <Stat label="Combined existing property value" value={money(mv, { compact: true })} sub={analysis.marketValueComplete ? `${analysis.includedIds.length} lots, as entered` : "Enter values on Acquisition / Comparables"} />
            <Stat label="Maximum payable to owners" value={money(maxPay, { compact: true })} tone="brand" sub="Development-supported acquisition budget" />
            <Stat label="Acquisition headroom" value={money(headroom, { compact: true })} tone={headroom > 0 ? "good" : "bad"} sub={mv > 0 ? `${pct(analysis.acquisitionHeadroomPercent, 0, true)} over existing value` : "—"} />
            <Stat label="Assembly uplift" value={money(analysis.assemblyUplift, { compact: true })} sub="Value created by assembling (before negotiation)" />
          </div>
          <div className="mt-5 space-y-2">
            <Bar label="Existing homes — combined market value" value={mv} max={maxBar} className="bg-stone-400" />
            <Bar label="Maximum payable to owners" value={maxPay} max={maxBar} className="bg-brand" />
          </div>
          <p className="mt-4 text-[12px] leading-relaxed text-muted">
            Individually these are {analysis.includedIds.length} properties worth about {money(mv, { compact: true })}. Assembled into a {sqm(analysis.site.siteAreaSqm)} site supporting ~
            {y.dwellings} dwellings ({sqm(y.achievableGfa)} achievable GFA), the residual supports paying up to {money(maxPay, { compact: true })} while still achieving a{" "}
            {pct(analysis.base.assumptions.targetMarginOnCost, 0)} margin on cost — headroom of {money(headroom, { compact: true })}.
          </p>
        </Panel>

        <Panel title="Lots in assembly" bodyClassName="p-0">
          <table className="w-full text-[12px]">
            <thead className="bg-canvas text-[10.5px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2 text-left">Include</th>
                <th className="px-3 py-2 text-left">Property</th>
                <th className="px-3 py-2 text-right">Area</th>
                <th className="px-3 py-2 text-right">Existing value</th>
                <th className="px-3 py-2 text-right">Max offer</th>
                <th className="px-3 py-2 text-right">Neg. headroom</th>
                <th className="px-3 py-2 text-left">Marginal</th>
                <th className="px-3 py-2 text-left">Role</th>
                <th className="px-3 py-2 text-left">Stage</th>
              </tr>
            </thead>
            <tbody>
              {dto.lots.map((l) => {
                const c = crit.get(l.id);
                const m = marginal.get(l.id);
                const al = alloc.get(l.id);
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
                    <td className="num px-3 py-2 text-right">{money(l.marketValue, { compact: true })}</td>
                    <td className="num px-3 py-2 text-right">{l.included ? money(al?.maximumOffer, { compact: true }) : "—"}</td>
                    <td className="num px-3 py-2 text-right">{l.included ? money(al?.negotiationHeadroom, { compact: true }) : "—"}</td>
                    <td className="px-3 py-2">
                      {!l.included ? (
                        <Badge>Excluded</Badge>
                      ) : m?.verdict === "DESTROYS_VALUE" ? (
                        <Badge tone="bad">Destroys value</Badge>
                      ) : m?.verdict === "HIGH_VALUE" ? (
                        <Badge tone="good">High value</Badge>
                      ) : (
                        <Badge>Neutral</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">{!l.included ? <Badge>Excluded</Badge> : c?.status === "CRITICAL" ? <Badge tone="bad">Critical</Badge> : <Badge tone="good">Optional</Badge>}</td>
                    <td className="px-3 py-2 text-[11.5px]">{STAGE_LABELS[l.acquisitionStage]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="border-t border-line px-3 py-2 text-[11px] text-muted">Untick a lot to test the project without it — every figure recalculates. Marginal verdict compares what the lot adds to max payable vs its existing market value.</p>
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
              <div key={k} className="grid grid-cols-[170px_1fr_70px] items-center gap-2 text-[11.5px]">
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
            <Stat size="md" label="FSR used" value={analysis.site.fsrSource === "NO_MAPPED" ? "—" : fsr(analysis.site.fsr)} sub={analysis.site.fsrSource === "OVERRIDE" ? "USER ASSUMPTION" : analysis.site.fsrSource === "OFFICIAL" ? "OFFICIAL MAPPED FSR" : "NO MAPPED FSR"} />
            <Stat size="md" label="Theoretical GFA" value={sqm(y.theoreticalGfa)} sub="Site × FSR" />
            <Stat size="md" label="Achievable GFA" value={sqm(y.achievableGfa)} sub={y.gfaSource === "OVERRIDE" ? "Manual override" : `${Math.round(y.planningAdjustment * 100)}% planning adj.`} />
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
