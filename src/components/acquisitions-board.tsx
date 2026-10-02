"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ACQUISITION_STAGES, STAGE_LABELS, type AcquisitionStageValue } from "@/lib/constants";
import { date, money, pct } from "@/lib/format";
import { Badge, DemoFinancialBadge, Select, cx } from "@/components/ui";

interface Row {
  id: string;
  opportunityId: string;
  opportunityName: string;
  demoFinancialData: boolean;
  label: string;
  lotDp: string;
  areaSqm: number;
  ownerName: string | null;
  ownerType: string | null;
  marketValue: number | null;
  openingOffer: number | null;
  maximumOffer: number | null;
  ownerPremium: number | null;
  critical: boolean | null;
  acquisitionStage: AcquisitionStageValue;
  lastContactAt: string | null;
  nextAction: string | null;
  nextActionDate: string | null;
}

export function AcquisitionsBoard() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [view, setView] = useState<"board" | "list">("board");
  const [opp, setOpp] = useState("ALL");
  const [stage, setStage] = useState<"ALL" | AcquisitionStageValue>("ALL");

  const load = () =>
    fetch("/api/acquisitions")
      .then((r) => r.json())
      .then(setRows);
  useEffect(() => {
    void load();
  }, []);

  const opportunities = useMemo(() => [...new Map((rows ?? []).map((r) => [r.opportunityId, r.opportunityName])).entries()], [rows]);
  const filtered = (rows ?? []).filter((r) => (opp === "ALL" || r.opportunityId === opp) && (stage === "ALL" || r.acquisitionStage === stage));
  const counts = new Map<string, number>();
  for (const r of rows ?? []) if (opp === "ALL" || r.opportunityId === opp) counts.set(r.acquisitionStage, (counts.get(r.acquisitionStage) ?? 0) + 1);

  async function move(r: Row, to: AcquisitionStageValue) {
    setRows((rs) => rs?.map((x) => (x.id === r.id ? { ...x, acquisitionStage: to } : x)) ?? null);
    await fetch(`/api/opportunities/${r.opportunityId}/lots/${r.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acquisitionStage: to }) });
  }

  const overdue = (d: string | null) => !!d && new Date(d) < new Date(new Date().toDateString());

  return (
    <div className="flex h-full flex-col overflow-hidden p-6">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h1 className="text-[19px] font-semibold">Acquisitions</h1>
          <p className="text-[12px] text-muted">Every property across active opportunities, by acquisition stage. Nothing is sent to owners automatically.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={opp} onChange={setOpp} options={[{ value: "ALL", label: "All opportunities" }, ...opportunities.map(([id, name]) => ({ value: id, label: name }))]} />
          <Select value={stage} onChange={setStage} options={[{ value: "ALL", label: "All stages" }, ...ACQUISITION_STAGES.map((s) => ({ value: s, label: STAGE_LABELS[s] }))]} />
          <div className="flex overflow-hidden rounded-[3px] border border-line bg-white">
            {(["board", "list"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className={cx("px-3 py-1.5 text-[11px] font-semibold uppercase", view === v ? "bg-brand text-white" : "text-muted")}>
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {rows === null ? (
        <p className="text-muted">Loading…</p>
      ) : view === "board" ? (
        <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto pb-2">
          {ACQUISITION_STAGES.filter((s) => stage === "ALL" || s === stage).map((s) => {
            const items = filtered.filter((r) => r.acquisitionStage === s);
            return (
              <div
                key={s}
                className="flex w-[210px] shrink-0 flex-col rounded-[3px] border border-line bg-white"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  const id = e.dataTransfer.getData("text/plain");
                  const r = rows.find((x) => x.id === id);
                  if (r && r.acquisitionStage !== s) void move(r, s);
                }}
              >
                <div className="flex items-center justify-between border-b border-line px-2.5 py-2">
                  <span className="text-[10.5px] font-semibold uppercase tracking-wide text-muted">{STAGE_LABELS[s]}</span>
                  <span className="num text-[11px] text-muted">{counts.get(s) ?? 0}</span>
                </div>
                <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-1.5">
                  {items.map((r) => (
                    <div key={r.id} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", r.id)} className="cursor-grab rounded-[3px] border border-line bg-white p-2 shadow-[0_1px_0_rgba(0,0,0,0.03)] hover:border-brand/50">
                      <Link href={`/opportunities/${r.opportunityId}?tab=acquisition`} className="block text-[12px] font-semibold hover:underline">
                        {r.label}
                      </Link>
                      <div className="truncate text-[10.5px] text-muted">{r.opportunityName}</div>
                      <div className="num mt-1 flex items-center justify-between text-[11px]">
                        <span>{money(r.openingOffer, { compact: true })}</span>
                        <span className={(r.ownerPremium ?? 0) > 0 ? "text-good" : "text-muted"}>{pct(r.ownerPremium, 0, true)}</span>
                        {r.critical ? <Badge tone="bad">Critical</Badge> : <Badge tone="good">Opt.</Badge>}
                      </div>
                      {r.nextAction && (
                        <div className={cx("mt-1 text-[10.5px]", overdue(r.nextActionDate) ? "text-bad" : "text-muted")}>
                          {r.nextAction}
                          {r.nextActionDate ? ` · ${date(r.nextActionDate)}` : ""}
                        </div>
                      )}
                      {r.demoFinancialData && <div className="mt-1 text-[9.5px] font-semibold uppercase tracking-wide text-amber-700">Demo financial data</div>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-auto rounded-[3px] border border-line bg-white">
          <table className="num w-full text-[12px]">
            <thead className="bg-canvas text-[10.5px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2 text-left">Property</th>
                <th className="px-3 py-2 text-left">Opportunity</th>
                <th className="px-3 py-2 text-left">Owner</th>
                <th className="px-3 py-2 text-right">Est. value</th>
                <th className="px-3 py-2 text-right">Opening</th>
                <th className="px-3 py-2 text-right">Max</th>
                <th className="px-3 py-2 text-right">Premium</th>
                <th className="px-3 py-2 text-left">Critical</th>
                <th className="px-3 py-2 text-left">Stage</th>
                <th className="px-3 py-2 text-left">Last contact</th>
                <th className="px-3 py-2 text-left">Next action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="px-3 py-1.5">
                    <Link href={`/opportunities/${r.opportunityId}?tab=acquisition`} className="font-medium text-brand hover:underline">
                      {r.label}
                    </Link>
                    <div className="text-[11px] text-muted">{r.lotDp}</div>
                  </td>
                  <td className="px-3 py-1.5">
                    {r.opportunityName}
                    {r.demoFinancialData && (
                      <div>
                        <DemoFinancialBadge />
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-1.5">{r.ownerName ?? <span className="text-muted">—</span>}</td>
                  <td className="px-3 py-1.5 text-right">{money(r.marketValue, { compact: true })}</td>
                  <td className="px-3 py-1.5 text-right">{money(r.openingOffer, { compact: true })}</td>
                  <td className="px-3 py-1.5 text-right">{money(r.maximumOffer, { compact: true })}</td>
                  <td className="px-3 py-1.5 text-right">{pct(r.ownerPremium, 0, true)}</td>
                  <td className="px-3 py-1.5">{r.critical ? <Badge tone="bad">Yes</Badge> : <Badge tone="good">Optional</Badge>}</td>
                  <td className="px-3 py-1.5">
                    <Select value={r.acquisitionStage} onChange={(v) => move(r, v)} options={ACQUISITION_STAGES.map((s) => ({ value: s, label: STAGE_LABELS[s] }))} className="h-7 text-[11.5px]" />
                  </td>
                  <td className="px-3 py-1.5">{date(r.lastContactAt)}</td>
                  <td className={cx("px-3 py-1.5", overdue(r.nextActionDate) && "text-bad")}>
                    {r.nextAction ?? "—"}
                    {r.nextActionDate && <div className="text-[11px]">{date(r.nextActionDate)}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
