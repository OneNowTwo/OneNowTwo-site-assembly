"use client";

import { useEffect, useMemo, useState } from "react";
import { useOpportunity } from "./context";
import { Badge, Panel, SourceTag } from "@/components/ui";
import { date, fsr } from "@/lib/format";
import { formatLepFsr, type PlanningSnapshot } from "@/lib/planning/planning-snapshot";
import type { PlanningChangeRecord } from "@/lib/planning/types";

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

/** A / B / C — render solely from the opportunity PlanningSnapshot; only pending is hydrated from the API. */
export function PlanningPathwaysPanel({ snapshot }: { snapshot: PlanningSnapshot }) {
  const { dto } = useOpportunity();
  const [pending, setPending] = useState<PlanningChangeRecord[]>(snapshot.proposedPendingChanges);
  const [pendingCheckedAt, setPendingCheckedAt] = useState<string | null>(snapshot.pendingChangesCheckedAt);
  const [pendingSource, setPendingSource] = useState(snapshot.pendingChangesSource);
  const [loadingPending, setLoadingPending] = useState(true);

  useEffect(() => {
    let cancelled = false;
    import("@/lib/api-json")
      .then(({ fetchApiJson }) =>
        fetchApiJson<{
          pendingChanges?: PlanningChangeRecord[];
          pendingChangesCheckedAt?: string | null;
          pendingChangesSource?: string;
          planningSnapshot?: PlanningSnapshot;
        }>(`/api/opportunities/${dto.id}/planning-context`),
      )
      .then((body) => {
        if (cancelled) return;
        setPending(body.pendingChanges ?? body.planningSnapshot?.proposedPendingChanges ?? []);
        setPendingCheckedAt(body.pendingChangesCheckedAt ?? body.planningSnapshot?.pendingChangesCheckedAt ?? new Date().toISOString());
        setPendingSource(
          body.pendingChangesSource ??
            body.planningSnapshot?.pendingChangesSource ??
            "NSW Planning Proposal layers + curated watchlist",
        );
      })
      .catch(() => {
        if (cancelled) return;
        setPending([]);
        setPendingCheckedAt(new Date().toISOString());
      })
      .finally(() => {
        if (!cancelled) setLoadingPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dto.id]);

  const statutory = snapshot.currentStatutoryControls;
  const pathways = snapshot.currentStatePathways;
  const lmr = useMemo(() => pathways.find((p) => p.kind === "LMR"), [pathways]);
  const otherPathways = useMemo(() => pathways.filter((p) => p.kind !== "LMR"), [pathways]);

  return (
    <div className="space-y-4">
      <Panel title="What applies today · pathways · proposed changes">
        <p className="text-[12px] text-muted">
          Three separate states: <strong className="text-ink">CURRENT LAW</strong>,{" "}
          <strong className="text-ink">CURRENT PATHWAYS</strong> (LMR / affordable housing), and{" "}
          <strong className="text-ink">PROPOSED / PENDING</strong>. Proposed controls never change today&apos;s max payable.
        </p>
        <p className="mt-2 text-[11px] text-muted">
          Snapshot checked {date(snapshot.checkedAt)} · sources: {snapshot.sources.join(" · ")}
        </p>
      </Panel>

      <Panel title="A · Current statutory controls">
        <dl className="space-y-1.5 text-[12px]">
          <Line
            k="Zone"
            v={
              statutory.zone
                ? `${statutory.zone}${statutory.zoneName ? ` ${statutory.zoneName}` : ""}`
                : "—"
            }
            tag="OFFICIAL"
          />
          <Line k="LEP" v={statutory.lepName ?? "—"} tag={statutory.lepName ? "OFFICIAL" : undefined} />
          <Line k="LEP FSR" v={formatLepFsr(statutory.lepFsr)} tag={statutory.lepFsr != null ? "OFFICIAL" : undefined} />
          <Line
            k="LEP Height"
            v={statutory.lepHeightM != null ? `${statutory.lepHeightM} m` : "Not mapped"}
            tag={statutory.lepHeightM != null ? "OFFICIAL" : undefined}
          />
          <Line
            k="Minimum lot size"
            v={statutory.minLotSizeSqm != null ? `${Math.round(statutory.minLotSizeSqm).toLocaleString("en-AU")} sqm` : "Not mapped"}
          />
          <Line k="Heritage" v={statutory.heritage ?? "None mapped"} />
          {!!statutory.otherConstraints.length && (
            <Line k="Other mapped constraints" v={statutory.otherConstraints.join("; ")} />
          )}
          <Line k="Source" v={statutory.source} />
          <Line k="Last checked" v={date(statutory.retrievedAt)} />
        </dl>
      </Panel>

      <Panel title="B · Current alternative / bonus pathways">
        {!pathways.length && (
          <p className="text-[12px] text-muted">No State pathways flagged for this assembly.</p>
        )}
        <div className="space-y-3">
          {lmr && (
            <div className="rounded-[3px] border border-line px-3 py-2 text-[12px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold uppercase tracking-wide">{lmr.title}</span>
                <Badge tone="warn">REQUIRES PLANNING CONFIRMATION</Badge>
                <Badge tone="live">CURRENT POLICY</Badge>
              </div>
              <p className="mt-1 text-muted">{lmr.summary}</p>
              <dl className="mt-2 space-y-1.5">
                <Line k="Zone" v={lmr.zone ?? "—"} />
                <Line k="Centre" v={lmr.centre ?? "—"} />
                <Line
                  k="Estimated proximity"
                  v={
                    lmr.proximityDistanceM != null
                      ? `${lmr.proximityDistanceM}${
                          lmr.proximityDistanceMaxM != null && lmr.proximityDistanceMaxM !== lmr.proximityDistanceM
                            ? `–${lmr.proximityDistanceMaxM}`
                            : ""
                        } m straight-line`
                      : "—"
                  }
                  tag="ESTIMATE"
                />
                <Line k="Proximity band" v={lmr.proximityBandLabel} />
                <Line k="State LMR FSR" v={lmr.stateFsr != null ? fsr(lmr.stateFsr) : "—"} />
                <Line k="State LMR height" v={lmr.stateHeightM != null ? `${lmr.stateHeightM} m` : "—"} />
                <Line k="Modelled effective FSR" v={lmr.effectiveFsr != null ? fsr(lmr.effectiveFsr) : "—"} />
                <Line k="Modelled effective height" v={lmr.effectiveHeightM != null ? `${lmr.effectiveHeightM} m` : "—"} />
                <Line k="Status" v="ESTIMATED ELIGIBILITY — VERIFY BEFORE ACQUISITION / DA" />
              </dl>
            </div>
          )}
          {otherPathways.map((pw) => (
            <div key={pw.id} className="rounded-[3px] border border-line px-3 py-2 text-[12px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{pw.title}</span>
                <Badge tone="warn">{pw.status.replaceAll("_", " ")}</Badge>
                <Badge tone="live">CURRENT POLICY</Badge>
              </div>
              <p className="mt-1 text-muted">{pw.summary}</p>
              {!!pw.notes.length && (
                <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px] text-muted">
                  {pw.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="C · Proposed / pending changes">
        {loadingPending && <p className="text-[12px] text-muted">Checking NSW planning-proposal layers…</p>}
        {!loadingPending && !pending.length && (
          <div className="space-y-1 text-[12px] text-muted">
            <p className="font-medium text-ink">No relevant proposed / pending changes found</p>
            <p>Source checked: {pendingSource}</p>
            <p>Date checked: {date(pendingCheckedAt)}</p>
            <p>
              Absence of a mapped proposal does not mean no future change — confirm on the Planning Portal for
              acquisition decisions. Statewide Housing SEPP pathways (above) still apply where eligible.
            </p>
          </div>
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
                    : (c.proposedControls.notes ?? "PROPOSED CONTROL NOT YET MACHINE-READABLE")}
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
