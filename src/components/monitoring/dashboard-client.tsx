"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Panel, Stat, cx } from "@/components/ui";
import { money } from "@/lib/format";
import { fetchApiJson } from "@/lib/api-json";

type Dash = {
  today: {
    newOpportunities: number;
    changedOpportunities: number;
    newSales: number;
    planningChanges: number;
    alertsTriggered: number;
  };
  watching: {
    areas: { id: string; label: string; kind: string; suburb?: string | null }[];
    parcels: { id: string; label: string }[];
    assemblies: { id: string; label: string; opportunityId?: string | null; opportunity?: { score?: number | null; acquisitionHeadroom?: number | null } | null }[];
  };
  pipeline: Record<string, number>;
  feed: {
    id: string;
    kind: string;
    title: string;
    summary?: string | null;
    href?: string | null;
    headroom?: number | null;
    score?: number | null;
    createdAt: string;
  }[];
  morningReport?: { id: string; title: string; summaryLine?: string | null } | null;
};

const PIPELINE_ORDER = ["ANALYSING", "FEASIBLE", "ACQUIRING", "CONTROLLED", "HOLD", "REJECTED", "WATCHING"] as const;

export function DashboardClient() {
  const [data, setData] = useState<Dash | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const body = await fetchApiJson<Dash>("/api/dashboard");
        if (!cancelled) setData(body);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <div className="p-6 text-[13px] text-bad">{error}</div>;
  }
  if (!data) {
    return <div className="p-6 text-[13px] text-muted">Loading workspace…</div>;
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[19px] font-semibold">What changed · what to look at today</h1>
          <p className="text-[12px] text-muted">Live acquisition workspace — not a one-off calculator.</p>
        </div>
        {data.morningReport && (
          <Link href="/morning-report" className="text-[12px] font-semibold text-brand hover:underline">
            {data.morningReport.summaryLine || data.morningReport.title} →
          </Link>
        )}
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Panel bodyClassName="py-3">
          <Stat label="New opportunities" value={data.today.newOpportunities} size="md" tone="brand" />
        </Panel>
        <Panel bodyClassName="py-3">
          <Stat label="Changed" value={data.today.changedOpportunities} size="md" />
        </Panel>
        <Panel bodyClassName="py-3">
          <Stat label="New sales" value={data.today.newSales} size="md" />
        </Panel>
        <Panel bodyClassName="py-3">
          <Stat label="Planning changes" value={data.today.planningChanges} size="md" tone="accent" />
        </Panel>
        <Panel bodyClassName="py-3">
          <Stat label="Alerts triggered" value={data.today.alertsTriggered} size="md" tone={data.today.alertsTriggered ? "good" : undefined} />
        </Panel>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 space-y-4 lg:col-span-7">
          <Panel title="Feed · look at these first" actions={<Link href="/feed" className="text-[11px] font-semibold text-brand hover:underline">Open feed</Link>}>
            {!data.feed.length && <p className="text-[12px] text-muted">No movements yet. Run a scan or wait for the daily monitor.</p>}
            <ul className="divide-y divide-line">
              {data.feed.map((f) => (
                <li key={f.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={toneForKind(f.kind)}>{f.kind.replaceAll("_", " ")}</Badge>
                      {f.href ? (
                        <Link href={f.href} className="truncate text-[13px] font-semibold text-ink hover:text-brand">
                          {f.title}
                        </Link>
                      ) : (
                        <span className="truncate text-[13px] font-semibold">{f.title}</span>
                      )}
                    </div>
                    {f.summary && <p className="mt-0.5 text-[12px] text-muted">{f.summary}</p>}
                  </div>
                  <div className="shrink-0 text-right text-[11px] text-muted">
                    {f.score != null && <div className="num">Score {f.score}</div>}
                    {f.headroom != null && <div className="num">{money(f.headroom, { compact: true })}</div>}
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <div className="col-span-12 space-y-4 lg:col-span-5">
          <Panel title="Watching" actions={<Link href="/watching" className="text-[11px] font-semibold text-brand hover:underline">Manage</Link>}>
            <Section label="Areas" items={data.watching.areas.map((a) => a.label)} empty="No saved areas" />
            <Section label="Parcels" items={data.watching.parcels.map((a) => a.label)} empty="No saved parcels" />
            <Section
              label="Assemblies"
              items={data.watching.assemblies.map((a) => a.label)}
              empty="No saved assemblies"
            />
          </Panel>

          <Panel title="Pipeline">
            <div className="grid grid-cols-2 gap-2">
              {PIPELINE_ORDER.map((k) => (
                <Link
                  key={k}
                  href={`/opportunities?status=${k}`}
                  className={cx("rounded-[3px] border border-line px-3 py-2 hover:bg-canvas")}
                >
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">{k}</div>
                  <div className="num text-[18px] font-semibold">{data.pipeline[k] ?? 0}</div>
                </Link>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Section({ label, items, empty }: { label: string; items: string[]; empty: string }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">{label}</div>
      {!items.length ? (
        <p className="mt-1 text-[12px] text-muted">{empty}</p>
      ) : (
        <ul className="mt-1 space-y-0.5 text-[12.5px]">
          {items.slice(0, 8).map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function toneForKind(kind: string): "good" | "bad" | "warn" | "brand" | "live" | "neutral" {
  if (kind === "NEW" || kind === "IMPROVED" || kind === "ALERT") return "good";
  if (kind === "DECLINED") return "bad";
  if (kind === "PLANNING_CHANGE") return "warn";
  if (kind === "NEW_SALE") return "live";
  if (kind === "REPORT") return "brand";
  return "neutral";
}
