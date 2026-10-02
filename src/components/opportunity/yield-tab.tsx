"use client";

import { useOpportunity } from "./context";
import { fsr, num, sqm } from "@/lib/format";
import { Badge, Field, NumberField, Panel, SourceTag, Stat } from "@/components/ui";
import type { Assumptions } from "@/lib/analysis/assumptions";

export function YieldTab() {
  const { dto, analysis, a, updateInputs, updateOverrides } = useOpportunity();
  const y = analysis.base.yield;
  const site = analysis.site;
  const ov = dto.inputs.overrides as Partial<Assumptions>;
  const tag = (k: keyof Assumptions) => (ov[k] != null ? <SourceTag kind="ASSUMPTION" /> : <Badge>Global default</Badge>);

  return (
    <div className="grid grid-cols-12 gap-4">
      <div className="col-span-5">
        <Panel title="Yield inputs" actions={<Badge tone="warn">Indicative only</Badge>}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Site area (sqm)" tag={<SourceTag kind={site.siteAreaSource === "OVERRIDE" ? "ASSUMPTION" : "OFFICIAL"} />} hint={`Parcels: ${sqm(analysis.metrics.totalAreaSqm)}. Clear to use parcels.`}>
              <NumberField value={dto.inputs.siteAreaOverride ?? site.siteAreaSqm} onCommit={(v) => updateInputs({ siteAreaOverride: v && Math.abs(v - analysis.metrics.totalAreaSqm) > 0.5 ? v : null })} />
            </Field>
            <Field
              label="FSR (:1)"
              tag={<SourceTag kind={site.fsrSource === "OVERRIDE" ? "ASSUMPTION" : site.fsrSource === "OFFICIAL" ? "OFFICIAL" : "ESTIMATE"} />}
              hint={`Controls: ${fsr(analysis.metrics.weightedFsr)}${analysis.metrics.fsrEstimated ? " (estimated)" : ""}. Clear to use controls.`}
            >
              <NumberField value={dto.inputs.fsrOverride ?? site.fsr} dp={2} onCommit={(v) => updateInputs({ fsrOverride: v && Math.abs(v - analysis.metrics.weightedFsr) > 0.001 ? v : null })} />
            </Field>
            <Field label="Height limit (m)" tag={<SourceTag kind={site.heightSource === "OVERRIDE" ? "ASSUMPTION" : "OFFICIAL"} />} hint={`Mapped: ${analysis.metrics.heightMinM ?? "—"} m`}>
              <NumberField value={dto.inputs.heightOverrideM ?? site.heightLimitM} onCommit={(v) => updateInputs({ heightOverrideM: v && v !== analysis.metrics.heightMinM ? v : null })} />
            </Field>
            <Field label="Site coverage" tag={tag("siteCoverage")}>
              <NumberField kind="pct" value={a.siteCoverage} onCommit={(v) => updateOverrides({ siteCoverage: v ?? undefined })} />
            </Field>
            <Field label="Saleable efficiency" tag={tag("efficiency")}>
              <NumberField kind="pct" value={a.efficiency} onCommit={(v) => updateOverrides({ efficiency: v ?? undefined })} />
            </Field>
            <Field label="Floor-to-floor (m)" tag={tag("floorToFloorM")}>
              <NumberField value={a.floorToFloorM} onCommit={(v) => updateOverrides({ floorToFloorM: v ?? undefined })} />
            </Field>
            <Field label="Avg dwelling size (sqm)" tag={tag("avgDwellingSizeSqm")}>
              <NumberField value={a.avgDwellingSizeSqm} onCommit={(v) => updateOverrides({ avgDwellingSizeSqm: v ?? undefined })} />
            </Field>
            <Field label="Car spaces / dwelling" tag={tag("carSpacesPerDwelling")}>
              <NumberField value={a.carSpacesPerDwelling} onCommit={(v) => updateOverrides({ carSpacesPerDwelling: v ?? undefined })} />
            </Field>
          </div>
        </Panel>
      </div>
      <div className="col-span-7 space-y-4">
        <Panel title="Indicative yield">
          <div className="grid grid-cols-4 gap-4">
            <Stat label="Gross floor area" value={sqm(y.gfa)} tone="brand" />
            <Stat label="Saleable area" value={sqm(y.saleableArea)} />
            <Stat label="Dwellings" value={num(y.dwellings)} sub={`${y.dwellingsExact.toFixed(1)} before rounding down`} />
            <Stat label="Car spaces" value={num(y.carSpaces)} />
          </div>
          <div className="mt-5 grid grid-cols-4 gap-4 border-t border-line pt-4">
            <Stat size="md" label="Building footprint" value={sqm(y.footprintSqm)} />
            <Stat size="md" label="Storeys (indicative)" value={num(y.storeys)} />
            <Stat size="md" label="Indicative height" value={`${y.indicativeHeightM.toFixed(1)} m`} tone={y.heightCompliant === false ? "bad" : undefined} />
            <Stat size="md" label="Max storeys under height" value={y.maxStoreysUnderHeight ?? "—"} />
          </div>
          {y.heightCompliant === false && (
            <p className="mt-3 rounded-[3px] bg-red-50 p-2 text-[12px] text-bad">
              The GFA at {Math.round(a.siteCoverage * 100)}% coverage needs {y.storeys} storeys ({y.indicativeHeightM.toFixed(1)} m), above the {site.heightLimitM} m height limit. Increase coverage, reduce FSR, or test a height assumption.
            </p>
          )}
        </Panel>
        <Panel title="How the yield is calculated">
          <table className="num w-full text-[12px]">
            <tbody>
              <Calc label="GFA" formula={`${sqm(site.siteAreaSqm)} × FSR ${fsr(analysis.base.fsr)}`} value={sqm(y.gfa)} />
              <Calc label="Saleable area" formula={`GFA × ${(a.efficiency * 100).toFixed(0)}% efficiency`} value={sqm(y.saleableArea)} />
              <Calc label="Dwellings" formula={`Saleable ÷ ${a.avgDwellingSizeSqm} sqm average, rounded down`} value={num(y.dwellings)} />
              <Calc label="Storeys" formula={`GFA ÷ (site × ${(a.siteCoverage * 100).toFixed(0)}% coverage), rounded up`} value={num(y.storeys)} />
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-muted">No architectural test-fit. Setbacks, ADG separation, deep soil and design excellence will change the achievable yield.</p>
        </Panel>
      </div>
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
