"use client";

import { useMemo } from "react";
import type { ParcelData, FieldSource, FsrControl } from "@/lib/types";
import { date, fsr, lotDp, sqm } from "@/lib/format";
import { Badge, Button, LiveDataBadge, SourceTag } from "@/components/ui";
import { APARTMENT_ZONES } from "@/lib/analysis/assembly";
import type { Assumptions } from "@/lib/analysis/assumptions";
import type { NominatedCentre } from "@/lib/data-sources/housing-sepp-lmr";
import { resolveEffectiveControls } from "@/lib/analysis/effective-controls";

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
              <span>
                FSR {fsr(c.fsr)}
              </span>
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
  onAdd,
  onRemove,
  onFind,
  finding,
  onRetry,
  centres = [],
}: {
  parcel: ParcelData;
  /** Kept for call-site compatibility; official FSR no longer uses silent assumptions. */
  assumptions: Assumptions;
  inAssembly: boolean;
  onAdd: () => void;
  onRemove: () => void;
  onFind: () => void;
  finding: boolean;
  onRetry: () => void;
  centres?: NominatedCentre[];
}) {
  void _unusedAssumptions;
  const pl = parcel.planning;
  const effective = useMemo(() => resolveEffectiveControls(pl, parcel.centroid, centres), [pl, parcel.centroid, centres]);
  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-[16px] font-semibold leading-snug">{parcel.address ?? "No street address"}</h2>
          <div className="mt-0.5 text-[12px] text-muted">{lotDp(parcel)}</div>
        </div>
        <LiveDataBadge cached={parcel.source === "CACHED_NSW"} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {inAssembly ? (
          <Button variant="secondary" onClick={onRemove}>
            Remove from assembly
          </Button>
        ) : (
          <Button variant="primary" onClick={onAdd}>
            + Add to assembly
          </Button>
        )}
        <Button variant="accent" onClick={onFind} disabled={finding}>
          {finding ? "Searching…" : "Find assemblies"}
        </Button>
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
            <Row label="Zoning" value={pl.zone ? `${pl.zone} ${pl.zoneName ?? ""}` : "Not mapped"} source={pl.sources.zone} />
            <OfficialFsrBlock
              value={pl.fsr}
              instrument={pl.planningInstrument}
              source={pl.sources.fsr}
              controls={pl.fsrControls ?? []}
              status={pl.fsrStatus ?? (pl.fsr != null ? "MAPPED" : "NO_MAPPED")}
            />
            <div className="my-2 rounded-[3px] border border-line p-3">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">Effective development controls</div>
              <dl className="mt-2 space-y-1.5 text-[11.5px]">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">LEP control</dt>
                  <dd className="num font-semibold">{effective.lep.fsr != null ? fsr(effective.lep.fsr) : "—"}{effective.lep.heightM != null ? ` · ${effective.lep.heightM} m` : ""}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted">State policy control</dt>
                  <dd className="num text-right font-semibold">
                    {effective.statePolicy ? (
                      <>
                        {effective.statePolicy.fsr != null ? fsr(effective.statePolicy.fsr) : "—"}
                        {effective.statePolicy.heightM != null ? ` · ${effective.statePolicy.heightM} m` : ""}
                      </>
                    ) : (
                      "Not applicable"
                    )}
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
              {effective.modelled.certainty === "REQUIRES_PLANNING_CONFIRMATION" && (
                <div className="mt-2">
                  <Badge tone="warn">Requires planning confirmation</Badge>
                  <p className="mt-1 text-[10.5px] text-muted">
                    {effective.lmr.centreName ?? "Nominated centre"} · ~{effective.lmr.distanceM} m straight-line ({effective.lmr.band.replaceAll("_", " ")}). Housing SEPP LMR uses walking distance — not confirmed here.
                  </p>
                </div>
              )}
              {effective.fsrUplift > 0 && (
                <p className="mt-1 text-[10.5px] text-good">Modelled FSR uplift vs LEP: +{effective.fsrUplift.toFixed(2)}</p>
              )}
            </div>
            <Row label="Height of buildings (LEP)" value={pl.heightM != null ? `${pl.heightM} m` : "Not mapped"} source={pl.sources.heightM} />
            <Row label="Minimum lot size" value={pl.minLotSizeSqm != null ? sqm(pl.minLotSizeSqm) : "Not mapped"} source={pl.sources.minLotSizeSqm} />
            <Row label="Heritage" value={pl.heritage ?? "Unknown"} source={pl.sources.heritage} />
            <Row label="Planning instrument" value={<span className="text-[12px] font-medium">{pl.planningInstrument ?? "—"}</span>} />
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
