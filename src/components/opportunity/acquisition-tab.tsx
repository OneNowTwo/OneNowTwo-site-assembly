"use client";

import { useState } from "react";
import { useOpportunity } from "./context";
import type { LotDTO } from "@/lib/opportunity-dto";
import { ACQUISITION_STAGES, ACTIVITY_TYPES, OWNER_TYPES, STAGE_LABELS, type AcquisitionStageValue } from "@/lib/constants";
import { generateApproachBrief, generateOwnerLetter, suggestedNextAction } from "@/lib/analysis/approach";
import { date, lotDp, money, pct, sqm } from "@/lib/format";
import { Badge, Button, DemoFinancialBadge, Field, NumberField, Panel, Select, Stat, TextArea, TextInput, cx } from "@/components/ui";

export function AcquisitionTab() {
  const { dto, analysis, a, updateLot, updateOverrides } = useOpportunity();
  const [selectedId, setSelectedId] = useState<string>(dto.lots[0]?.id);
  const alloc = new Map(analysis.allocation.lots.map((l) => [l.id, l]));
  const crit = new Map(analysis.critical.map((c) => [c.id, c]));
  const al = analysis.allocation;
  const selected = dto.lots.find((l) => l.id === selectedId) ?? dto.lots[0];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-6 gap-4 rounded-[3px] border border-line bg-white p-4">
        <Stat label="Max payable to owners" value={money(al.budget, { compact: true })} tone="brand" sub="Base case maximum" />
        <Stat label="Combined existing property value" value={money(al.totalMarketValue, { compact: true })} sub={dto.demoFinancialData ? <DemoFinancialBadge /> : "Developer estimates"} />
        <Stat label="Total opening offers" value={money(al.totalOpening, { compact: true })} sub={al.totalMarketValue ? `${pct(al.totalOpening / al.totalMarketValue - 1, 0, true)} vs value` : undefined} />
        <Stat label="Total maximum offers" value={money(al.totalMaximum, { compact: true })} sub={al.totalMarketValue ? `${pct(al.totalMaximum / al.totalMarketValue - 1, 0, true)} vs value` : undefined} />
        <Stat label="Negotiation headroom" value={money(al.totalNegotiationHeadroom, { compact: true })} sub="Max − opening (total)" />
        <Field label="Opening offer % of maximum">
          <NumberField kind="pct" value={a.openingOfferPct} onCommit={(v) => updateOverrides({ openingOfferPct: v ?? undefined })} />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-4 rounded-[3px] border border-line bg-white p-3">
        <Field label="Market value weight">
          <NumberField value={a.marketValueWeight} onCommit={(v) => updateOverrides({ marketValueWeight: v ?? undefined })} />
        </Field>
        <Field label="Criticality weight">
          <NumberField value={a.criticalityWeight} onCommit={(v) => updateOverrides({ criticalityWeight: v ?? undefined })} />
        </Field>
        <Field label="Connectivity weight">
          <NumberField value={a.connectivityWeight} onCommit={(v) => updateOverrides({ connectivityWeight: v ?? undefined })} />
        </Field>
      </div>
      {al.warnings.map((w) => (
        <div key={w} className="rounded-[3px] border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          {w}
        </div>
      ))}

      <Panel title="Offer allocation by lot" actions={<span className="text-[11px] text-muted">Weighted by market value + criticality + connectivity. Not a valuation.</span>} bodyClassName="p-0">
        <table className="num w-full text-[12px]">
          <thead className="bg-canvas text-[10.5px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2 text-left">Property</th>
              <th className="w-[120px] px-2 py-2 text-right">Existing market value</th>
              <th className="px-2 py-2 text-right">Weight</th>
              <th className="w-[120px] px-2 py-2 text-right">Max modelled offer</th>
              <th className="w-[120px] px-2 py-2 text-right">Opening offer</th>
              <th className="w-[110px] px-2 py-2 text-right">Neg. headroom</th>
              <th className="px-2 py-2 text-right">Owner premium</th>
              <th className="px-2 py-2 text-left">Critical?</th>
              <th className="px-2 py-2 text-left">Owner</th>
              <th className="px-2 py-2 text-left">Acquisition stage</th>
            </tr>
          </thead>
          <tbody>
            {dto.lots.map((l) => {
              const x = alloc.get(l.id);
              const c = crit.get(l.id);
              return (
                <tr key={l.id} onClick={() => setSelectedId(l.id)} className={cx("cursor-pointer border-t border-line align-middle", selected?.id === l.id && "bg-brand-soft/50", !l.included && "text-muted")}>
                  <td className="px-3 py-1.5">
                    <div className="font-medium">{l.label}</div>
                    <div className="text-[11px] text-muted">
                      {lotDp(l)} · {sqm(l.areaSqm)}
                    </div>
                  </td>
                  <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                    <NumberField kind="money" value={l.marketValue} onCommit={(v) => updateLot(l.id, { marketValue: v, marketValueSource: "USER_ESTIMATE" })} placeholder="Enter" ariaLabel={`Market value ${l.label}`} />
                  </td>
                  <td className="px-2 py-1.5 text-right">{x ? pct(x.weight) : "—"}</td>
                  <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                    {l.included ? (
                      <NumberField kind="money" value={x?.maximumOffer} onCommit={(v) => updateLot(l.id, { maxAllocationOverride: v })} className={x?.maximumOverridden ? "border-violet-400" : ""} ariaLabel={`Max allocation ${l.label}`} />
                    ) : (
                      <span className="block text-right">Excluded</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                    {l.included && <NumberField kind="money" value={x?.openingOffer} onCommit={(v) => updateLot(l.id, { openingOfferOverride: v })} className={x?.openingOverridden ? "border-violet-400" : ""} ariaLabel={`Opening offer ${l.label}`} />}
                  </td>
                  <td className="px-2 py-1.5 text-right font-semibold text-brand">{l.included ? money(x?.negotiationHeadroom, { compact: true }) : "—"}</td>
                  <td className="px-2 py-1.5 text-right">
                    <div className={cx("font-semibold", (x?.openingPremium ?? 0) > 0 ? "text-good" : "")}>{pct(x?.openingPremium, 0, true)}</div>
                    <div className="text-[10.5px] text-muted">
                      {money(x?.ownerPremiumAmount, { compact: true })} · max {pct(x?.maximumPremium, 0, true)}
                    </div>
                  </td>
                  <td className="px-2 py-1.5">{!l.included ? <Badge>Excluded</Badge> : c?.status === "CRITICAL" ? <Badge tone="bad">Yes</Badge> : <Badge tone="good">Optional</Badge>}</td>
                  <td className="px-2 py-1.5 text-[11.5px]">{l.owner?.name ?? <span className="text-muted">Not identified</span>}</td>
                  <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                    <Select ariaLabel={`Stage ${l.label}`} value={l.acquisitionStage} onChange={(v) => updateLot(l.id, { acquisitionStage: v })} options={ACQUISITION_STAGES.map((s) => ({ value: s, label: STAGE_LABELS[s] }))} className="h-7 w-full text-[11.5px]" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="border-t border-line px-3 py-2 text-[11px] text-muted">Negotiation headroom = maximum modelled offer − opening offer. Owner premium = (opening ÷ existing market value) − 1. Model outputs only — not legal valuations.</p>
      </Panel>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-5 space-y-4">
          <Panel title="Critical lot analysis — what if we can't get it?" bodyClassName="p-0">
            <table className="num w-full text-[12px]">
              <thead className="bg-canvas text-[10.5px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2 text-left">Lot</th>
                  <th className="px-2 py-2 text-right">Area −</th>
                  <th className="px-2 py-2 text-right">GFA −</th>
                  <th className="px-2 py-2 text-right">Budget without</th>
                  <th className="px-2 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {analysis.critical.map((c) => {
                  const l = dto.lots.find((x) => x.id === c.id)!;
                  return (
                    <tr key={c.id} className="border-t border-line align-top">
                      <td className="px-3 py-1.5">
                        <div className="font-medium">{l.label}</div>
                        <ul className="mt-0.5 text-[11px] text-muted">
                          {c.reasons.map((r) => (
                            <li key={r}>• {r}</li>
                          ))}
                        </ul>
                      </td>
                      <td className="px-2 py-1.5 text-right">{pct(c.areaReductionPct, 0)}</td>
                      <td className="px-2 py-1.5 text-right">{pct(c.gfaReductionPct, 0)}</td>
                      <td className="px-2 py-1.5 text-right">{money(c.budgetWithout, { compact: true })}</td>
                      <td className="px-2 py-1.5">{c.status === "CRITICAL" ? <Badge tone="bad">{c.connector ? "Critical · connector" : "Critical"}</Badge> : <Badge tone="good">Optional</Badge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="border-t border-line px-3 py-2 text-[11px] text-muted">
              Critical when removal fragments the site, leaves less than the preferred scanner site-size threshold ({sqm(a.minViableSiteAreaSqm)}), cuts area/GFA ≥30%, or the remaining budget cannot cover the other lots&apos; value.
            </p>
          </Panel>
          <Panel title="Indicative acquisition sequence">
            <ol className="space-y-2.5">
              {analysis.strategy.map((s) => (
                <li key={s.order} className={cx("grid grid-cols-[22px_1fr] gap-2", s.kind === "milestone" && "rounded-[3px] bg-brand-soft/60 p-2")}>
                  <span className="num text-[13px] font-bold text-brand">{s.order}.</span>
                  <div>
                    <div className="flex items-center gap-2 text-[12.5px] font-semibold">
                      {s.title}
                      {s.role && <Badge tone={s.role === "Optional" ? "good" : "bad"}>{s.role}</Badge>}
                    </div>
                    <p className="text-[11.5px] text-muted">{s.rationale}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
        <div className="col-span-7">{selected && <LotCrm key={selected.id} lot={selected} />}</div>
      </div>
    </div>
  );
}

function LotCrm({ lot }: { lot: LotDTO }) {
  const { dto, analysis, updateLot, addActivity, updateInputs } = useOpportunity();
  const x = analysis.allocation.lots.find((l) => l.id === lot.id);
  const c = analysis.critical.find((l) => l.id === lot.id);
  const step = analysis.strategy.find((s) => s.lotId === lot.id);
  const [brief, setBrief] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [act, setAct] = useState<{ type: (typeof ACTIVITY_TYPES)[number]; note: string; nextAction: string; nextActionDate: string }>({ type: "NOTE", note: "", nextAction: "", nextActionDate: "" });
  const owner = lot.owner ?? { name: null, ownerType: null, phone: null, email: null, mailingAddress: null, notes: null };
  const letter = generateOwnerLetter({ ownerName: owner.name?.replace(/^DEMO — /, "") ?? null, address: lot.address ?? lot.label, contactDetails: dto.inputs.contactDetails });

  const copy = async (text: string, what: string) => {
    await navigator.clipboard.writeText(text).catch(() => null);
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <Panel
      title={`${lot.label} — owner & approach`}
      actions={
        <span className="flex items-center gap-2">
          {dto.demoFinancialData && <DemoFinancialBadge />}
          <label className="flex items-center gap-1.5 text-[11.5px]">
            <input type="checkbox" checked={lot.included} onChange={(e) => updateLot(lot.id, { included: e.target.checked })} /> Included in assembly
          </label>
        </span>
      }
    >
      <div className="grid grid-cols-2 gap-5">
        <div className="space-y-3">
          <h4 className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">Owner (manual entry)</h4>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Owner name">
              <TextInput value={owner.name ?? ""} onCommit={(v) => updateLot(lot.id, { owner: { name: v || null } })} />
            </Field>
            <Field label="Owner type">
              <Select value={(owner.ownerType ?? "Unknown") as string} onChange={(v) => updateLot(lot.id, { owner: { ownerType: v } })} options={OWNER_TYPES.map((t) => ({ value: t, label: t }))} className="w-full" />
            </Field>
            <Field label="Phone">
              <TextInput value={owner.phone ?? ""} onCommit={(v) => updateLot(lot.id, { owner: { phone: v || null } })} />
            </Field>
            <Field label="Email">
              <TextInput value={owner.email ?? ""} onCommit={(v) => updateLot(lot.id, { owner: { email: v || null } })} />
            </Field>
          </div>
          <Field label="Mailing address">
            <TextInput value={owner.mailingAddress ?? ""} onCommit={(v) => updateLot(lot.id, { owner: { mailingAddress: v || null } })} />
          </Field>
          <Field label="Owner notes">
            <TextArea rows={2} value={owner.notes ?? ""} onCommit={(v) => updateLot(lot.id, { owner: { notes: v || null } })} />
          </Field>
          <p className="text-[11px] text-muted">No automated owner lookup in V1 — a title / owner data provider can be connected later.</p>

          <h4 className="pt-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">Pipeline</h4>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Stage">
              <Select value={lot.acquisitionStage} onChange={(v: AcquisitionStageValue) => updateLot(lot.id, { acquisitionStage: v })} options={ACQUISITION_STAGES.map((s) => ({ value: s, label: STAGE_LABELS[s] }))} className="w-full" />
            </Field>
            <Field label="Last contact">
              <input type="date" value={lot.lastContactAt?.slice(0, 10) ?? ""} onChange={(e) => updateLot(lot.id, { lastContactAt: e.target.value || null })} className="h-8 w-full rounded-[3px] border border-line px-2" />
            </Field>
            <Field label="Next action">
              <TextInput value={lot.nextAction ?? ""} onCommit={(v) => updateLot(lot.id, { nextAction: v || null })} placeholder={suggestedNextAction(STAGE_LABELS[lot.acquisitionStage])} />
            </Field>
            <Field label="Next action date">
              <input type="date" value={lot.nextActionDate?.slice(0, 10) ?? ""} onChange={(e) => updateLot(lot.id, { nextActionDate: e.target.value || null })} className="h-8 w-full rounded-[3px] border border-line px-2" />
            </Field>
          </div>
        </div>

        <div className="space-y-3">
          <h4 className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">Approach</h4>
          <Field label="Approach notes">
            <TextArea rows={3} value={lot.approachNotes ?? ""} onCommit={(v) => updateLot(lot.id, { approachNotes: v || null })} placeholder="Key points for this owner" />
          </Field>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="primary"
              onClick={() =>
                setBrief(
                  generateApproachBrief({
                    address: lot.address ?? lot.label,
                    lotDp: lotDp(lot),
                    role: step?.role ?? (c?.status === "CRITICAL" ? "Critical" : "Optional"),
                    criticalReasons: c?.reasons ?? [],
                    marketValue: lot.marketValue,
                    openingOffer: x?.openingOffer ?? 0,
                    maximumOffer: x?.maximumOffer ?? 0,
                    ownerPremium: x?.openingPremium ?? null,
                    stageLabel: STAGE_LABELS[lot.acquisitionStage],
                    ownerName: owner.name,
                    keyNotes: lot.approachNotes ?? "",
                    assemblyName: dto.name,
                    lotCount: analysis.includedIds.length,
                  }),
                )
              }
            >
              Generate approach brief
            </Button>
            {brief && (
              <Button size="sm" onClick={() => copy(brief, "brief")}>
                {copied === "brief" ? "Copied" : "Copy brief"}
              </Button>
            )}
          </div>
          {brief && <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-[3px] border border-line bg-canvas p-2 font-mono text-[11px] leading-relaxed">{brief}</pre>}
          <Field label="Owner letter template (not sent automatically)">
            <pre className="whitespace-pre-wrap rounded-[3px] border border-line bg-canvas p-2 text-[11.5px] leading-relaxed">{letter}</pre>
          </Field>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Field label="Your contact details (used in letter)">
                <TextInput value={dto.inputs.contactDetails} onCommit={(v) => updateInputs({ contactDetails: v })} placeholder="0400 000 000 / you@company.com.au" />
              </Field>
            </div>
            <Button size="sm" className="h-8" onClick={() => copy(letter, "letter")}>
              {copied === "letter" ? "Copied" : "Copy letter"}
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-5 border-t border-line pt-4">
        <h4 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">Activity log</h4>
        <div className="mb-3 grid grid-cols-[120px_1fr_180px_130px_auto] items-end gap-2">
          <Select value={act.type} onChange={(v) => setAct({ ...act, type: v })} options={ACTIVITY_TYPES.filter((t) => t !== "STAGE_CHANGE").map((t) => ({ value: t, label: t.replace("_", " ").toLowerCase().replace(/^./, (m) => m.toUpperCase()) }))} />
          <input value={act.note} onChange={(e) => setAct({ ...act, note: e.target.value })} placeholder="What happened" className="h-8 rounded-[3px] border border-line px-2" />
          <input value={act.nextAction} onChange={(e) => setAct({ ...act, nextAction: e.target.value })} placeholder="Next action" className="h-8 rounded-[3px] border border-line px-2" />
          <input type="date" value={act.nextActionDate} onChange={(e) => setAct({ ...act, nextActionDate: e.target.value })} className="h-8 rounded-[3px] border border-line px-2" />
          <Button
            size="sm"
            variant="primary"
            className="h-8"
            disabled={!act.note.trim()}
            onClick={async () => {
              await addActivity(lot.id, { type: act.type, note: act.note, nextAction: act.nextAction || null, nextActionDate: act.nextActionDate || null });
              setAct({ type: "NOTE", note: "", nextAction: "", nextActionDate: "" });
            }}
          >
            Log
          </Button>
        </div>
        {lot.activities.length === 0 ? (
          <p className="text-[12px] text-muted">No activity recorded.</p>
        ) : (
          <ul className="divide-y divide-line text-[12px]">
            {lot.activities.map((ev) => (
              <li key={ev.id} className="grid grid-cols-[95px_110px_1fr] gap-2 py-1.5">
                <span className="num text-muted">{date(ev.activityDate)}</span>
                <span className="text-[11px] font-semibold uppercase text-muted">{ev.type.replace("_", " ")}</span>
                <span>
                  {ev.note}
                  {ev.nextAction && <span className="block text-[11px] text-muted">Next: {ev.nextAction}{ev.nextActionDate ? ` (${date(ev.nextActionDate)})` : ""}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
