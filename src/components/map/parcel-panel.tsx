"use client";

import type { ParcelData, FieldSource } from "@/lib/types";
import { date, fsr, lotDp, sqm } from "@/lib/format";
import { Badge, Button, LiveDataBadge, SourceTag } from "@/components/ui";
import { APARTMENT_ZONES, effectiveFsr } from "@/lib/analysis/assembly";
import type { Assumptions } from "@/lib/analysis/assumptions";

function Row({ label, value, source, children }: { label: string; value: React.ReactNode; source?: FieldSource; children?: React.ReactNode }) {
  return (
    <div className="border-b border-line py-2 last:border-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11.5px] text-muted">{label}</span>
        <span className="num text-right font-semibold">{value}</span>
      </div>
      {source && (
        <div className="mt-0.5 text-right text-[10.5px] text-muted">
          {source.source.replace(/^NSW Planning Portal — EPI Primary Planning Layers — /, "NSW Planning Portal · ")} · Checked {date(source.retrievedAt)}
        </div>
      )}
      {children}
    </div>
  );
}

export function ParcelPanel({
  parcel,
  assumptions,
  inAssembly,
  onAdd,
  onRemove,
  onFind,
  finding,
  onRetry,
}: {
  parcel: ParcelData;
  assumptions: Assumptions;
  inAssembly: boolean;
  onAdd: () => void;
  onRemove: () => void;
  onFind: () => void;
  finding: boolean;
  onRetry: () => void;
}) {
  const pl = parcel.planning;
  const est = pl ? effectiveFsr({ fsr: pl.fsr, heightM: pl.heightM, zone: pl.zone }, assumptions) : null;
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
            <Row label="Floor space ratio" value={pl.fsr != null ? fsr(pl.fsr) : "Not mapped"} source={pl.sources.fsr}>
              {pl.fsr == null && est && (
                <div className="mt-1 flex items-center justify-end gap-1.5 text-[11px] text-muted">
                  <SourceTag kind="ESTIMATE" />
                  {est.basis === "HEIGHT_ESTIMATE" ? `≈ ${fsr(est.fsr)} from height control` : `${fsr(est.fsr)} fallback assumption`}
                </div>
              )}
            </Row>
            <Row label="Height of buildings" value={pl.heightM != null ? `${pl.heightM} m` : "Not mapped"} source={pl.sources.heightM} />
            <Row label="Minimum lot size" value={pl.minLotSizeSqm != null ? sqm(pl.minLotSizeSqm) : "Not mapped"} source={pl.sources.minLotSizeSqm} />
            <Row label="Heritage" value={pl.heritage ?? "Unknown"} source={pl.sources.heritage} />
            <Row label="Planning instrument" value={<span className="text-[12px] font-medium">{pl.planningInstrument ?? "—"}</span>} />
            <Row label="Local government area" value={pl.lga ?? "—"} />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {pl.zone && !APARTMENT_ZONES.test(pl.zone) && <Badge tone="warn">Zone generally excludes apartments</Badge>}
              {pl.heritage && pl.heritage !== "None mapped" && <Badge tone="bad">Heritage affected</Badge>}
              {parcel.planningStatus === "partial" && <Badge tone="warn">Some layers unavailable</Badge>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
