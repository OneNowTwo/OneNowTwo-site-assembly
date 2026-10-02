"use client";

import { useOpportunity } from "./context";
import type { Assumptions, ScenarioAdjustment } from "@/lib/analysis/assumptions";
import type { ScenarioKey } from "@/lib/analysis/opportunity";
import { fsr, money, num, pct, sqm } from "@/lib/format";
import { Badge, DemoFinancialBadge, Field, NumberField, Panel, Select, SourceTag, Stat, cx } from "@/components/ui";

export function FeasibilityTab() {
  const { dto, analysis, a, updateOverrides, updateInputs } = useOpportunity();
  const base = analysis.base;
  const f = base.feasibility;
  const ov = dto.inputs.overrides as Partial<Assumptions>;
  const tag = (k: keyof Assumptions) => (ov[k] != null ? <SourceTag kind="ASSUMPTION" /> : <Badge>Global</Badge>);
  const pctField = (k: keyof Assumptions, label: string) => (
    <Field label={label} tag={tag(k)}>
      <NumberField kind="pct" value={a[k] as number} onCommit={(v) => updateOverrides({ [k]: v ?? undefined })} />
    </Field>
  );
  const moneyField = (k: keyof Assumptions, label: string) => (
    <Field label={label} tag={tag(k)}>
      <NumberField kind="money" value={a[k] as number} onCommit={(v) => updateOverrides({ [k]: v ?? undefined })} />
    </Field>
  );
  const tests = analysis.priceTests;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-6 gap-4 rounded-[3px] border border-line bg-white p-4">
        <Stat label="GRV" value={money(f.grv, { compact: true })} />
        <Stat label="Non-land costs" value={money(f.nonLandCosts, { compact: true })} />
        <Stat label="Residual land value" value={money(f.residualLandValue, { compact: true })} sub="Incl. duty, legal & land holding" />
        <Stat label="Max acquisition budget" value={money(f.maxAcquisitionBudget, { compact: true })} tone={f.viable ? "brand" : "bad"} sub="Payable to owners" />
        <Stat label="Profit" value={money(f.profit, { compact: true })} />
        <Stat label="Margin on cost" value={pct(f.marginOnCost)} sub={`${pct(f.marginOnRevenue)} on revenue`} />
      </div>
      {!f.viable && <div className="rounded-[3px] border border-red-200 bg-red-50 p-3 text-[12.5px] text-bad">At these assumptions the project cannot support any land cost at the target margin.</div>}

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-4 space-y-4">
          <Panel title="Revenue">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Revenue basis" tag={tag("revenueMode")}>
                <Select
                  value={a.revenueMode}
                  onChange={(v) => updateOverrides({ revenueMode: v })}
                  options={[
                    { value: "PER_SQM", label: "$/sqm saleable" },
                    { value: "PER_DWELLING", label: "$ per dwelling" },
                  ]}
                  className="w-full"
                />
              </Field>
              {a.revenueMode === "PER_SQM" ? moneyField("salePricePerSqm", "Sale price ($/sqm)") : moneyField("avgDwellingPrice", "Avg dwelling price")}
              {moneyField("otherRevenue", "Other revenue")}
            </div>
          </Panel>
          <Panel title="Costs">
            <div className="grid grid-cols-2 gap-3">
              {moneyField("constructionCostPerSqm", "Construction ($/sqm GFA)")}
              {moneyField("demolitionPerLot", "Demolition (per lot)")}
              {pctField("consultantsPct", "Consultants (% constr.)")}
              {moneyField("statutoryFeesPerDwelling", "Statutory fees / dwelling")}
              {pctField("marketingPct", "Marketing (% GRV)")}
              {pctField("sellingCostPct", "Selling (% GRV)")}
              {pctField("contingencyPct", "Contingency")}
              {pctField("financePct", "Dev. finance (% costs)")}
              {pctField("acquisitionCostPct", "Acquisition costs (% price)")}
              {pctField("landFinancePct", "Land holding (% price)")}
              {moneyField("otherCosts", "Other costs")}
            </div>
          </Panel>
          <Panel title="Profit target">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Solve on" tag={tag("targetBasis")}>
                <Select
                  value={a.targetBasis}
                  onChange={(v) => updateOverrides({ targetBasis: v })}
                  options={[
                    { value: "COST", label: "Margin on cost" },
                    { value: "REVENUE", label: "Margin on revenue" },
                  ]}
                  className="w-full"
                />
              </Field>
              {a.targetBasis === "COST" ? pctField("targetMarginOnCost", "Target margin on cost") : pctField("targetMarginOnRevenue", "Target margin on revenue")}
            </div>
          </Panel>
        </div>

        <div className="col-span-8 space-y-4">
          <Panel title="Development costs (base case)" bodyClassName="p-0">
            <table className="num w-full text-[12px]">
              <thead className="bg-canvas text-[10.5px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2 text-left">Item</th>
                  <th className="px-3 py-2 text-left">Basis</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-right">% GRV</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-line">
                  <td className="px-3 py-1.5 font-semibold">Gross realisation value</td>
                  <td className="px-3 py-1.5 text-muted">
                    {a.revenueMode === "PER_SQM" ? `${sqm(base.yield.saleableArea)} × ${money(a.salePricePerSqm)}/sqm` : `${base.yield.dwellings} × ${money(a.avgDwellingPrice)}`}
                  </td>
                  <td className="px-3 py-1.5 text-right font-semibold">{money(f.grv)}</td>
                  <td className="px-3 py-1.5 text-right">100%</td>
                </tr>
                {f.costLines.map((c) => (
                  <tr key={c.key} className="border-t border-line">
                    <td className="px-3 py-1.5">{c.label}</td>
                    <td className="px-3 py-1.5 text-muted">{c.basis}</td>
                    <td className="px-3 py-1.5 text-right">{money(c.amount)}</td>
                    <td className="px-3 py-1.5 text-right text-muted">{pct(f.grv ? c.amount / f.grv : 0)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-ink/20 bg-canvas/60">
                  <td className="px-3 py-1.5 font-semibold">Total cost before land (C)</td>
                  <td />
                  <td className="px-3 py-1.5 text-right font-semibold">{money(f.nonLandCosts)}</td>
                  <td className="px-3 py-1.5 text-right">{pct(f.grv ? f.nonLandCosts / f.grv : 0)}</td>
                </tr>
                <tr className="border-t border-line">
                  <td className="px-3 py-1.5">Land purchase price (max budget P)</td>
                  <td className="px-3 py-1.5 text-muted">Solved</td>
                  <td className="px-3 py-1.5 text-right">{money(f.maxAcquisitionBudget)}</td>
                  <td />
                </tr>
                <tr className="border-t border-line">
                  <td className="px-3 py-1.5">Acquisition costs (duty, legal)</td>
                  <td className="px-3 py-1.5 text-muted">{pct(a.acquisitionCostPct)} × P</td>
                  <td className="px-3 py-1.5 text-right">{money(f.acquisitionCosts)}</td>
                  <td />
                </tr>
                <tr className="border-t border-line">
                  <td className="px-3 py-1.5">Land holding / finance</td>
                  <td className="px-3 py-1.5 text-muted">{pct(a.landFinancePct)} × P</td>
                  <td className="px-3 py-1.5 text-right">{money(f.landHoldingCosts)}</td>
                  <td />
                </tr>
                <tr className="border-t-2 border-ink/20 bg-canvas/60">
                  <td className="px-3 py-1.5 font-semibold">Total development cost</td>
                  <td />
                  <td className="px-3 py-1.5 text-right font-semibold">{money(f.totalCost)}</td>
                  <td />
                </tr>
                <tr className="border-t border-line">
                  <td className="px-3 py-1.5 font-semibold">Profit</td>
                  <td className="px-3 py-1.5 text-muted">
                    {pct(f.marginOnCost)} on cost · {pct(f.marginOnRevenue)} on revenue
                  </td>
                  <td className="px-3 py-1.5 text-right font-semibold text-good">{money(f.profit)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </Panel>

          <div className="grid grid-cols-2 gap-4">
            <Panel title="How this was calculated">
              <ol className="space-y-1.5 text-[12px]">
                {f.steps.map((s, i) => (
                  <li key={s.label} className="grid grid-cols-[18px_1fr_auto] gap-2">
                    <span className="text-muted">{i + 1}.</span>
                    <span>
                      <span className="font-medium">{s.label}</span>
                      <span className="block text-[11px] text-muted">{s.formula}</span>
                    </span>
                    <span className="num font-semibold">{s.kind === "money" ? money(s.value) : s.kind === "pct" ? pct(s.value) : s.value.toFixed(3)}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-[11px] text-muted">
                Acquisition costs and land holding depend on the purchase price, so the residual is solved in closed form: L = P × k, giving P = L ÷ k. Nothing is counted twice.
              </p>
            </Panel>
            <Panel title="Purchase price tests" actions={dto.demoFinancialData ? <DemoFinancialBadge /> : null}>
              <table className="num w-full text-[12px]">
                <thead className="text-[10.5px] uppercase tracking-wide text-muted">
                  <tr>
                    <th className="pb-1 text-left">If acquired at</th>
                    <th className="pb-1 text-right">Price</th>
                    <th className="pb-1 text-right">Profit</th>
                    <th className="pb-1 text-right">MoC</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Combined market value", tests.atMarketValue],
                    ["Opening offers", tests.atOpeningOffers],
                    ["Maximum modelled offers", tests.atMaximum],
                  ].map(([label, t]) => {
                    const test = t as typeof tests.atMarketValue;
                    return (
                      <tr key={label as string} className="border-t border-line">
                        <td className="py-1.5">{label as string}</td>
                        <td className="py-1.5 text-right">{money(test.purchasePrice, { compact: true })}</td>
                        <td className={cx("py-1.5 text-right", test.profit < 0 && "text-bad")}>{money(test.profit, { compact: true })}</td>
                        <td className="py-1.5 text-right font-semibold">{pct(test.marginOnCost)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Panel>
          </div>

          <ScenarioPanel onChange={(key, adj) => updateInputs({ scenarios: { ...dto.inputs.scenarios, [key]: adj } })} />
        </div>
      </div>
    </div>
  );
}

const ADJ_FIELDS: { key: keyof ScenarioAdjustment; label: string; points?: boolean }[] = [
  { key: "salePricePct", label: "Sale price" },
  { key: "buildCostPct", label: "Build cost" },
  { key: "fsrPct", label: "FSR / yield" },
  { key: "financePctPoints", label: "Finance (pts)", points: true },
  { key: "targetMarginPctPoints", label: "Target margin (pts)", points: true },
];

function ScenarioPanel({ onChange }: { onChange: (key: ScenarioKey, adj: ScenarioAdjustment) => void }) {
  const { analysis } = useOpportunity();
  const keys: ScenarioKey[] = ["DOWNSIDE", "BASE", "UPSIDE"];
  return (
    <Panel title="Scenario analysis" bodyClassName="p-0">
      <table className="num w-full text-[12px]">
        <thead className="bg-canvas text-[10.5px] uppercase tracking-wide text-muted">
          <tr>
            <th className="px-3 py-2 text-left" />
            {keys.map((k) => (
              <th key={k} className={cx("px-3 py-2 text-right", k === "BASE" && "text-brand")}>
                {k}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ADJ_FIELDS.map((fld) => (
            <tr key={fld.key} className="border-t border-line">
              <td className="px-3 py-1 text-muted">{fld.label}</td>
              {keys.map((k) => {
                const s = analysis.scenarios[k];
                return (
                  <td key={k} className="px-3 py-1">
                    <NumberField kind="pct" className="ml-auto h-7 w-24" value={s.adjustment[fld.key]} onCommit={(v) => onChange(k, { ...s.adjustment, [fld.key]: v ?? 0 })} ariaLabel={`${k} ${fld.label}`} />
                  </td>
                );
              })}
            </tr>
          ))}
          {[
            ["FSR", (k: ScenarioKey) => fsr(analysis.scenarios[k].fsr)],
            ["GFA", (k: ScenarioKey) => sqm(analysis.scenarios[k].yield.gfa)],
            ["Dwellings", (k: ScenarioKey) => num(analysis.scenarios[k].yield.dwellings)],
            ["GRV", (k: ScenarioKey) => money(analysis.scenarios[k].feasibility.grv, { compact: true })],
            ["Max land budget", (k: ScenarioKey) => money(analysis.scenarios[k].feasibility.maxAcquisitionBudget, { compact: true })],
            ["Profit at budget", (k: ScenarioKey) => money(analysis.scenarios[k].feasibility.profit, { compact: true })],
            ["Margin on cost", (k: ScenarioKey) => pct(analysis.scenarios[k].feasibility.marginOnCost)],
            ["vs combined MV", (k: ScenarioKey) => (analysis.combinedMarketValue ? pct(analysis.scenarios[k].feasibility.maxAcquisitionBudget / analysis.combinedMarketValue - 1, 0, true) : "—")],
          ].map(([label, fn], i) => (
            <tr key={label as string} className={cx("border-t border-line", i === 0 && "border-t-2 border-ink/20")}>
              <td className="px-3 py-1.5 font-medium">{label as string}</td>
              {keys.map((k) => (
                <td key={k} className={cx("px-3 py-1.5 text-right", label === "Max land budget" && "font-semibold text-brand")}>
                  {(fn as (k: ScenarioKey) => string)(k)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-3 py-2 text-[11px] text-muted">Adjustments are relative to the base inputs. Finance and margin adjustments are in percentage points.</p>
    </Panel>
  );
}
