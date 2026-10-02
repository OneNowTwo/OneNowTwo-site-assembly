"use client";

import { useOpportunity } from "./context";
import { autoGenerateUnitMix, computeUnitMix, DEFAULT_MIX_SHARES, DEFAULT_UNIT_MIX_TEMPLATE, type UnitMixRow } from "@/lib/analysis/unit-mix";
import { fsr, money, num, pct, sqm } from "@/lib/format";
import { Badge, Button, Field, NumberField, Panel, Select, SourceTag, Stat } from "@/components/ui";
import type { Assumptions } from "@/lib/analysis/assumptions";

export function YieldTab() {
  const { dto, analysis, a, updateInputs, updateOverrides } = useOpportunity();
  const y = analysis.base.yield;
  const site = analysis.site;
  const ov = dto.inputs.overrides as Partial<Assumptions>;
  const tag = (k: keyof Assumptions) => (ov[k] != null ? <SourceTag kind="ASSUMPTION" /> : <Badge>Global default</Badge>);
  const mix = analysis.unitMix.length ? analysis.unitMix : DEFAULT_UNIT_MIX_TEMPLATE;
  const totals = computeUnitMix(mix);

  function setMix(next: UnitMixRow[]) {
    updateInputs({ unitMix: next });
  }

  function updateRow(i: number, patch: Partial<UnitMixRow>) {
    const next = mix.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    setMix(next);
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-5">
          <Panel title="Yield inputs" actions={<Badge tone="warn">Indicative only</Badge>}>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Site area (sqm)" tag={<SourceTag kind={site.siteAreaSource === "OVERRIDE" ? "ASSUMPTION" : "OFFICIAL"} />} hint={`Parcels: ${sqm(analysis.metrics.totalAreaSqm)}. Clear to use parcels.`}>
                <NumberField value={dto.inputs.siteAreaOverride ?? site.siteAreaSqm} onCommit={(v) => updateInputs({ siteAreaOverride: v && Math.abs(v - analysis.metrics.totalAreaSqm) > 0.5 ? v : null })} />
              </Field>
              <Field
                label="Theoretical FSR (:1)"
                tag={<SourceTag kind={site.fsrSource === "OVERRIDE" ? "ASSUMPTION" : site.fsrSource === "OFFICIAL" ? "OFFICIAL" : "ESTIMATE"} />}
                hint={
                  site.fsrSource === "NO_MAPPED"
                    ? "NO MAPPED FSR on included lots — enter a USER ASSUMPTION here."
                    : `Official equivalent: ${fsr(analysis.metrics.weightedFsr)}${analysis.metrics.fsrEstimated ? " (some lots unmapped)" : ""}. Clear to use official controls.`
                }
              >
                <NumberField value={dto.inputs.fsrOverride ?? (site.fsrSource === "NO_MAPPED" ? null : site.fsr)} dp={2} onCommit={(v) => updateInputs({ fsrOverride: v && Math.abs(v - analysis.metrics.weightedFsr) > 0.001 ? v : null })} />
              </Field>
              <Field label="Height limit (m)" tag={<SourceTag kind={site.heightSource === "OVERRIDE" ? "ASSUMPTION" : "OFFICIAL"} />} hint={`Mapped: ${analysis.metrics.heightMinM ?? "—"} m`}>
                <NumberField value={dto.inputs.heightOverrideM ?? site.heightLimitM} onCommit={(v) => updateInputs({ heightOverrideM: v && v !== analysis.metrics.heightMinM ? v : null })} />
              </Field>
              <Field label="Site coverage" tag={tag("siteCoverage")}>
                <NumberField kind="pct" value={a.siteCoverage} onCommit={(v) => updateOverrides({ siteCoverage: v ?? undefined })} />
              </Field>
              <Field label="Planning / site efficiency" tag={tag("planningAdjustment")} hint="Applied to theoretical GFA → achievable GFA">
                <NumberField kind="pct" value={a.planningAdjustment} onCommit={(v) => updateOverrides({ planningAdjustment: v ?? undefined })} />
              </Field>
              <Field label="Saleable efficiency" tag={tag("efficiency")}>
                <NumberField kind="pct" value={a.efficiency} onCommit={(v) => updateOverrides({ efficiency: v ?? undefined })} />
              </Field>
              <Field label="Achievable GFA override" tag={dto.inputs.achievableGfaOverride ? <SourceTag kind="ASSUMPTION" /> : <Badge>System estimate</Badge>} hint="Clear to use theoretical × planning adjustment">
                <NumberField value={dto.inputs.achievableGfaOverride ?? y.achievableGfa} onCommit={(v) => updateInputs({ achievableGfaOverride: v && Math.abs(v - y.theoreticalGfa * a.planningAdjustment) > 1 ? v : null })} />
              </Field>
              <Field label="Floor-to-floor (m)" tag={tag("floorToFloorM")}>
                <NumberField value={a.floorToFloorM} onCommit={(v) => updateOverrides({ floorToFloorM: v ?? undefined })} />
              </Field>
              <Field label="Avg dwelling size fallback (sqm)" tag={tag("avgDwellingSizeSqm")}>
                <NumberField value={a.avgDwellingSizeSqm} onCommit={(v) => updateOverrides({ avgDwellingSizeSqm: v ?? undefined })} />
              </Field>
              <Field label="Car spaces / dwelling" tag={tag("carSpacesPerDwelling")}>
                <NumberField value={a.carSpacesPerDwelling} onCommit={(v) => updateOverrides({ carSpacesPerDwelling: v ?? undefined })} />
              </Field>
            </div>
          </Panel>
        </div>
        <div className="col-span-7 space-y-4">
          <Panel title="Theoretical vs achievable yield">
            <div className="grid grid-cols-4 gap-4">
              <Stat label="Theoretical GFA" value={sqm(y.theoreticalGfa)} sub={`Site × FSR ${fsr(analysis.base.fsr)}`} />
              <Stat label="Achievable GFA" value={sqm(y.achievableGfa)} tone="brand" sub={y.gfaSource === "OVERRIDE" ? "Manual override" : `× ${pct(y.planningAdjustment)} planning adj.`} />
              <Stat label="Saleable area" value={sqm(y.saleableArea)} />
              <Stat label="Dwellings" value={num(y.dwellings)} sub={a.revenueMode === "UNIT_MIX" ? "From unit mix" : `${y.dwellingsExact.toFixed(1)} before rounding`} />
            </div>
            <div className="mt-5 grid grid-cols-4 gap-4 border-t border-line pt-4">
              <Stat size="md" label="Building footprint" value={sqm(y.footprintSqm)} />
              <Stat size="md" label="Storeys (indicative)" value={num(y.storeys)} />
              <Stat size="md" label="Indicative height" value={`${y.indicativeHeightM.toFixed(1)} m`} tone={y.heightCompliant === false ? "bad" : undefined} />
              <Stat size="md" label="Max storeys under height" value={y.maxStoreysUnderHeight ?? "—"} />
            </div>
            {y.heightCompliant === false && (
              <p className="mt-3 rounded-[3px] bg-red-50 p-2 text-[12px] text-bad">
                The achievable GFA at {Math.round(a.siteCoverage * 100)}% coverage needs {y.storeys} storeys ({y.indicativeHeightM.toFixed(1)} m), above the {site.heightLimitM} m height limit.
              </p>
            )}
            <p className="mt-3 text-[11px] text-muted">Theoretical FSR does not equal an achievable building. Planning adjustment is a simplified proxy — not an architect test-fit.</p>
          </Panel>
          <Panel title="How the yield is calculated">
            <table className="num w-full text-[12px]">
              <tbody>
                <Calc label="Theoretical GFA" formula={`${sqm(site.siteAreaSqm)} × FSR ${fsr(analysis.base.fsr)}`} value={sqm(y.theoreticalGfa)} />
                <Calc label="Achievable GFA" formula={y.gfaSource === "OVERRIDE" ? "Manual override" : `Theoretical × ${(y.planningAdjustment * 100).toFixed(0)}% planning adjustment`} value={sqm(y.achievableGfa)} />
                <Calc label="Saleable area" formula={a.revenueMode === "UNIT_MIX" && totals.totalSaleableArea > 0 ? "From unit mix saleable areas" : `Achievable GFA × ${(a.efficiency * 100).toFixed(0)}% efficiency`} value={sqm(y.saleableArea)} />
                <Calc label="Dwellings" formula={a.revenueMode === "UNIT_MIX" ? "Sum of unit mix counts" : `Saleable ÷ ${a.avgDwellingSizeSqm} sqm average, rounded down`} value={num(y.dwellings)} />
              </tbody>
            </table>
          </Panel>
        </div>
      </div>

      <Panel
        title="Residential unit mix builder"
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={a.revenueMode === "UNIT_MIX" ? "brand" : "warn"}>{a.revenueMode === "UNIT_MIX" ? "Primary GRV method" : "Not driving GRV — switch revenue method"}</Badge>
            <Button
              onClick={() => {
                const probeSaleable = y.theoreticalGfa * a.planningAdjustment * a.efficiency;
                setMix(autoGenerateUnitMix(probeSaleable, DEFAULT_UNIT_MIX_TEMPLATE, dto.inputs.mixShares ?? DEFAULT_MIX_SHARES));
              }}
            >
              Auto-generate indicative mix
            </Button>
          </div>
        }
        bodyClassName="p-0"
      >
        <table className="num w-full text-[12px]">
          <thead className="bg-canvas text-[10.5px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-2 py-2 text-right">Count</th>
              <th className="px-2 py-2 text-right">Avg internal</th>
              <th className="px-2 py-2 text-right">External</th>
              <th className="px-2 py-2 text-right">Saleable</th>
              <th className="px-2 py-2 text-right">Sale price / unit</th>
              <th className="px-2 py-2 text-right">$/sqm</th>
              <th className="px-2 py-2 text-right">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {totals.rows.map((r, i) => (
              <tr key={r.name} className="border-t border-line">
                <td className="px-3 py-1.5 font-medium">{r.name}</td>
                <td className="px-2 py-1.5">
                  <NumberField className="ml-auto h-7 w-16" value={r.count} onCommit={(v) => updateRow(i, { count: Math.max(0, Math.round(v ?? 0)) })} />
                </td>
                <td className="px-2 py-1.5">
                  <NumberField className="ml-auto h-7 w-20" value={r.avgInternalArea} onCommit={(v) => updateRow(i, { avgInternalArea: v ?? 0 })} />
                </td>
                <td className="px-2 py-1.5">
                  <NumberField className="ml-auto h-7 w-20" value={r.avgExternalArea} onCommit={(v) => updateRow(i, { avgExternalArea: v ?? 0 })} />
                </td>
                <td className="px-2 py-1.5">
                  <NumberField className="ml-auto h-7 w-20" value={r.avgSaleableArea} onCommit={(v) => updateRow(i, { avgSaleableArea: v ?? 0 })} />
                </td>
                <td className="px-2 py-1.5">
                  <NumberField kind="money" className="ml-auto h-7 w-28" value={r.salePricePerUnit} onCommit={(v) => updateRow(i, { salePricePerUnit: v ?? 0 })} />
                </td>
                <td className="px-2 py-1.5 text-right text-muted">{r.pricePerSqm != null ? money(r.pricePerSqm) : "—"}</td>
                <td className="px-2 py-1.5 text-right font-semibold">{money(r.revenue, { compact: true })}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-ink/20 bg-canvas/60">
              <td className="px-3 py-2 font-semibold">Total</td>
              <td className="px-2 py-2 text-right font-semibold">{num(totals.totalUnits)}</td>
              <td colSpan={2} />
              <td className="px-2 py-2 text-right font-semibold">{sqm(totals.totalSaleableArea)}</td>
              <td className="px-2 py-2 text-right text-muted">{totals.averageSalePrice != null ? money(totals.averageSalePrice, { compact: true }) : "—"}</td>
              <td className="px-2 py-2 text-right font-semibold">{totals.blendedPricePerSqm != null ? money(totals.blendedPricePerSqm) : "—"}</td>
              <td className="px-2 py-2 text-right font-semibold text-brand">{money(totals.totalRevenue, { compact: true })}</td>
            </tr>
          </tbody>
        </table>
        <div className="flex items-center justify-between border-t border-line px-3 py-2 text-[11px] text-muted">
          <span>
            Blended $/sqm = unit-mix GRV ÷ saleable area (sanity check vs exit comps). Revenue method:{" "}
            <Select
              value={a.revenueMode}
              onChange={(v) => updateOverrides({ revenueMode: v as Assumptions["revenueMode"] })}
              options={[
                { value: "UNIT_MIX", label: "Unit mix" },
                { value: "PER_SQM", label: "$/sqm" },
                { value: "PER_DWELLING", label: "Per dwelling" },
              ]}
              className="ml-1 inline-flex h-7"
            />
          </span>
          <span>
            {num(totals.totalUnits)} units · avg {totals.averageSalePrice != null ? money(totals.averageSalePrice, { compact: true }) : "—"} · blended{" "}
            {totals.blendedPricePerSqm != null ? `${money(totals.blendedPricePerSqm)}/sqm` : "—"}
          </span>
        </div>
      </Panel>
    </div>
  );
}

function Calc({ label, formula, value }: { label: string; formula: string; value: string }) {
  return (
    <tr className="border-b border-line last:border-0">
      <td className="py-1.5 font-medium">{label}</td>
      <td className="py-1.5 text-muted">{formula}</td>
      <td className="py-1.5 text-right font-semibold">{value}</td>
    </tr>
  );
}
