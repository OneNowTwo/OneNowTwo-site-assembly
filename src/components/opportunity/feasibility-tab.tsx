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
  const openingBudget = analysis.allocation.totalOpening;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-4 rounded-[3px] border-2 border-brand/30 bg-white p-4">
        <Stat label="Maximum payable to owners" value={money(f.maxPayableToOwners, { compact: true })} tone={f.viable ? "brand" : "bad"} sub="Primary acquisition metric (P)" />
        <Stat label="Combined existing property value" value={money(analysis.combinedExistingValue, { compact: true })} sub={dto.demoFinancialData ? <DemoFinancialBadge /> : "Acquisition-side"} />
        <Stat label="Acquisition headroom" value={analysis.marketValueComplete ? money(analysis.acquisitionHeadroom, { compact: true }) : "—"} tone={analysis.marketValueComplete ? ((analysis.acquisitionHeadroom ?? 0) > 0 ? "good" : "bad") : undefined} sub={analysis.marketValueComplete ? pct(analysis.acquisitionHeadroomPercent, 0, true) : "VALUE REQUIRED"} />
        <Stat label="Acquisition headroom %" value={pct(analysis.acquisitionHeadroomPercent, 0)} sub="Headroom ÷ existing value" />
      </div>
      <div className="grid grid-cols-6 gap-4 rounded-[3px] border border-line bg-white p-4">
        <Stat label="GRV" value={money(f.grv, { compact: true })} sub={f.blendedPricePerSqm != null ? `Blended ${money(f.blendedPricePerSqm)}/sqm` : undefined} />
        <Stat label="Costs before land" value={money(f.nonLandCosts, { compact: true })} />
        <Stat label="Residual land capacity" value={money(f.residualLandValue, { compact: true })} sub="Incl. duty, legal & land holding" />
        <Stat label="Opening acquisition budget" value={money(openingBudget, { compact: true })} sub="Sum of opening offers" />
        <Stat label="Avg premium to market" value={pct(analysis.allocation.averagePremiumToMarket, 0, true)} />
        <Stat label="Negotiation headroom" value={money(analysis.allocation.totalNegotiationHeadroom, { compact: true })} sub="Max − opening (total)" />
      </div>
      <div className="grid grid-cols-4 gap-4 rounded-[3px] border border-line bg-white p-4">
        <Stat label="Profit at max land price" value={money(f.profit, { compact: true })} />
        <Stat label="Margin on cost (MOC)" value={pct(f.marginOnCost)} sub="Profit ÷ total development cost" />
        <Stat label="Margin on revenue" value={pct(f.marginOnRevenue)} />
        <Stat label="Assembly uplift" value={money(analysis.assemblyUplift, { compact: true })} sub="Same as acquisition headroom" />
      </div>
      {!f.viable && <div className="rounded-[3px] border border-red-200 bg-red-50 p-3 text-[12.5px] text-bad">At these assumptions the project cannot support any land cost at the target margin.</div>}
      {f.costInputIncomplete && (
        <div className="rounded-[3px] border border-line bg-canvas p-3 text-[12.5px] text-muted">
          <div className="font-medium text-ink">Optional cost lines at $0</div>
          <p className="mt-1">
            {f.costInputGaps.map((g) => g.label).join(", ")} — enter a figure if needed. Lift/basement are not flagged when using the BMT all-in $/sqm default.
          </p>
        </div>
      )}
      {f.grvCrossCheckWarning && (
        <div className="rounded-[3px] border border-line bg-canvas p-3 text-[12.5px] text-muted">
          <div className="font-medium text-ink">$/sqm cross-check</div>
          <p className="mt-1 num">
            Unit mix implied {money(f.grvCrossCheckWarning.unitMixImpliedRatePerSqm)}/sqm vs cross-check{" "}
            {money(f.grvCrossCheckWarning.crossCheckRatePerSqm)}/sqm (
            {f.grvCrossCheckWarning.differencePct >= 0 ? "+" : ""}
            {(f.grvCrossCheckWarning.differencePct * 100).toFixed(1)}%). Sense-check only — unit-mix GRV unchanged.
          </p>
        </div>
      )}

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-4 space-y-4">
          <Panel title="Revenue method">
            <div className="grid grid-cols-1 gap-3">
              <Field label="Revenue method" tag={tag("revenueMode")} hint="Unit mix recommended for residential">
                <Select
                  value={a.revenueMode}
                  onChange={(v) => updateOverrides({ revenueMode: v })}
                  options={[
                    { value: "UNIT_MIX", label: "Unit mix (recommended)" },
                    { value: "PER_SQM", label: "Saleable area × $/sqm" },
                    { value: "PER_DWELLING", label: "$ per dwelling" },
                  ]}
                  className="w-full"
                />
              </Field>
              {a.revenueMode === "PER_SQM" && moneyField("salePricePerSqm", "Sale price ($/sqm)")}
              {a.revenueMode === "PER_DWELLING" && moneyField("avgDwellingPrice", "Avg dwelling price")}
              {a.revenueMode === "UNIT_MIX" && (
                <p className="text-[12px] text-muted">
                  GRV from Yield tab unit mix: {money(f.grv, { compact: true })}. Blended {f.blendedPricePerSqm != null ? `${money(f.blendedPricePerSqm)}/sqm` : "—"}. Cross-check: {f.crossCheckLabel} = {money(f.crossCheckGrv, { compact: true })}.
                </p>
              )}
              {moneyField("otherRevenue", "Other project revenue")}
              {a.revenueMode !== "PER_SQM" && moneyField("salePricePerSqm", "$/sqm cross-check rate")}
            </div>
          </Panel>
          <Panel title="Construction & costs" actions={<Badge tone="assumption">User assumptions</Badge>}>
            <div className="grid grid-cols-2 gap-3">
              {moneyField("constructionCostPerSqm", "Base build ($/sqm GFA)")}
              {moneyField("basementParkingCost", "Basement parking")}
              {moneyField("demolitionPerLot", "Demolition (per lot)")}
              {moneyField("siteWorksCost", "Site works")}
              {moneyField("remediationCost", "Remediation")}
              {moneyField("liftsCost", "Lifts")}
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
            <p className="mt-2 text-[11px] text-muted">Development finance is separate from land holding / acquisition finance.</p>
          </Panel>
          <Panel title="Profit target">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Solve on" tag={tag("targetBasis")}>
                <Select
                  value={a.targetBasis}
                  onChange={(v) => updateOverrides({ targetBasis: v })}
                  options={[
                    { value: "COST", label: "Margin on cost (MOC)" },
                    { value: "REVENUE", label: "Margin on revenue" },
                  ]}
                  className="w-full"
                />
              </Field>
              {a.targetBasis === "COST" ? pctField("targetMarginOnCost", "Target MOC") : pctField("targetMarginOnRevenue", "Target margin on revenue")}
            </div>
            <p className="mt-2 text-[11px] text-muted">20% MOC means the developer earns $0.20 profit for every $1.00 of total development cost.</p>
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
                  <td className="px-3 py-1.5 font-semibold">Gross realisation value (GRV)</td>
                  <td className="px-3 py-1.5 text-muted">
                    {a.revenueMode === "UNIT_MIX"
                      ? `Unit mix · ${base.yield.dwellings} dwellings`
                      : a.revenueMode === "PER_SQM"
                        ? `${sqm(f.display.saleableArea)} × ${money(f.display.salePricePerSqm)}/sqm`
                        : `${base.yield.dwellings} × ${money(a.avgDwellingPrice)}`}
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
                  <td className="px-3 py-1.5 font-semibold text-brand">Maximum payable to owners (P)</td>
                  <td className="px-3 py-1.5 text-muted">L ÷ k</td>
                  <td className="px-3 py-1.5 text-right font-semibold text-brand">{money(f.maxPayableToOwners)}</td>
                  <td />
                </tr>
                <tr className="border-t border-line">
                  <td className="px-3 py-1.5">Combined existing property value</td>
                  <td className="px-3 py-1.5 text-muted">Acquisition-side</td>
                  <td className="px-3 py-1.5 text-right">{money(analysis.combinedExistingValue)}</td>
                  <td />
                </tr>
                <tr className="border-t border-line bg-emerald-50/50">
                  <td className="px-3 py-1.5 font-semibold text-good">Acquisition headroom</td>
                  <td className="px-3 py-1.5 text-muted">Max payable − existing value</td>
                  <td className="px-3 py-1.5 text-right font-semibold text-good">{money(analysis.acquisitionHeadroom)}</td>
                  <td className="px-3 py-1.5 text-right">{pct(analysis.acquisitionHeadroomPercent, 0)}</td>
                </tr>
                <tr className="border-t border-line">
                  <td className="px-3 py-1.5">Acquisition costs (duty, legal)</td>
                  <td className="px-3 py-1.5 text-muted">{pct(a.acquisitionCostPct)} × P</td>
                  <td className="px-3 py-1.5 text-right">{money(f.acquisitionCosts)}</td>
                  <td />
                </tr>
                <tr className="border-t border-line">
                  <td className="px-3 py-1.5">Land holding / acquisition finance</td>
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
                  <td className="px-3 py-1.5 font-semibold">Profit at maximum land price</td>
                  <td className="px-3 py-1.5 text-muted">
                    {pct(f.marginOnCost)} MOC · {pct(f.marginOnRevenue)} on revenue
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
                Acquisition costs and land holding depend on the purchase price, so the residual is solved in closed form: L = P × k, giving P = L ÷ k. Acquisition Headroom = P − combined existing property value.
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
                    ["Combined existing property value", tests.atMarketValue],
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
  { key: "existingValuePct", label: "Existing property value" },
  { key: "salePricePct", label: "Exit / apartment sale prices" },
  { key: "buildCostPct", label: "Construction cost" },
  { key: "fsrPct", label: "Achievable yield (FSR)" },
  { key: "financePctPoints", label: "Finance (pts)", points: true },
  { key: "targetMarginPctPoints", label: "Target MOC (pts)", points: true },
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
            ["Achievable GFA", (k: ScenarioKey) => sqm(analysis.scenarios[k].yield.achievableGfa)],
            ["Dwellings", (k: ScenarioKey) => num(analysis.scenarios[k].yield.dwellings)],
            ["GRV", (k: ScenarioKey) => money(analysis.scenarios[k].feasibility.grv, { compact: true })],
            ["Existing value", (k: ScenarioKey) => money(analysis.scenarios[k].combinedExistingValue, { compact: true })],
            ["Max payable to owners", (k: ScenarioKey) => money(analysis.scenarios[k].maxPayableToOwners, { compact: true })],
            ["Acquisition headroom", (k: ScenarioKey) => money(analysis.scenarios[k].acquisitionHeadroom, { compact: true })],
            ["Headroom %", (k: ScenarioKey) => pct(analysis.scenarios[k].acquisitionHeadroomPercent, 0)],
            ["Profit at budget", (k: ScenarioKey) => money(analysis.scenarios[k].feasibility.profit, { compact: true })],
            ["MOC", (k: ScenarioKey) => pct(analysis.scenarios[k].feasibility.marginOnCost)],
          ].map(([label, fn], i) => (
            <tr key={label as string} className={cx("border-t border-line", i === 0 && "border-t-2 border-ink/20")}>
              <td className="px-3 py-1.5 font-medium">{label as string}</td>
              {keys.map((k) => (
                <td key={k} className={cx("px-3 py-1.5 text-right", (label === "Max payable to owners" || label === "Acquisition headroom") && "font-semibold text-brand")}>
                  {(fn as (k: ScenarioKey) => string)(k)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-3 py-2 text-[11px] text-muted">Adjustments are relative to the base inputs. Existing property value, exit prices, construction, yield, finance and target MOC all flow through to max payable and headroom.</p>
    </Panel>
  );
}
