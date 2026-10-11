"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Panel, cx } from "@/components/ui";
import { money, sqm, fsr } from "@/lib/format";
import { fetchApiJson } from "@/lib/api-json";
import { StrategySelector } from "@/components/strategy-selector";
import type { DevelopmentStrategy } from "@/lib/source-watcher/strategy-profile";

type Story = {
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
  mapHref?: string | null;
  findHref?: string | null;
  eventCount?: number | null;
};

type TodayPayload = {
  headline: string;
  subheading: string;
  strategy: string;
  marketScope?: { id: string; label: string; headerLabel: string };
  indexReady?: boolean;
  indexCount?: number;
  indexPreparingMessage?: string | null;
  topIntelligence?: Story[];
  whatChanged: Story[];
  sitesToLookAt: Array<{
    id: string;
    name: string;
    address: string;
    suburb: string | null;
    lga?: string | null;
    siteAreaSqm: number | null;
    lotCount?: number | null;
    owners?: number | null;
    currentFsr: number | null;
    proposedFsr: number | null;
    stationDistanceM?: number | null;
    score: number | null;
    maxPayable: number | null;
    headroom: number | null;
    reasons: string[];
    status: string;
    kind?: string;
    provenance?: string;
    href?: string;
    analyseHref?: string | null;
  }>;
  watchedChanges: Array<{
    id: string;
    type: string;
    title: string;
    summary: string | null;
    date: string;
    href: string | null;
  }>;
  showWatchedSection?: boolean;
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
  if (kind.includes("KEY_SITE") || kind === "KEY_SITE_PROGRAM") return "Key site program";
  if (kind.includes("DEVELOPMENT") || kind.includes("HDA") || kind.includes("SSD") || kind.includes("DA_")) {
    return "Development activity";
  }
  if (kind.includes("FSR") || kind.includes("HEIGHT") || kind.includes("ZONE") || kind.includes("PLANNING")) {
    return "Planning update";
  }
  return kind.replaceAll("_", " ");
}

export function DashboardClient() {
  const [data, setData] = useState<TodayPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<DevelopmentStrategy>("APARTMENTS");
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

  const stories = data.topIntelligence?.length ? data.topIntelligence : data.whatChanged;
  const showWatched = data.showWatchedSection !== false && data.watchedChanges.length > 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="border-b border-line bg-gradient-to-br from-[#0b2f49] via-[#124a6e] to-[#1a5f7a] px-6 py-7 text-white">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">
              Today · {data.marketScope?.label ?? "Greater Sydney"}
            </div>
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
          <SectionHead
            title="Top intelligence"
            action={
              <Link href="/feed" className="text-[11px] font-semibold text-brand hover:underline">
                View all
              </Link>
            }
          />
          {!stories.length ? (
            <Empty>No material Greater Sydney intelligence in the last 7 days yet.</Empty>
          ) : (
            <div className="space-y-3">
              {stories.map((ev) => (
                <article key={ev.id} className="border border-line bg-white px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="warn">{typeLabel(ev.type)}</Badge>
                    {ev.location && <span className="text-[12px] font-semibold text-ink">{ev.location}</span>}
                    <span className="text-[11px] text-muted">{ev.date.slice(0, 10)}</span>
                    {ev.eventCount != null && ev.eventCount > 1 && (
                      <span className="text-[11px] text-muted">{ev.eventCount} related signals</span>
                    )}
                  </div>
                  <h3 className="mt-1.5 text-[14px] font-semibold">{ev.title}</h3>
                  <p className="mt-1 text-[12.5px] text-ink/90">{ev.whatChanged}</p>
                  <div className="mt-2 border-l-2 border-brand/40 pl-3">
                    <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">Why it matters</div>
                    <p className="text-[12.5px]">{ev.whyItMatters}</p>
                  </div>
                  {ev.affectedSites != null && ev.affectedSites > 0 && (
                    <p className="mt-1 text-[11.5px] text-muted">{ev.affectedSites} sites in scope</p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(ev.mapHref || ev.href) && (
                      <Link
                        href={ev.mapHref || ev.href || "/map"}
                        className="rounded-[3px] border border-line px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide hover:bg-canvas"
                      >
                        View on map
                      </Link>
                    )}
                    <Link
                      href={ev.findHref || `/find?strategy=${strategy}`}
                      className="rounded-[3px] border border-line px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide hover:bg-canvas"
                    >
                      View sites
                    </Link>
                    {(ev.sourceLabel || ev.sourceId) &&
                      (ev.sourceHref ? (
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
                      ))}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section>
          <SectionHead
            title="Sites to look at today"
            action={
              <Link href="/find" className="text-[11px] font-semibold text-brand hover:underline">
                Find sites
              </Link>
            }
          />
          {data.indexPreparingMessage && !data.sitesToLookAt.length ? (
            <Empty>{data.indexPreparingMessage}</Empty>
          ) : !data.sitesToLookAt.length ? (
            <Empty>No Sydney-index candidates ranked for this strategy yet.</Empty>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {data.sitesToLookAt.map((s) => (
                <div key={s.id} className="border border-line bg-white px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-[14px] font-semibold leading-snug">{s.address || s.name}</div>
                      <div className="text-[12px] text-muted">
                        {s.suburb ?? s.lga ?? "Sydney"}
                        {s.siteAreaSqm != null ? ` · ${sqm(s.siteAreaSqm)}` : ""}
                        {s.lotCount != null ? ` · ${s.lotCount} lot${s.lotCount === 1 ? "" : "s"}` : ""}
                        {s.owners != null ? ` · ${s.owners} owner${s.owners === 1 ? "" : "s"}` : ""}
                      </div>
                    </div>
                    {s.score != null && <Badge tone="brand">Score {Math.round(s.score)}</Badge>}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3 text-[12px]">
                    <span>Current FSR {s.currentFsr != null ? fsr(s.currentFsr) : "—"}</span>
                    {s.proposedFsr != null && <span className="text-brand">Proposed FSR {fsr(s.proposedFsr)}</span>}
                    {s.stationDistanceM != null && <span>{Math.round(s.stationDistanceM)}m to station</span>}
                    {s.headroom != null && (
                      <span className={cx("num", s.headroom > 0 ? "text-good" : "text-muted")}>
                        Headroom {money(s.headroom, { compact: true })}
                      </span>
                    )}
                  </div>
                  <div className="mt-2">
                    <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">
                      Why this surfaced today
                    </div>
                    <ul className="mt-1 space-y-0.5">
                      {s.reasons.map((r) => (
                        <li key={r} className="text-[12px] text-muted">
                          · {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link
                      href={s.href || "/map"}
                      className="rounded-[3px] border border-line px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide hover:bg-canvas"
                    >
                      View on map
                    </Link>
                    {s.analyseHref ? (
                      <Link
                        href={s.analyseHref}
                        className="rounded-[3px] bg-brand px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white"
                      >
                        Analyse
                      </Link>
                    ) : (
                      <Link
                        href={`/find?strategy=${strategy}${s.suburb ? `&suburb=${encodeURIComponent(s.suburb)}` : ""}`}
                        className="rounded-[3px] bg-brand px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white"
                      >
                        Analyse
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className={cx("grid gap-4", showWatched ? "lg:grid-cols-2" : "")}>
          {showWatched && (
            <section>
              <SectionHead
                title="Watched items"
                action={
                  <Link href="/watching" className="text-[11px] font-semibold text-brand hover:underline">
                    Manage
                  </Link>
                }
              />
              <Panel>
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
              </Panel>
            </section>
          )}

          <section>
            <SectionHead title="Development activity" />
            <Panel>
              {!data.developmentActivity.length ? (
                <p className="text-[12px] text-muted">HDA / SSD / DA items appear here when material activity lands.</p>
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
            {showSources ? "Hide diagnostics" : "Source / diagnostics"}
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
