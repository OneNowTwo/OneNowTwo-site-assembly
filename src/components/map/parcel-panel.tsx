"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ParcelData, FieldSource, FsrControl } from "@/lib/types";
import { date, fsr, lotDp, sqm } from "@/lib/format";
import { Badge, Button, LiveDataBadge, SourceTag } from "@/components/ui";
import { APARTMENT_ZONES } from "@/lib/analysis/assembly";
import type { Assumptions } from "@/lib/analysis/assumptions";
import type { NominatedCentre } from "@/lib/data-sources/housing-sepp-lmr";
import { resolveEffectiveControls } from "@/lib/analysis/effective-controls";
import type { DevelopmentActivity } from "@/lib/source-watcher/development-activity";

function Row({ label, value, source, children }: { label: string; value: React.ReactNode; source?: FieldSource; children?: React.ReactNode }) {
  return (
    <div className="border-b border-line py-2 last:border-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11.5px] text-muted">{label}</span>
        <span className="num text-right font-semibold">{value}</span>
      </div>
      {source && (
        <div className="mt-0.5 text-right text-[10.5px] text-muted">
          {source.source.replace(/^NSW Planning Portal — EPI Primary Planning Layers — /, "NSW Planning Portal · ").replace(/^NSW Planning Portal — Environmental Planning Instrument — /, "NSW Planning Portal · ")} · Checked {date(source.retrievedAt)}
        </div>
      )}
      {children}
    </div>
  );
}

function OfficialFsrBlock({
  value,
  instrument,
  source,
  controls,
  status,
}: {
  value: number | null;
  instrument: string | null;
  source?: FieldSource;
  controls: FsrControl[];
  status: string;
}) {
  if (status === "UNAVAILABLE") {
    return (
      <div className="my-2 rounded-[3px] border border-amber-300 bg-amber-50 p-3">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-amber-900">Official FSR</div>
        <div className="mt-1 text-[13px] font-semibold text-amber-950">Layer temporarily unavailable</div>
      </div>
    );
  }
  if (status === "NO_MAPPED" || value == null) {
    return (
      <div className="my-2 rounded-[3px] border border-line bg-canvas p-3">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">Official FSR</div>
        <div className="mt-1 text-[15px] font-semibold tracking-tight">NO MAPPED FSR CONTROL FOUND</div>
        <p className="mt-1 text-[11px] text-muted">No official NSW EPI Floor Space Ratio polygon intersects this parcel. Enter a USER ASSUMPTION on the Yield tab if you need to model capacity — it stays separate from official data.</p>
        {source && <div className="mt-1 text-[10.5px] text-muted">Checked {date(source.retrievedAt)} · NSW Planning Portal</div>}
      </div>
    );
  }
  return (
    <div className="my-2 rounded-[3px] border border-sky-200 bg-sky-50/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-sky-900">Official FSR</div>
        <SourceTag kind="OFFICIAL" />
      </div>
      <div className="num mt-1 text-[28px] font-semibold leading-none text-ink">{fsr(value)}</div>
      {status === "SPLIT" && (
        <div className="mt-2 space-y-1">
          <div className="text-[11px] font-semibold text-sky-950">Split mapped controls</div>
          {controls.map((c, i) => (
            <div key={`${c.fsr}-${i}`} className="flex justify-between text-[12px]">
              <span>FSR {fsr(c.fsr)}</span>
              <span className="num text-muted">{Math.round(c.intersectionShare * 100)}% of parcel</span>
            </div>
          ))}
          <div className="text-[10.5px] text-muted">Equivalent FSR {fsr(value)} used for theoretical GFA only — controls are not averaged for display.</div>
        </div>
      )}
      <dl className="mt-2 space-y-0.5 text-[11px] text-sky-950/90">
        <div className="flex justify-between gap-2">
          <dt className="text-muted">Source</dt>
          <dd>NSW Planning Portal</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted">Instrument</dt>
          <dd className="text-right">{controls[0]?.epiName ?? instrument ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted">Checked</dt>
          <dd>{date(source?.retrievedAt ?? null)}</dd>
        </div>
      </dl>
    </div>
  );
}

export function ParcelPanel({
  parcel,
  assumptions: _unusedAssumptions,
  inAssembly,
  onAnalyse,
  onAdd,
  onRemove,
  onFind,
  finding,
  analysing = false,
  onRetry,
  centres = [],
}: {
  parcel: ParcelData;
  /** Kept for call-site compatibility; official FSR no longer uses silent assumptions. */
  assumptions: Assumptions;
  inAssembly: boolean;
  /** Primary CTA — create/open Opportunity (never append to assembly). */
  onAnalyse: () => void;
  onAdd: () => void;
  onRemove: () => void;
  onFind: () => void;
  finding: boolean;
  analysing?: boolean;
  onRetry: () => void;
  centres?: NominatedCentre[];
}) {
  void _unusedAssumptions;
  const pl = parcel.planning;
  const effective = useMemo(() => resolveEffectiveControls(pl, parcel.centroid, centres), [pl, parcel.centroid, centres]);
  const [proposed, setProposed] = useState<{
    applies: boolean;
    findFields?: {
      proposedFsr: number | null;
      proposedHeight: number | null;
      proposedZone: string | null;
      planningChangeStatus: string | null;
      keySiteId: string | null;
      requiredParcelCount: number | null;
    };
    planningChangeAreas?: Array<{ title: string; status: string }>;
    keySites?: Array<{ keySite: { name: string }; requiredCount: number }>;
  } | null>(null);
  const [activityCount, setActivityCount] = useState<number | null>(null);

  useEffect(() => {
    const [lng, lat] = parcel.centroid;
    let cancelled = false;
    void fetch(`/api/planning/proposed?lng=${lng}&lat=${lat}`)
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setProposed(j);
      })
      .catch(() => {
        if (!cancelled) setProposed(null);
      });
    void fetch(`/api/development-activity?lng=${lng}&lat=${lat}&radiusM=500`)
      .then((r) => r.json())
      .then((j: { activities?: DevelopmentActivity[] }) => {
        if (!cancelled) setActivityCount(j.activities?.length ?? 0);
      })
      .catch(() => {
        if (!cancelled) setActivityCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, [parcel.centroid, parcel.externalParcelId]);

  const analyseHref = `/map?analyse=${encodeURIComponent(parcel.externalParcelId)}`;

  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-[18px] font-semibold leading-snug">{parcel.address ?? "No street address"}</h2>
          <div className="mt-0.5 text-[12.5px] text-muted">{lotDp(parcel)}</div>
        </div>
        <LiveDataBadge cached={parcel.source === "CACHED_NSW"} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Button variant="primary" onClick={onAnalyse} disabled={analysing}>
          {analysing ? "…" : "Analyse"}
        </Button>
        <Link
          href="/watching"
          className="inline-flex items-center justify-center rounded-[7px] border border-line bg-panel px-2 text-[11px] font-semibold uppercase tracking-wide hover:bg-canvas"
        >
          Watch
        </Link>
        <Button variant="accent" onClick={onFind} disabled={finding}>
          {finding ? "…" : "Find adjoining lots"}
        </Button>
      </div>
      <div className="mt-2 flex gap-2">
        {inAssembly ? (
          <Button variant="secondary" className="flex-1" onClick={onRemove}>
            Remove from assembly
          </Button>
        ) : (
          <Button variant="secondary" className="flex-1" onClick={onAdd}>
            + Add to assembly
          </Button>
        )}
        <Link
          href={analyseHref}
          className="inline-flex flex-1 items-center justify-center rounded-[7px] border border-line bg-panel px-2 text-[11px] font-semibold uppercase tracking-wide hover:bg-canvas"
        >
          Open assembly
        </Link>
      </div>

      <div className="mt-4">
        <Row label="Site area" value={sqm(parcel.areaSqm)}>
          <div className="mt-0.5 text-right text-[10.5px] text-muted">NSW Spatial Services cadastre · title area where recorded</div>
        </Row>
        {parcel.isStrata && (
          <div className="my-2">
            <Badge tone="warn">Strata scheme — collective sale required</Badge>
          </div>
        )}
        {parcel.planningStatus === "unavailable" || !pl ? (
          <div className="my-3 rounded-[3px] border border-amber-300 bg-amber-50 p-3">
            <div className="font-semibold text-amber-900">Planning service temporarily unavailable.</div>
            <p className="mt-1 text-[12px] text-amber-900/80">{parcel.planningMessage ?? "NSW Planning Portal did not respond."} You can continue — save the assembly and enter planning controls manually on the Planning tab.</p>
            <Button size="sm" className="mt-2" onClick={onRetry}>
              Retry
            </Button>
          </div>
        ) : (
          <>
            <div className="my-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">Current planning</div>
            <Row label="Zoning" value={pl.zone ? `${pl.zone} ${pl.zoneName ?? ""}` : "Not mapped"} source={pl.sources.zone} />
            <OfficialFsrBlock
              value={pl.fsr}
              instrument={pl.planningInstrument}
              source={pl.sources.fsr}
              controls={pl.fsrControls ?? []}
              status={pl.fsrStatus ?? (pl.fsr != null ? "MAPPED" : "NO_MAPPED")}
            />
            <Row label="Height of buildings (LEP)" value={pl.heightM != null ? `${pl.heightM} m` : "Not mapped"} source={pl.sources.heightM} />

            <div className="my-3 rounded-[7px] border border-accent/35 bg-accent-soft/70 p-3">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-warn">Proposed planning</div>
              {!proposed?.applies && !proposed?.findFields?.proposedFsr && !proposed?.keySites?.length ? (
                <p className="mt-1 text-[12px] text-muted">
                  No active proposed planning change from monitored sources intersects this site.
                </p>
              ) : (
                <dl className="mt-2 space-y-1 text-[12px]">
                  {proposed.planningChangeAreas?.[0] && (
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted">Proposal</dt>
                      <dd className="text-right font-semibold">{proposed.planningChangeAreas[0].title}</dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted">Status</dt>
                    <dd>{proposed.findFields?.planningChangeStatus ?? proposed.planningChangeAreas?.[0]?.status ?? "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted">Proposed FSR</dt>
                    <dd className="num font-semibold">{proposed.findFields?.proposedFsr != null ? fsr(proposed.findFields.proposedFsr) : "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted">Proposed height</dt>
                    <dd className="num">{proposed.findFields?.proposedHeight != null ? `${proposed.findFields.proposedHeight} m` : "—"}</dd>
                  </div>
                </dl>
              )}
            </div>

            <div className="my-2 rounded-[3px] border border-line p-3">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">Key site / activity</div>
              <div className="mt-2 space-y-1 text-[12px]">
                <div className="flex justify-between gap-2">
                  <span className="text-muted">Key site</span>
                  <span className="font-semibold">
                    {proposed?.keySites?.[0]?.keySite.name ??
                      (proposed?.findFields?.keySiteId ? proposed.findFields.keySiteId : "None intersecting")}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted">Development activity (500 m)</span>
                  <span className="num font-semibold">{activityCount != null ? activityCount : "—"}</span>
                </div>
              </div>
            </div>

            <div className="my-2 rounded-[3px] border border-line p-3">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">Effective development controls</div>
              <dl className="mt-2 space-y-1.5 text-[11.5px]">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">LEP control</dt>
                  <dd className="num font-semibold">
                    {effective.lep.fsr != null ? fsr(effective.lep.fsr) : "—"}
                    {effective.lep.heightM != null ? ` · ${effective.lep.heightM} m` : ""}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">Modelled effective</dt>
                  <dd className="num font-semibold">
                    {effective.modelled.fsr != null ? fsr(effective.modelled.fsr) : "—"}
                    {effective.modelled.heightM != null ? ` · ${effective.modelled.heightM} m` : ""}
                  </dd>
                </div>
              </dl>
            </div>
            <Row label="Local government area" value={pl.lga ?? "—"} />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {pl.zone && !APARTMENT_ZONES.test(pl.zone) && <Badge tone="warn">Zone generally excludes apartments under LEP alone</Badge>}
              {pl.heritage && pl.heritage !== "None mapped" && <Badge tone="bad">Heritage affected</Badge>}
              {parcel.planningStatus === "partial" && <Badge tone="warn">Some layers unavailable</Badge>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
