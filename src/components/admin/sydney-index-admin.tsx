"use client";

import { useEffect, useState } from "react";
import { fetchApiJson } from "@/lib/api-json";
import { Badge, Panel } from "@/components/ui";

type Payload = {
  metrics: {
    run: {
      id: string;
      status: string;
      completedBatches: number;
      totalBatches: number;
      failedBatches: number;
      parcelsProcessed: number;
      candidateCount: number;
    } | null;
    uniqueCandidates: number;
    byKind: Record<string, number>;
    coverage: {
      currentPlanningPct: number;
      stationDistancePct: number;
      proposedPlanningPct: number;
      quickFinancialPct: number;
    };
    lgasTotal: number;
    sampleByRegion: Array<{
      address: string | null;
      suburb: string | null;
      lga: string | null;
      kind: string;
      quickScore: number | null;
      provenance: string;
    }>;
  };
  batches: Array<{
    lga: string;
    tileKey: string;
    status: string;
    parcelsLoaded: number;
    candidatesGenerated: number;
    error: string | null;
  }>;
  coverage: { lgaCount: number };
};

export function SydneyIndexAdminClient() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchApiJson<Payload>("/api/admin/sydney-index")
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, []);

  if (error) return <div className="p-6 text-bad text-[13px]">{error}</div>;
  if (!data) return <div className="p-6 text-muted text-[13px]">Loading Sydney index…</div>;

  const run = data.metrics.run;

  return (
    <div className="h-full overflow-y-auto p-6 space-y-4">
      <div>
        <h1 className="text-[22px] font-semibold">Sydney index progress</h1>
        <p className="text-[13px] text-muted">Admin / diagnostics — Greater Sydney progressive scan</p>
      </div>
      <Panel>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-[13px]">
          <Stat label="Run status" value={run?.status ?? "NONE"} />
          <Stat
            label="Batches"
            value={run ? `${run.completedBatches} / ${run.totalBatches}` : "—"}
          />
          <Stat label="Parcels processed" value={String(run?.parcelsProcessed ?? 0)} />
          <Stat label="INDEX_DISCOVERY candidates" value={String(data.metrics.uniqueCandidates)} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
          <Badge tone="neutral">LGAs in market · {data.metrics.lgasTotal}</Badge>
          <Badge tone="neutral">Current planning · {data.metrics.coverage.currentPlanningPct}%</Badge>
          <Badge tone="neutral">Station · {data.metrics.coverage.stationDistancePct}%</Badge>
          <Badge tone="neutral">Proposed · {data.metrics.coverage.proposedPlanningPct}%</Badge>
          <Badge tone="neutral">Quick financial · {data.metrics.coverage.quickFinancialPct}%</Badge>
        </div>
        <div className="mt-2 text-[12px] text-muted">
          By kind:{" "}
          {Object.entries(data.metrics.byKind)
            .map(([k, v]) => `${k}=${v}`)
            .join(" · ") || "—"}
        </div>
      </Panel>

      <section>
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Sample discovery candidates</h2>
        <div className="space-y-2">
          {data.metrics.sampleByRegion.slice(0, 12).map((c, i) => (
            <div key={i} className="border border-line bg-white px-3 py-2 text-[12.5px]">
              <strong>{c.address ?? "Site"}</strong>
              <span className="text-muted">
                {" "}
                · {c.suburb ?? c.lga} · {c.kind} · {c.provenance} · score {c.quickScore ?? "—"}
              </span>
            </div>
          ))}
          {!data.metrics.sampleByRegion.length && (
            <p className="text-[12px] text-muted">No INDEX_DISCOVERY candidates yet — run cron batches.</p>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
          Batches ({data.batches.length})
        </h2>
        <div className="max-h-[420px] overflow-auto border border-line bg-white text-[11.5px]">
          <table className="w-full">
            <thead className="sticky top-0 bg-canvas">
              <tr className="text-left">
                <th className="px-2 py-1">LGA</th>
                <th className="px-2 py-1">Tile</th>
                <th className="px-2 py-1">Status</th>
                <th className="px-2 py-1 text-right">Parcels</th>
                <th className="px-2 py-1 text-right">Candidates</th>
              </tr>
            </thead>
            <tbody>
              {data.batches.slice(0, 200).map((b) => (
                <tr key={b.tileKey} className="border-t border-line">
                  <td className="px-2 py-1">{b.lga}</td>
                  <td className="px-2 py-1 font-mono text-[10.5px]">{b.tileKey}</td>
                  <td className="px-2 py-1">{b.status}</td>
                  <td className="px-2 py-1 text-right">{b.parcelsLoaded}</td>
                  <td className="px-2 py-1 text-right">{b.candidatesGenerated}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-[0.08em] text-muted">{label}</div>
      <div className="mt-0.5 text-[16px] font-semibold">{value}</div>
    </div>
  );
}
