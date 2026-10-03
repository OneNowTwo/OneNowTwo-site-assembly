"use client";

import { useEffect, useState } from "react";
import { useOpportunity } from "./context";
import { Badge, Panel } from "@/components/ui";
import { fsr } from "@/lib/format";
import type { CurrentPathway, PlanningChangeRecord } from "@/lib/planning/types";

export function PlanningPathwaysPanel() {
  const { dto } = useOpportunity();
  const [pending, setPending] = useState<PlanningChangeRecord[]>([]);
  const [pathways, setPathways] = useState<CurrentPathway[]>([]);
  const [safety, setSafety] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/opportunities/${dto.id}/planning-context`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        setPending(body.pendingChanges ?? []);
        setPathways(body.pathwaySummary ?? []);
        setSafety(body.safetyNote ?? "");
      })
      .catch(() => {
        if (cancelled) return;
        setPending([]);
        setPathways([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dto.id]);

  return (
    <div className="space-y-4">
      <Panel title="What applies today · pathways · proposed changes">
        <p className="text-[12px] text-muted">
          Three separate states: <strong className="text-ink">CURRENT LAW</strong>,{" "}
          <strong className="text-ink">CURRENT PATHWAYS</strong> (LMR / affordable housing), and{" "}
          <strong className="text-ink">PROPOSED / PENDING</strong>. Proposed controls never change today&apos;s max payable.
        </p>
        {loading && <p className="mt-2 text-[12px] text-muted">Loading planning context…</p>}
        {!!safety && <p className="mt-2 text-[11px] text-amber-900">{safety}</p>}
      </Panel>

      <Panel title="A · Current statutory controls">
        <p className="text-[12px] text-muted">From NSW EPI layers on each lot (see table below). LEP FSR may be unmapped — that is not a silent zero-yield site if a State pathway applies.</p>
      </Panel>

      <Panel title="B · Current alternative / bonus pathways">
        {!pathways.length && !loading && <p className="text-[12px] text-muted">No State pathways flagged for this assembly.</p>}
        <div className="space-y-3">
          {pathways.map((pw) => (
            <div key={pw.id} className="rounded-[3px] border border-line px-3 py-2 text-[12px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{pw.title}</span>
                <Badge tone={pw.status === "REQUIRES_PLANNING_CONFIRMATION" ? "warn" : "good"}>{pw.status.replaceAll("_", " ")}</Badge>
                <Badge tone="live">CURRENT POLICY</Badge>
              </div>
              <p className="mt-1 text-muted">{pw.summary}</p>
              {pw.controls && (
                <div className="num mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div>
                    <div className="text-[10px] uppercase text-muted">Base FSR</div>
                    {pw.controls.baseFsr != null ? fsr(pw.controls.baseFsr) : "—"}
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-muted">Pathway / bonus</div>
                    {pw.controls.pathwayFsr != null
                      ? fsr(pw.controls.pathwayFsr)
                      : pw.controls.bonusFsrPct != null
                        ? `+${Math.round(pw.controls.bonusFsrPct * 100)}%`
                        : "—"}
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-muted">Effective FSR</div>
                    <span className="font-semibold">{pw.controls.effectiveFsr != null ? fsr(pw.controls.effectiveFsr) : "—"}</span>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-muted">Effective height</div>
                    {pw.controls.effectiveHeightM != null ? `${pw.controls.effectiveHeightM.toFixed(1)} m` : "—"}
                  </div>
                </div>
              )}
              {!!pw.controls?.howCalculated?.length && (
                <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px] text-muted">
                  {pw.controls.howCalculated.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
              )}
              <div className="mt-1 text-[10.5px] text-muted">
                Source: {pw.meta.instrumentName} · last checked {new Date(pw.meta.lastChecked).toLocaleDateString("en-AU")}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="C · Proposed / pending changes">
        {!pending.length && !loading && (
          <p className="text-[12px] text-muted">No curated pending planning changes matched this assembly location.</p>
        )}
        <div className="space-y-3">
          {pending.map((c) => (
            <div key={c.id} className="rounded-[3px] border border-amber-300 bg-amber-50/40 px-3 py-2 text-[12px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{c.title}</span>
                <Badge tone="warn">{c.status}</Badge>
                <Badge tone="bad">NOT CURRENTLY IN FORCE</Badge>
              </div>
              {c.planningProposalNumber && <div className="mt-1 text-[11px] text-muted">PP: {c.planningProposalNumber}</div>}
              <p className="mt-1">{c.description}</p>
              {c.proposedControls && (
                <p className="mt-1 text-[11px] text-amber-950">
                  {c.proposedControls.machineReadable
                    ? `Proposed FSR ${c.proposedControls.fsr ?? "—"} · height ${c.proposedControls.heightM ?? "—"}`
                    : c.proposedControls.notes ?? "PROPOSED CONTROL NOT YET MACHINE-READABLE"}
                </p>
              )}
              {!!c.timeline?.length && (
                <ol className="mt-2 space-y-0.5 border-t border-amber-200 pt-2 text-[11px] text-muted">
                  {c.timeline.map((t) => (
                    <li key={`${t.date}-${t.label}`}>
                      <span className="font-medium text-ink">{t.date}</span> — {t.label}
                    </li>
                  ))}
                </ol>
              )}
              <a className="mt-2 inline-block text-[11px] font-semibold text-brand hover:underline" href={c.sourceUrl} target="_blank" rel="noreferrer">
                Official source
              </a>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
