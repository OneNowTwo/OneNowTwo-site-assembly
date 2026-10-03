"use client";

import { useState } from "react";
import { useOpportunity } from "./context";
import type { LotDTO } from "@/lib/opportunity-dto";
import { hasHeritage, APARTMENT_ZONES } from "@/lib/analysis/assembly";
import { DISCLAIMER } from "@/lib/constants";
import { date, fsr, lotDp, sqm } from "@/lib/format";
import { Badge, Button, NumberField, Panel, SourceTag, TextInput } from "@/components/ui";
import { PlanningPathwaysPanel } from "./planning-pathways-panel";

function sourceKind(l: LotDTO, field: string): "OFFICIAL" | "ASSUMPTION" | "ESTIMATE" {
  const s = l.planningSources[field];
  if (s) return s.kind;
  return l.planningSnapshotSource === "MANUAL" ? "ASSUMPTION" : "OFFICIAL";
}

export function PlanningTab() {
  const { dto, analysis, refreshPlanning, saving } = useOpportunity();
  const [status, setStatus] = useState<{ ok: boolean; message?: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const site = analysis.site;
  const zones = [...new Set(dto.lots.filter((l) => l.included).map((l) => l.zone ?? "Unknown"))];

  return (
    <div className="space-y-4">
      <PlanningPathwaysPanel />

      <Panel
        title="Planning controls by lot"
        actions={
          <Button
            size="sm"
            disabled={saving}
            onClick={async () => {
              setStatus(null);
              setStatus(await refreshPlanning());
            }}
          >
            {saving ? "Checking…" : "Re-check NSW planning"}
          </Button>
        }
        bodyClassName="p-0"
      >
        {status && !status.ok && (
          <div className="flex items-center justify-between gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-[12px] text-amber-900">
            <span>
              <strong>Planning service temporarily unavailable.</strong> Continuing with the saved planning snapshot. You can also enter controls manually.
            </span>
            <Button size="sm" onClick={async () => setStatus(await refreshPlanning())}>
              Retry
            </Button>
          </div>
        )}
        {status?.ok && <div className="border-b border-line bg-emerald-50 px-4 py-2 text-[12px] text-good">Planning controls re-checked against the NSW Planning Portal.</div>}
        <table className="w-full text-[12px]">
          <thead className="bg-canvas text-[10.5px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2 text-left">Lot</th>
              <th className="px-3 py-2 text-left">Zone</th>
              <th className="px-3 py-2 text-right">FSR</th>
              <th className="px-3 py-2 text-right">Height</th>
              <th className="px-3 py-2 text-right">Min lot size</th>
              <th className="px-3 py-2 text-left">Heritage</th>
              <th className="px-3 py-2 text-left">Instrument / source</th>
              <th className="px-3 py-2 text-left">Last checked</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {dto.lots.map((l) => {
              return editing === l.id ? (
                <ManualRow key={l.id} lot={l} onDone={() => setEditing(null)} />
              ) : (
                <tr key={l.id} className="border-t border-line align-top">
                  <td className="px-3 py-2">
                    <div className="font-medium">{l.label}</div>
                    <div className="text-[11px] text-muted">
                      {lotDp(l)} · {sqm(l.areaSqm)}
                    </div>
                    {!l.included && <Badge>Excluded</Badge>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{l.zone ?? "—"}</div>
                    <div className="text-[11px] text-muted">{l.zoneName}</div>
                    <SourceTag kind={sourceKind(l, "zone")} />
                  </td>
                  <td className="num px-3 py-2 text-right">
                    {l.fsr != null ? (
                      <>
                        <div className="font-medium">{fsr(l.fsr)}</div>
                        <SourceTag kind={sourceKind(l, "fsr")} />
                        {l.fsrStatus === "SPLIT" && l.fsrControls.length > 1 && (
                          <div className="mt-1 space-y-0.5 text-left text-[10.5px] text-muted">
                            <div className="font-semibold uppercase tracking-wide">Split controls</div>
                            {l.fsrControls.map((c, i) => (
                              <div key={`${c.fsr}-${i}`}>
                                FSR {fsr(c.fsr)} — {Math.round(c.intersectionShare * 100)}% of parcel
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="font-medium">NO MAPPED FSR</div>
                        <div className="text-[10.5px] text-muted">Enter USER ASSUMPTION on Yield</div>
                      </>
                    )}
                  </td>
                  <td className="num px-3 py-2 text-right">
                    <div className="font-medium">{l.heightM != null ? `${l.heightM} m` : "—"}</div>
                    <SourceTag kind={sourceKind(l, "heightM")} />
                  </td>
                  <td className="num px-3 py-2 text-right">{l.minLotSizeSqm != null ? sqm(l.minLotSizeSqm) : "—"}</td>
                  <td className="px-3 py-2">{hasHeritage(l.heritage) ? <Badge tone="bad">{l.heritage}</Badge> : <span className="text-muted">{l.heritage ?? "Unknown"}</span>}</td>
                  <td className="px-3 py-2 text-[11.5px]">
                    <div>{l.planningInstrument ?? "—"}</div>
                    <div className="text-[11px] text-muted">{l.planningSnapshotSource === "MANUAL" ? "Manual planning input" : "NSW Planning Portal · EPI Primary Planning Layers"}</div>
                  </td>
                  <td className="px-3 py-2 text-[11.5px]">{date(l.planningCheckedAt)}</td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(l.id)}>
                      Edit
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      <div className="grid grid-cols-3 gap-4">
        <Panel title="Overall site controls">
          <dl className="space-y-1.5 text-[12px]">
            <Line k="Zones" v={zones.join(", ")} />
            <Line k="Combined site area" v={sqm(analysis.metrics.totalAreaSqm)} />
            <Line k="Equivalent assembly FSR" v={`${fsr(analysis.metrics.weightedFsr)}${analysis.metrics.fsrEstimated ? " (some lots unmapped)" : ""}`} />
            <Line k="Applicable height (lowest)" v={analysis.metrics.heightMinM != null ? `${analysis.metrics.heightMinM} m` : "—"} />
            <Line k="Heritage-affected lots" v={String(analysis.metrics.heritageLots)} />
            <Line k="Strata lots" v={String(analysis.metrics.strataLots)} />
          </dl>
        </Panel>
        <Panel title="Basis used for yield">
          <dl className="space-y-1.5 text-[12px]">
            <Line k="Site area" v={sqm(site.siteAreaSqm)} tag={site.siteAreaSource === "OVERRIDE" ? "ASSUMPTION" : "OFFICIAL"} />
            <Line
              k="FSR"
              v={site.fsrSource === "NO_MAPPED" ? "NO MAPPED FSR" : fsr(site.fsr)}
              tag={site.fsrSource === "OVERRIDE" ? "ASSUMPTION" : site.fsrSource === "OFFICIAL" ? "OFFICIAL" : undefined}
            />
            <Line k="Height" v={site.heightLimitM != null ? `${site.heightLimitM} m` : "—"} tag={site.heightSource === "OVERRIDE" ? "ASSUMPTION" : site.heightSource === "OFFICIAL" ? "OFFICIAL" : undefined} />
          </dl>
          <p className="mt-2 text-[11px] text-muted">Override on the Yield tab as a USER ASSUMPTION — never silently mixed with official FSR.</p>
        </Panel>
        <Panel title="Flags">
          <ul className="space-y-1 text-[12px]">
            {zones.some((z) => z !== "Unknown" && !APARTMENT_ZONES.test(z)) && <li className="text-bad">− Zone(s) {zones.filter((z) => !APARTMENT_ZONES.test(z)).join(", ")} generally exclude residential flat buildings</li>}
            {analysis.metrics.fsrUnmappedLots > 0 && (
              <li className="text-amber-800">− No mapped FSR for {analysis.metrics.fsrUnmappedLots} lot(s) — official theoretical GFA excludes those lots until a USER ASSUMPTION is entered</li>
            )}
            {analysis.metrics.fsrSplitLots > 0 && <li className="text-amber-800">− {analysis.metrics.fsrSplitLots} lot(s) have split official FSR controls</li>}
            {analysis.metrics.heritageLots > 0 && <li className="text-bad">− {analysis.metrics.heritageLots} heritage-affected lot(s)</li>}
            {analysis.metrics.minLotSizeIssues.map((m) => (
              <li key={m} className="text-bad">
                − {m}
              </li>
            ))}
            {!analysis.metrics.connected && <li className="text-bad">− Included lots are not contiguous</li>}
            {analysis.metrics.zoneCompatible && <li className="text-good">+ Consistent zoning across lots</li>}
          </ul>
        </Panel>
      </div>
      <p className="rounded-[3px] border border-line bg-white p-3 text-[12px] font-medium">{DISCLAIMER}</p>
    </div>
  );
}

function Line({ k, v, tag }: { k: string; v: string; tag?: "OFFICIAL" | "ASSUMPTION" | "ESTIMATE" }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted">{k}</dt>
      <dd className="num flex items-center gap-1.5 font-medium">
        {v}
        {tag && <SourceTag kind={tag} />}
      </dd>
    </div>
  );
}

function ManualRow({ lot, onDone }: { lot: LotDTO; onDone: () => void }) {
  const { updateLot } = useOpportunity();
  const [p, setP] = useState({ zone: lot.zone, zoneName: lot.zoneName, fsr: lot.fsr, heightM: lot.heightM, minLotSizeSqm: lot.minLotSizeSqm, heritage: lot.heritage });
  return (
    <tr className="border-t border-line bg-violet-50/40">
      <td className="px-3 py-2">
        <div className="font-medium">{lot.label}</div>
        <SourceTag kind="ASSUMPTION" />
      </td>
      <td className="px-3 py-2">
        <TextInput value={p.zone ?? ""} onCommit={(v) => setP({ ...p, zone: v || null })} placeholder="R4" />
      </td>
      <td className="px-3 py-2">
        <NumberField value={p.fsr} onCommit={(v) => setP({ ...p, fsr: v })} suffix=":1" />
      </td>
      <td className="px-3 py-2">
        <NumberField value={p.heightM} onCommit={(v) => setP({ ...p, heightM: v })} suffix="m" />
      </td>
      <td className="px-3 py-2">
        <NumberField value={p.minLotSizeSqm} onCommit={(v) => setP({ ...p, minLotSizeSqm: v })} suffix="m²" />
      </td>
      <td className="px-3 py-2" colSpan={2}>
        <TextInput value={p.heritage ?? ""} onCommit={(v) => setP({ ...p, heritage: v || null })} placeholder="None mapped" />
      </td>
      <td className="px-3 py-2" colSpan={2}>
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="primary"
            onClick={async () => {
              await updateLot(lot.id, { planning: p });
              onDone();
            }}
          >
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </td>
    </tr>
  );
}
