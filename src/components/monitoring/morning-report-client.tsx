"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Button, Panel, Stat } from "@/components/ui";
import { money, sqm } from "@/lib/format";
import { fetchApiJson } from "@/lib/api-json";

type ReportBody = {
  newOpportunities: { count: number; items: { title: string; href?: string | null; score?: number | null; headroom?: number | null }[] };
  bestNewOpportunity: {
    id?: string;
    name?: string;
    suburb?: string | null;
    lots?: number | null;
    siteAreaSqm?: number | null;
    score?: number | null;
    existingValue?: number | null;
    maxPayable?: number | null;
    headroom?: number | null;
    href?: string | null;
  } | null;
  salesValueChanges: { count: number; items: { title: string; summary?: string | null; href?: string | null }[] };
  planningChanges: { count: number; items: { title: string; summary?: string | null; href?: string | null }[] };
  opportunityMovements: { positiveHeadroom: number; belowTarget: number };
  watchlistActivity: { count: number; items: { title: string; summary?: string | null; href?: string | null }[] };
};

type Report = { id: string; title: string; summaryLine?: string | null; body: ReportBody; reportDate: string };

export function MorningReportClient() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(refresh = false) {
    setBusy(true);
    try {
      const body = await fetchApiJson<{ report: Report }>(`/api/morning-report${refresh ? "?refresh=1" : ""}`);
      setReport(body.report);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const body = await fetchApiJson<{ report: Report }>("/api/morning-report");
        if (!cancelled) setReport(body.report);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!report && !error) return <div className="p-6 text-[13px] text-muted">Generating morning report…</div>;

  const b = report?.body;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-[19px] font-semibold">Morning opportunity report</h1>
          <p className="text-[12px] text-muted">What changed since the last report — from saved areas and opportunities.</p>
        </div>
        <Button disabled={busy} onClick={() => load(true)}>
          Refresh report
        </Button>
      </div>
      {error && <p className="mb-3 text-[12px] text-bad">{error}</p>}
      {report && (
        <>
          <Panel className="mb-4" title={report.title}>
            <p className="text-[13px]">{report.summaryLine}</p>
          </Panel>

          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Panel bodyClassName="py-3"><Stat label="New opportunities" value={b?.newOpportunities.count ?? 0} size="md" tone="brand" /></Panel>
            <Panel bodyClassName="py-3"><Stat label="Sales / value changes" value={b?.salesValueChanges.count ?? 0} size="md" /></Panel>
            <Panel bodyClassName="py-3"><Stat label="Planning changes" value={b?.planningChanges.count ?? 0} size="md" tone="accent" /></Panel>
            <Panel bodyClassName="py-3"><Stat label="Watchlist activity" value={b?.watchlistActivity.count ?? 0} size="md" /></Panel>
          </div>

          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-12 space-y-4 lg:col-span-7">
              <Panel title="Best new opportunity">
                {!b?.bestNewOpportunity ? (
                  <p className="text-[12px] text-muted">No new assemblies in the lookback window.</p>
                ) : (
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-[16px] font-semibold">{b.bestNewOpportunity.name}</h2>
                      {b.bestNewOpportunity.suburb && <Badge>{b.bestNewOpportunity.suburb}</Badge>}
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 num sm:grid-cols-3">
                      <Stat label="Score" value={b.bestNewOpportunity.score ?? "—"} size="md" />
                      <Stat label="Site" value={b.bestNewOpportunity.siteAreaSqm != null ? sqm(b.bestNewOpportunity.siteAreaSqm) : "—"} size="md" />
                      <Stat label="Lots / units" value={b.bestNewOpportunity.lots ?? "—"} size="md" />
                      <Stat label="Existing value" value={money(b.bestNewOpportunity.existingValue, { compact: true })} size="md" />
                      <Stat label="Max payable" value={money(b.bestNewOpportunity.maxPayable, { compact: true })} size="md" tone="brand" />
                      <Stat label="Headroom" value={money(b.bestNewOpportunity.headroom, { compact: true })} size="md" tone="good" />
                    </div>
                    {b.bestNewOpportunity.href && (
                      <Link href={b.bestNewOpportunity.href} className="mt-3 inline-block text-[12px] font-semibold text-brand hover:underline">
                        Open opportunity →
                      </Link>
                    )}
                  </div>
                )}
              </Panel>

              <Panel title="New opportunities">
                <ItemList items={b?.newOpportunities.items ?? []} />
              </Panel>
            </div>
            <div className="col-span-12 space-y-4 lg:col-span-5">
              <Panel title="Opportunity movements">
                <p className="text-[12px]">
                  <span className="font-semibold text-good">{b?.opportunityMovements.positiveHeadroom ?? 0}</span> moved into / improved positive headroom
                  <br />
                  <span className="font-semibold text-bad">{b?.opportunityMovements.belowTarget ?? 0}</span> declined / fell below target
                </p>
              </Panel>
              <Panel title="Sales / value changes">
                <ItemList items={b?.salesValueChanges.items ?? []} />
              </Panel>
              <Panel title="Planning changes">
                <ItemList items={b?.planningChanges.items ?? []} />
              </Panel>
              <Panel title="Watchlist activity">
                <ItemList items={b?.watchlistActivity.items ?? []} />
              </Panel>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ItemList({ items }: { items: { title: string; summary?: string | null; href?: string | null; score?: number | null; headroom?: number | null }[] }) {
  if (!items.length) return <p className="text-[12px] text-muted">None in this window.</p>;
  return (
    <ul className="space-y-2">
      {items.map((it, i) => (
        <li key={`${it.title}-${i}`} className="text-[12.5px]">
          {it.href ? (
            <Link href={it.href} className="font-semibold hover:text-brand">
              {it.title}
            </Link>
          ) : (
            <span className="font-semibold">{it.title}</span>
          )}
          {it.summary && <div className="text-muted">{it.summary}</div>}
        </li>
      ))}
    </ul>
  );
}
