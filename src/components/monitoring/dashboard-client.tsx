"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Panel, cx } from "@/components/ui";
import { money, sqm, fsr } from "@/lib/format";
import { fetchApiJson } from "@/lib/api-json";
import { StrategySelector } from "@/components/strategy-selector";
import type { DevelopmentStrategy } from "@/lib/source-watcher/strategy-profile";

type TodayPayload = {
  headline: string;
  subheading: string;
  strategy: string;
  whatChanged: Array<{
    id: string;
    type: string;
    location: string | null;
    title: string;
    whatChanged: string;
    whyItMatters: string;
    affectedSites: number | null;
    date: string;
    sourceId: string | null;
    sourceLabel?: string | null;
    sourceHref?: string | null;
    href: string | null;
  }>;
  sitesToLookAt: Array<{
    id: string;
    name: string;
    address: string;
    suburb: string | null;
    siteAreaSqm: number | null;
    currentFsr: number | null;
    proposedFsr: number | null;
    score: number | null;
    maxPayable: number | null;
    headroom: number | null;
    reasons: string[];
    status: string;
    kind?: string;
    href?: string;
    sourceLabel?: string | null;
    sourceHref?: string | null;
  }>;
  watchedChanges: Array<{
    id: string;
    type: string;
    title: string;
    summary: string | null;
    date: string;
    href: string | null;
  }>;
  developmentActivity: Array<{
    id: string;
    kind: string;
    title: string;
    summary: string | null;
    href: string | null;
    createdAt: string;
  }>;
  sourceFreshness: Array<{
    id: string;
    name: string;
    lastSuccessfulAt: string | null;
    lastCheckedAt: string | null;
  }>;
  morningReport?: { id: string; title: string; summaryLine?: string | null } | null;
};

function typeLabel(kind: string) {
  if (kind.includes("FSR")) return "Planning change";
  if (kind.includes("HEIGHT")) return "Planning change";
  if (kind.includes("ZONE")) return "Planning change";
  if (kind.includes("KEY_SITE") || kind.includes("ASSEMBLY")) return "Key site";
  if (kind.includes("HDA")) return "HDA";
  if (kind.includes("SSD")) return "SSD / Major project";
  if (kind.includes("DA_")) return "Development activity";
  if (kind.includes("PLANNING")) return "Planning change";
  return kind.replaceAll("_", " ");
}

export function DashboardClient() {
  const [data, setData] = useState<TodayPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<DevelopmentStrategy>("GENERAL_RESIDENTIAL");
  const [showSources, setShowSources] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const body = await fetchApiJson<TodayPayload>(`/api/dashboard?strategy=${strategy}`);
        if (!cancelled) setData(body);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [strategy]);

  if (error) {
    return <div className="p-6 text-[13px] text-bad">{error}</div>;
  }
  if (!data) {
    return <div className="p-6 text-[13px] text-muted">Loading development intelligence…</div>;
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="border-b border-line bg-gradient-to-br from-[#0b2f49] via-[#124a6e] to-[#1a5f7a] px-6 py-7 text-white">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">Today</div>
            <h1 className="mt-1 text-[26px] font-semibold tracking-tight">{data.headline}</h1>
            <p className="mt-1 max-w-2xl text-[13.5px] text-white/80">{data.subheading}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <StrategySelector value={strategy} onChange={setStrategy} tone="dark" />
            {data.morningReport && (
              <Link href="/morning-report" className="text-[12px] font-semibold text-white/85 underline-offset-2 hover:underline">
                {data.morningReport.summaryLine || data.morningReport.title} →
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-5 p-6">
        <section>
          <SectionHead title="What changed" action={<Link href="/feed" className="text-[11px] font-semibold text-brand hover:underline">Open feed</Link>} />
          {!data.whatChanged.length ? (
            <Empty>No intelligence events in the last 7 days. Source Watcher will populate this as monitors run.</Empty>
          ) : (
            <div className="space-y-3">
              {data.whatChanged.map((ev) => (
                <article key={ev.id} className="border border-line bg-white px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="warn">{typeLabel(ev.type)}</Badge>
                    {ev.location && <span className="text-[12px] font-semibold text-ink">{ev.location}</span>}
                    <span className="text-[11px] text-muted">{ev.date.slice(0, 10)}</span>
                  </div>
                  <h3 className="mt-1.5 text-[14px] font-semibold">{ev.title}</h3>
                  <p className="mt-1 text-[12.5px] text-ink/90">{ev.whatChanged}</p>
                  <div className="mt-2 border-l-2 border-brand/40 pl-3">
                    <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">Why it matters</div>
                    <p className="text-[12.5px]">{ev.whyItMatters}</p>
                  </div>
                  {ev.affectedSites != null && ev.affectedSites > 0 && (
                    <p className="mt-1 text-[11.5px] text-muted">{ev.affectedSites} watched / matching parcels affected</p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {ev.href && (
                      <Link href={ev.href} className="rounded-[3px] border border-line px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide hover:bg-canvas">
                        View area
                      </Link>
                    )}
                    <Link href="/opportunities" className="rounded-[3px] border border-line px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide hover:bg-canvas">
                      View affected sites
                    </Link>
                    {(ev.sourceLabel || ev.sourceId) && (
                      ev.sourceHref ? (
                        <a
                          href={ev.sourceHref}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-[3px] bg-canvas px-2.5 py-1 text-[11px] text-muted hover:text-brand"
                        >
                          Source · {ev.sourceLabel || ev.sourceId}
                        </a>
                      ) : (
                        <span className="rounded-[3px] bg-canvas px-2.5 py-1 text-[11px] text-muted">
                          Source · {ev.sourceLabel || ev.sourceId}
                        </span>
                      )
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section>
          <SectionHead title="Sites to look at" action={<Link href="/find" className="text-[11px] font-semibold text-brand hover:underline">Find sites</Link>} />
          {!data.sitesToLookAt.length ? (
            <Empty>No ranked sites yet. Run Find or an area scan on the Map.</Empty>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {data.sitesToLookAt.map((s) => (
                <Link
                  key={s.id}
                  href={"href" in s && typeof s.href === "string" ? s.href : `/opportunities/${s.id}`}
                  className="block border border-line bg-white px-4 py-3 hover:border-brand/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-[14px] font-semibold leading-snug">{s.address || s.name}</div>
                      <div className="text-[12px] text-muted">
                        {s.suburb ?? "NSW"}
                        {"kind" in s && s.kind && s.kind !== "OPPORTUNITY" ? ` · ${String(s.kind).replaceAll("_", " ")}` : ""}
                        {s.siteAreaSqm != null ? ` · ${sqm(s.siteAreaSqm)}` : ""}
                      </div>
                    </div>
                    {s.score != null && <Badge tone="brand">Score {Math.round(s.score)}</Badge>}
                    {"kind" in s && s.kind && s.kind !== "OPPORTUNITY" && <Badge tone="warn">Intel</Badge>}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3 text-[12px]">
                    <span>Current FSR {s.currentFsr != null ? fsr(s.currentFsr) : "—"}</span>
                    {s.proposedFsr != null && <span className="text-brand">Proposed FSR {fsr(s.proposedFsr)}</span>}
                    <span className={cx("num", s.headroom != null && s.headroom > 0 ? "text-good" : "text-muted")}>
                      Headroom {s.headroom != null ? money(s.headroom, { compact: true }) : "—"}
                    </span>
                  </div>
                  <ul className="mt-2 space-y-0.5">
                    {s.reasons.map((r) => (
                      <li key={r} className="text-[12px] text-muted">
                        · {r}
                      </li>
                    ))}
                  </ul>
                </Link>
              ))}
            </div>
          )}
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <section>
            <SectionHead title="Watched changes" action={<Link href="/watching" className="text-[11px] font-semibold text-brand hover:underline">Manage</Link>} />
            <Panel>
              {!data.watchedChanges.length ? (
                <p className="text-[12px] text-muted">No changes affecting watched areas, sites or assemblies.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {data.watchedChanges.map((c) => (
                    <li key={c.id} className="py-2.5">
                      <div className="flex items-center gap-2">
                        <Badge tone="live">{typeLabel(c.type)}</Badge>
                        <span className="text-[11px] text-muted">{c.date.slice(0, 10)}</span>
                      </div>
                      {c.href ? (
                        <Link href={c.href} className="mt-1 block text-[13px] font-semibold hover:text-brand">
                          {c.title}
                        </Link>
                      ) : (
                        <div className="mt-1 text-[13px] font-semibold">{c.title}</div>
                      )}
                      {c.summary && <p className="text-[12px] text-muted">{c.summary}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </section>

          <section>
            <SectionHead title="Development activity" />
            <Panel>
              {!data.developmentActivity.length ? (
                <p className="text-[12px] text-muted">
                  Newest DA / HDA / SSD in watched or target areas will appear here as statewide feeds connect.
                </p>
              ) : (
                <ul className="divide-y divide-line">
                  {data.developmentActivity.map((a) => (
                    <li key={a.id} className="py-2.5">
                      <Badge tone="neutral">{a.kind.replaceAll("_", " ")}</Badge>
                      {a.href ? (
                        <Link href={a.href} className="mt-1 block text-[13px] font-semibold hover:text-brand">
                          {a.title}
                        </Link>
                      ) : (
                        <div className="mt-1 text-[13px] font-semibold">{a.title}</div>
                      )}
                      {a.summary && <p className="text-[12px] text-muted">{a.summary}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </section>
        </div>

        <div className="border-t border-line pt-3">
          <button
            type="button"
            className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted hover:text-ink"
            onClick={() => setShowSources((v) => !v)}
          >
            {showSources ? "Hide source freshness" : "Source freshness"}
          </button>
          {showSources && (
            <div className="mt-2 grid gap-1 text-[11.5px] text-muted sm:grid-cols-2 lg:grid-cols-3">
              {data.sourceFreshness.map((s) => (
                <div key={s.id} className="rounded-[3px] border border-line px-2 py-1.5">
                  <div className="font-medium text-ink/80">{s.name}</div>
                  <div>Last OK · {s.lastSuccessfulAt?.slice(0, 16) ?? "—"}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionHead({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-end justify-between gap-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{title}</h2>
      {action}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="border border-dashed border-line bg-canvas/60 px-4 py-6 text-[12.5px] text-muted">{children}</div>;
}
