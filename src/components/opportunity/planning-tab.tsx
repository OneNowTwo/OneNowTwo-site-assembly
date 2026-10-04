"use client";

import { useState } from "react";
import { useOpportunity } from "./context";
import type { LotDTO } from "@/lib/opportunity-dto";
import { hasHeritage, APARTMENT_ZONES } from "@/lib/analysis/assembly";
import { DISCLAIMER } from "@/lib/constants";
import { date, fsr, lotDp, sqm } from "@/lib/format";
import { formatLepFsr } from "@/lib/planning/planning-snapshot";
import { Badge, Button, NumberField, Panel, SourceTag, TextInput } from "@/components/ui";
import { PlanningPathwaysPanel } from "./planning-pathways-panel";

function sourceKind(l: LotDTO, field: string): "OFFICIAL" | "ASSUMPTION" | "ESTIMATE" {
  const s = l.planningSources[field];
  if (s) return s.kind;
  return l.planningSnapshotSource === "MANUAL" ? "ASSUMPTION" : "OFFICIAL";
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

/** Planning tab — every panel reads analysis.planningSnapshot only. */
export function PlanningTab() {
  const { dto, analysis, refreshPlanning, saving } = useOpportunity();
  const [status, setStatus] = useState<{ ok: boolean; message?: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const planning = analysis.planningSnapshot;
  const ec = planning.effectiveControls;
  const zones = [...new Set(planning.lots.filter((l) => l.included).map((l) => l.zone ?? "Unknown"))];

  return (
    <div className="space-y-4">
      <PlanningPathwaysPanel snapshot={planning} />

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
              <th className="px-3 py-2 text-right">LEP FSR</th>
              <th className="px-3 py-2 text-right">LEP height</th>
              <th className="px-3 py-2 text-right">State / modelled</th>
              <th className="px-3 py-2 text-right">Min lot size</th>
              <th className="px-3 py-2 text-left">Heritage</th>
              <th className="px-3 py-2 text-left">Instrument / status</th>
              <th className="px-3 py-2 text-left">Last checked</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {dto.lots.map((l) => {
              const row = planning.lots.find((r) => r.id === l.id);
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
                    <div className="font-medium">{formatLepFsr(row?.lepFsr ?? l.fsr)}</div>
                    {(row?.lepFsr != null || (l.fsr != null && l.fsr > 0)) && <SourceTag kind={sourceKind(l, "fsr")} />}
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
                  </td>
                  <td className="num px-3 py-2 text-right">
                    <div className="font-medium">{l.heightM != null ? `${l.heightM} m` : "—"}</div>
                    <SourceTag kind={sourceKind(l, "heightM")} />
                  </td>
                  <td className="num px-3 py-2 text-right">
                    {row?.statePathway ? (
                      <>
                        <div className="font-medium">{row.statePathway}</div>
                        <div className="text-[10.5px] text-muted">
                          Modelled {row.modelledFsr != null ? fsr(row.modelledFsr) : "—"}
                          {row.modelledHeightM != null ? ` · ${row.modelledHeightM} m` : ""}
                        </div>
                        <div className="text-[10.5px] text-amber-900">{row.planningStatus}</div>
                      </>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="num px-3 py-2 text-right">{l.minLotSizeSqm != null ? sqm(l.minLotSizeSqm) : "—"}</td>
                  <td className="px-3 py-2">{hasHeritage(l.heritage) ? <Badge tone="bad">{l.heritage}</Badge> : <span className="text-muted">{l.heritage ?? "Unknown"}</span>}</td>
                  <td className="px-3 py-2 text-[11.5px]">
                    <div>{l.planningInstrument ?? "—"}</div>
                    <div className="text-[11px] text-muted">
                      {l.planningSnapshotSource === "MANUAL" ? "Manual planning input" : "NSW Planning Portal · EPI Primary Planning Layers"}
                    </div>
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
            <Line k="BASE LEP FSR" v={formatLepFsr(ec.baseFsr)} />
            <Line k="STATE PATHWAY FSR" v={ec.stateFsr != null ? fsr(ec.stateFsr) : "—"} />
            <Line k="MODELLED EFFECTIVE FSR" v={ec.effectiveFsr != null ? fsr(ec.effectiveFsr) : "—"} />
            <Line
              k="LEP height (lowest)"
              v={ec.baseHeightM != null ? `${ec.baseHeightM} m` : "—"}
            />
            <Line
              k="State pathway height"
              v={ec.stateHeightM != null ? `${ec.stateHeightM} m` : "—"}
            />
            <Line
              k="Modelled effective height"
              v={ec.effectiveHeightM != null ? `${ec.effectiveHeightM} m` : "—"}
            />
            <Line k="Heritage-affected lots" v={String(analysis.metrics.heritageLots)} />
            <Line k="Strata lots" v={String(analysis.metrics.strataLots)} />
          </dl>
        </Panel>
        <Panel title="Basis used for yield">
          <dl className="space-y-1.5 text-[12px]">
            <Line k="Site area" v={sqm(analysis.calculation.siteAreaSqm)} tag={analysis.site.siteAreaSource === "OVERRIDE" ? "ASSUMPTION" : "OFFICIAL"} />
            <Line k="BASE LEP FSR" v={formatLepFsr(ec.baseFsr)} tag={ec.baseFsr != null ? "OFFICIAL" : undefined} />
            {ec.fsrSource === "STATE_PATHWAY" ? (
              <>
                <Line k="State pathway" v={ec.statePathway ?? "Low & Mid-Rise Housing"} />
                <Line k="STATE LMR FSR" v={ec.stateFsr != null ? fsr(ec.stateFsr) : "—"} />
                <Line k="Modelled effective FSR" v={ec.effectiveFsr != null ? fsr(ec.effectiveFsr) : "—"} />
                <Line
                  k="Proximity"
                  v={
                    ec.proximityDistanceM != null
                      ? `${ec.proximityDistanceM}${
                          ec.proximityDistanceMaxM != null && ec.proximityDistanceMaxM !== ec.proximityDistanceM
                            ? `–${ec.proximityDistanceMaxM}`
                            : ""
                        } m estimated`
                      : "—"
                  }
                  tag="ESTIMATE"
                />
                <Line k="Proximity band" v={ec.proximityBandLabel} />
                <Line k="Height" v={ec.effectiveHeightM != null ? `${ec.effectiveHeightM} m` : "—"} />
                <Line k="Status" v={ec.status} />
              </>
            ) : (
              <Line
                k="FSR"
                v={ec.fsrSource === "NO_MAPPED" ? "Not mapped — USER FSR REQUIRED" : ec.effectiveFsr != null ? fsr(ec.effectiveFsr) : "—"}
                tag={ec.fsrSource === "OVERRIDE" ? "ASSUMPTION" : ec.fsrSource === "OFFICIAL" ? "OFFICIAL" : undefined}
              />
            )}
          </dl>
          <p className="mt-2 text-[11px] text-muted">
            {ec.fsrSource === "STATE_PATHWAY"
              ? "Same PlanningSnapshot effective controls drive Yield / Feasibility / Acquisition / score."
              : ec.fsrSource === "NO_MAPPED"
                ? "USER FSR REQUIRED only when no LEP FSR and no State pathway apply. Unmapped ≠ 0:1."
                : "Override on the Yield tab as a USER ASSUMPTION — never silently mixed with official FSR."}
          </p>
        </Panel>
        <Panel title="Flags">
          <ul className="space-y-1 text-[12px]">
            {zones.some((z) => z !== "Unknown" && !APARTMENT_ZONES.test(z)) && (
              <li className="text-bad">− Zone(s) {zones.filter((z) => !APARTMENT_ZONES.test(z)).join(", ")} generally exclude residential flat buildings</li>
            )}
            {ec.fsrSource === "NO_MAPPED" && (
              <li className="text-amber-800">− No mapped LEP FSR and no State pathway — not FSR 0:1; USER FSR required to model yield</li>
            )}
            {ec.fsrSource === "STATE_PATHWAY" && (
              <li className="text-amber-800">− State LMR pathway modelled from 800 m straight-line screen (ESTIMATED) — planning confirmation required</li>
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
      <td className="px-3 py-2 text-muted">—</td>
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
