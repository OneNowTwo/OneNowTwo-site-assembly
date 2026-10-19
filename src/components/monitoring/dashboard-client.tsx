"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Panel, cx } from "@/components/ui";
import { PageHeader } from "@/components/shell/page-header";
import { ListRow } from "@/components/shell/list-row";
import { ScoreRing, StatusChip } from "@/components/shell/status-chip";
import { money, sqm, fsr } from "@/lib/format";
import { fetchApiJson } from "@/lib/api-json";
import { StrategySelector } from "@/components/strategy-selector";
import type { DevelopmentStrategy } from "@/lib/source-watcher/strategy-profile";
import {
  presentTodayStory,
  sitesWorthLookingSubheading,
  todayOrientationLine,
  todayTypeLabel,
} from "@/lib/intelligence/today-agent-copy";

type Story = {
  id: string;
  type: string;
  location: string | null;
  title: string;
  whatChanged: string;
  whyItMatters: string;
  typeLabel?: string | null;
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

type TodaySite = {
  id: string;
  name: string;
  address: string;
  parcelHint?: string | null;
  suburb: string | null;
  lga?: string | null;
  zone?: string | null;
  siteAreaSqm: number | null;
  lotCount?: number | null;
  owners?: number | null;
  currentFsr: number | null;
  proposedFsr: number | null;
  stationDistanceM?: number | null;
  score: number | null;
  scoreProvenance?: "DETAILED" | "SCREENING";
  maxPayable: number | null;
  headroom: number | null;
  existingValue?: number | null;
  whyItMatters?: string;
  familyAlternativeCount?: number;
  reasons: string[];
  status: string;
  kind?: string;
  provenance?: string;
  href?: string;
  analyseHref?: string | null;
};

type TodayPayload = {
  headline: string;
  subheading: string;
  orientation?: string;
  strategy: string;
  marketScope?: { id: string; label: string; headerLabel: string };
  indexReady?: boolean;
  indexCount?: number;
  indexPreparingMessage?: string | null;
  summaryStrip?: {
    indexedSites: number;
    analysedToday: number;
    worthChecking: number;
    planningChanges: number;
    watched: number;
  };
  topIntelligence?: Story[];
  whatChanged: Story[];
  sitesToLookAt: TodaySite[];
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

function formatShortDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" }).toUpperCase();
}

function primaryHref(s: TodaySite): string {
  if (s.analyseHref) return s.analyseHref;
  return s.href || "/map";
}

function mapHrefFor(s: TodaySite): string {
  return s.href || "/map";
}

function screeningLabel(score: number | null | undefined): string {
  if (score == null) return "Unscored";
  if (score >= 55) return "Good fit";
  return "Review planning";
}

export function DashboardClient() {
  const [data, setData] = useState<TodayPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<DevelopmentStrategy>("APARTMENTS");
  const [showSources, setShowSources] = useState(false);
  const [showAllChanges, setShowAllChanges] = useState(false);
  const [expandedFamily, setExpandedFamily] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const body = await fetchApiJson<TodayPayload>(`/api/dashboard?strategy=${strategy}`);
        if (!cancelled) {
          setData(body);
          setSelectedId((prev) => {
            if (prev && body.sitesToLookAt.some((s) => s.id === prev)) return prev;
            return body.sitesToLookAt[0]?.id ?? null;
          });
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [strategy]);

  if (error) {
    return <div className="p-5 text-[14px] text-bad">{error}</div>;
  }
  if (!data) {
    return <div className="p-5 text-[14px] text-muted">Loading…</div>;
  }

  const stories = data.topIntelligence?.length ? data.topIntelligence : data.whatChanged;
  const visibleChanges = showAllChanges ? stories : stories.slice(0, 5);
  const showWatched = data.showWatchedSection !== false && data.watchedChanges.length > 0;
  const strip = data.summaryStrip;
  const orientation = data.orientation?.trim() || todayOrientationLine();
  const selected = data.sitesToLookAt.find((s) => s.id === selectedId) ?? data.sitesToLookAt[0] ?? null;

  return (
    <div className="h-full overflow-y-auto bg-canvas">
      <div className="border-b border-line bg-panel/80 px-5 py-5 sm:px-6">
        <PageHeader
          eyebrow={data.marketScope?.label ?? "Greater Sydney"}
          title={data.headline || "Your development brief"}
          description={data.subheading}
          actions={
            data.morningReport ? (
              <Link
                href="/morning-report"
                className="text-[13px] font-semibold text-brand underline-offset-2 hover:underline"
              >
                {data.morningReport.summaryLine || data.morningReport.title} →
              </Link>
            ) : undefined
          }
        />
        <p className="mt-2 max-w-3xl text-[13px] leading-snug text-muted">{orientation}</p>
        <div className="mt-3">
          <StrategySelector value={strategy} onChange={setStrategy} variant="filter" />
        </div>
        {strip && (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <SummaryStat value={strip.planningChanges} label="planning updates" hint="New or updated recently" />
            <SummaryStat value={strip.worthChecking} label="sites to investigate" hint="Match your criteria" />
            <SummaryStat value={strip.watched} label="watched sites" hint="Changes or opportunities" />
          </div>
        )}
      </div>

      <div className="mx-auto grid max-w-[1480px] gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start sm:p-5">
        <div className="min-w-0 space-y-4">
          <section>
            <div className="mb-2 flex items-end justify-between gap-3">
              <div>
                <h2 className="font-display text-[18px] font-semibold text-ink">Sites worth investigating</h2>
                <p className="mt-0.5 text-[13px] text-muted">{sitesWorthLookingSubheading(strategy)}</p>
              </div>
              <Link href="/find" className="text-[12px] font-semibold text-brand hover:underline">
                Find more
              </Link>
            </div>
            <p className="mb-2 text-[12px] text-muted">
              <span className="font-semibold text-ink/70">SCREENING</span> = quick first-pass
              <span className="mx-1.5 text-line">·</span>
              <span className="font-semibold text-ink/70">DETAILED</span> = fully analysed
            </p>

            {data.indexPreparingMessage && !data.sitesToLookAt.length ? (
              <Empty>{data.indexPreparingMessage}</Empty>
            ) : !data.sitesToLookAt.length ? (
              <Empty>No sites ranked for this strategy yet.</Empty>
            ) : (
              <Panel bodyClassName="p-0" className="overflow-hidden">
                <div className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.1fr)_88px_72px] gap-3 border-b border-line bg-canvas/60 px-4 py-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted xl:grid">
                  <span>Site</span>
                  <span>Key details</span>
                  <span>Planning</span>
                  <span className="text-right">Area</span>
                  <span className="text-center">Screening</span>
                </div>
                <ul>
                  {data.sitesToLookAt.map((s, i) => {
                    const detailed = s.scoreProvenance === "DETAILED";
                    const alts = s.familyAlternativeCount ?? 0;
                    const why =
                      s.whyItMatters?.trim() || (s.reasons[0] ? s.reasons[0] : "Worth checking on the map");
                    const isSelected = selected?.id === s.id;
                    return (
                      <li key={s.id}>
                        <ListRow
                          selected={isSelected}
                          onSelect={() => setSelectedId(s.id)}
                          className="!grid-cols-1 xl:!grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.1fr)_88px_72px] xl:items-center"
                          trailing={undefined}
                        >
                          <div className="grid gap-3 xl:col-span-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.1fr)_88px_72px] xl:items-center">
                            <div className="flex min-w-0 gap-3">
                              <div className="num w-5 shrink-0 pt-0.5 text-[13px] font-bold text-muted">{i + 1}</div>
                              <div className="min-w-0">
                                <div className="truncate text-[14px] font-semibold leading-snug text-ink">
                                  {s.address || s.name}
                                </div>
                                <div className="mt-0.5 text-[12.5px] text-muted">{why}</div>
                                {alts > 0 && (
                                  <button
                                    type="button"
                                    className="mt-1 text-[11.5px] font-semibold text-brand hover:underline"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setExpandedFamily((id) => (id === s.id ? null : s.id));
                                    }}
                                  >
                                    + {alts} other lot combination{alts === 1 ? "" : "s"} nearby
                                  </button>
                                )}
                                {expandedFamily === s.id && alts > 0 && (
                                  <p className="mt-1 text-[12px] text-muted">
                                    Other ways to combine lots on this street exist. Open the map to compare them.
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="text-[12.5px] text-muted">
                              {[
                                s.suburb ?? s.lga ?? "Sydney",
                                s.lotCount != null ? `${s.lotCount} lot${s.lotCount === 1 ? "" : "s"}` : null,
                                s.owners != null ? `${s.owners} owner${s.owners === 1 ? "" : "s"}` : null,
                                s.parcelHint && !(s.address || "").match(/\d/) ? s.parcelHint : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                              {detailed && (
                                <div className="mt-1">
                                  <StatusChip tone="brand">Detailed</StatusChip>
                                </div>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {s.zone && <StatusChip tone="zone">{s.zone}</StatusChip>}
                              {s.currentFsr != null && <StatusChip tone="fsr">FSR {fsr(s.currentFsr)}</StatusChip>}
                              {s.proposedFsr != null &&
                                (s.currentFsr == null || s.proposedFsr > s.currentFsr) && (
                                  <StatusChip tone="proposed">Proposed {fsr(s.proposedFsr)}</StatusChip>
                                )}
                              {s.stationDistanceM != null && s.stationDistanceM <= 1200 && (
                                <StatusChip tone="neutral">~{Math.round(s.stationDistanceM)}m station</StatusChip>
                              )}
                            </div>
                            <div className="num text-right text-[13px] font-semibold text-ink">
                              {s.siteAreaSqm != null ? sqm(s.siteAreaSqm) : "—"}
                            </div>
                            <div className="flex justify-center">
                              <ScoreRing score={s.score} label={screeningLabel(s.score)} />
                            </div>
                          </div>
                        </ListRow>
                      </li>
                    );
                  })}
                </ul>
              </Panel>
            )}
          </section>

          <section>
            <div className="mb-2 flex items-end justify-between gap-3">
              <div>
                <h2 className="font-display text-[18px] font-semibold text-ink">Planning updates</h2>
                <p className="mt-0.5 text-[13px] text-muted">
                  Recent planning and development updates that could affect potential sites.
                </p>
              </div>
              <Link href="/feed" className="text-[12px] font-semibold text-brand hover:underline">
                View all updates
              </Link>
            </div>
            {!stories.length ? (
              <Empty>No new planning or development updates in Greater Sydney in the last 7 days.</Empty>
            ) : (
              <Panel bodyClassName="p-0" className="overflow-hidden">
                <ul>
                  {visibleChanges.map((ev) => {
                    const presented =
                      ev.typeLabel && ev.title && ev.whyItMatters
                        ? {
                            typeLabel: ev.typeLabel,
                            title: ev.title,
                            explanation: ev.whyItMatters || ev.whatChanged,
                          }
                        : presentTodayStory(ev, strategy);
                    const sitesLabel =
                      ev.affectedSites == null || ev.affectedSites <= 0
                        ? null
                        : ev.affectedSites === 1
                          ? "1 potential site affected"
                          : `${ev.affectedSites} potential sites affected`;
                    const viewSitesLabel = ev.affectedSites === 1 ? "View site" : "View affected sites";
                    return (
                      <li
                        key={ev.id}
                        className="grid gap-2 border-b border-line px-4 py-3 last:border-b-0 sm:grid-cols-[110px_minmax(0,1fr)_auto] sm:items-start"
                      >
                        <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
                          {formatShortDate(ev.date)}
                          <div className="mt-1 normal-case tracking-normal">
                            <StatusChip tone={/proposed/i.test(presented.typeLabel) ? "proposed" : "neutral"}>
                              {presented.typeLabel}
                            </StatusChip>
                          </div>
                        </div>
                        <div className="min-w-0">
                          <div className="text-[14px] font-semibold leading-snug">{presented.title}</div>
                          <p className="mt-0.5 text-[13px] text-ink/85">{presented.explanation}</p>
                          {sitesLabel && <p className="mt-0.5 text-[12px] text-muted">{sitesLabel}</p>}
                        </div>
                        <div className="flex shrink-0 flex-col items-start gap-1.5 sm:items-end">
                          {(ev.mapHref || ev.href) && (
                            <Link
                              href={ev.mapHref || ev.href || "/map"}
                              className="text-[12px] font-semibold text-brand hover:underline"
                            >
                              Show on map
                            </Link>
                          )}
                          <Link
                            href={ev.findHref || `/find?strategy=${strategy}`}
                            className="text-[12px] font-semibold text-brand hover:underline"
                          >
                            {viewSitesLabel}
                          </Link>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {stories.length > 5 && (
                  <button
                    type="button"
                    className="w-full border-t border-line px-4 py-2.5 text-left text-[12px] font-semibold text-muted hover:bg-canvas hover:text-ink"
                    onClick={() => setShowAllChanges((v) => !v)}
                  >
                    {showAllChanges ? "Show fewer updates" : `View all updates (${stories.length})`}
                  </button>
                )}
              </Panel>
            )}
          </section>

          {(showWatched || data.developmentActivity.length > 0) && (
            <div className={cx("grid gap-3", showWatched ? "lg:grid-cols-2" : "")}>
              {showWatched && (
                <section>
                  <div className="mb-2 flex items-end justify-between gap-3">
                    <div>
                      <h2 className="font-display text-[18px] font-semibold text-ink">Sites you&apos;re watching</h2>
                      <p className="mt-0.5 text-[13px] text-muted">Updates to sites you&apos;ve already saved or analysed.</p>
                    </div>
                    <Link href="/watching" className="text-[12px] font-semibold text-brand hover:underline">
                      Manage
                    </Link>
                  </div>
                  <Panel bodyClassName="p-0" className="overflow-hidden">
                    <ul>
                      {data.watchedChanges.map((c) => (
                        <li key={c.id} className="border-b border-line px-4 py-2.5 last:border-b-0">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
                            {todayTypeLabel(c.type, c.title)} · {formatShortDate(c.date)}
                          </div>
                          {c.href ? (
                            <Link href={c.href} className="mt-0.5 block text-[14px] font-semibold hover:text-brand">
                              {c.title}
                            </Link>
                          ) : (
                            <div className="mt-0.5 text-[14px] font-semibold">{c.title}</div>
                          )}
                          {c.summary && <p className="text-[12.5px] text-muted">{c.summary}</p>}
                        </li>
                      ))}
                    </ul>
                  </Panel>
                </section>
              )}

              <section>
                <div className="mb-2">
                  <h2 className="font-display text-[18px] font-semibold text-ink">Development activity</h2>
                </div>
                <Panel bodyClassName="p-0" className="overflow-hidden">
                  <ul>
                    {!data.developmentActivity.length ? (
                      <li className="px-4 py-3 text-[13px] text-muted">New applications and assessments will show up here.</li>
                    ) : (
                      data.developmentActivity.slice(0, 5).map((a) => (
                        <li key={a.id} className="border-b border-line px-4 py-2.5 last:border-b-0">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
                            {todayTypeLabel(a.kind, a.title)} · {formatShortDate(a.createdAt)}
                          </div>
                          {a.href ? (
                            <Link href={a.href} className="mt-0.5 block text-[14px] font-semibold hover:text-brand">
                              {a.title}
                            </Link>
                          ) : (
                            <div className="mt-0.5 text-[14px] font-semibold">{a.title}</div>
                          )}
                          {a.summary && <p className="text-[12.5px] text-muted">{a.summary}</p>}
                        </li>
                      ))
                    )}
                  </ul>
                </Panel>
              </section>
            </div>
          )}

          <div className="border-t border-line pt-2">
            <button
              type="button"
              className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted hover:text-ink"
              onClick={() => setShowSources((v) => !v)}
            >
              {showSources ? "Hide source freshness" : "Source freshness"}
            </button>
            {showSources && (
              <div className="mt-2 grid gap-1 text-[12px] text-muted sm:grid-cols-2 lg:grid-cols-3">
                {data.sourceFreshness.map((s) => (
                  <div key={s.id} className="rounded-[7px] border border-line bg-panel px-2 py-1.5">
                    <div className="font-medium text-ink/80">{s.name}</div>
                    <div>Last OK · {s.lastSuccessfulAt?.slice(0, 16) ?? "—"}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <aside className="lg:sticky lg:top-4">
          {selected ? (
            <SelectedSitePanel site={selected} />
          ) : (
            <Panel>
              <p className="text-[13px] text-muted">Select a site to see planning controls and open the map.</p>
            </Panel>
          )}
        </aside>
      </div>
    </div>
  );
}

function SummaryStat({ value, label, hint }: { value: number; label: string; hint: string }) {
  return (
    <div className="rounded-[8px] border border-line bg-panel px-4 py-3 shadow-[0_1px_2px_rgba(23,40,43,0.04)]">
      <div className="num font-display text-[28px] font-semibold leading-none text-ink">{value}</div>
      <div className="mt-1 text-[13px] font-semibold text-ink">{label}</div>
      <div className="mt-0.5 text-[12px] text-muted">{hint}</div>
    </div>
  );
}

function SelectedSitePanel({ site }: { site: TodaySite }) {
  const detailed = site.scoreProvenance === "DETAILED";
  const analyse = primaryHref(site);
  const map = mapHrefFor(site);
  const hasProposed =
    site.proposedFsr != null && (site.currentFsr == null || site.proposedFsr > site.currentFsr);

  return (
    <Panel className="overflow-hidden" bodyClassName="p-0">
      <div className="relative h-[160px] bg-[linear-gradient(145deg,#2a4548_0%,#132b2d_55%,#1a3538_100%)]">
        <div className="absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_20%_30%,#be9956_0,transparent_40%),radial-gradient(circle_at_80%_70%,#fffefa22_0,transparent_35%)]" />
        <div className="absolute bottom-3 left-3 right-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/55">Selected site</div>
          <div className="font-display mt-0.5 truncate text-[20px] font-semibold text-white">
            {site.address || site.name}
          </div>
          <div className="mt-0.5 text-[12.5px] text-white/70">
            {[
              site.lotCount != null ? `${site.lotCount} propert${site.lotCount === 1 ? "y" : "ies"}` : null,
              site.siteAreaSqm != null ? sqm(site.siteAreaSqm) : null,
              site.suburb,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
      </div>
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Current planning</div>
            <dl className="mt-1.5 space-y-1.5 text-[13px]">
              <div className="flex justify-between gap-3 border-b border-line pb-1.5">
                <dt className="text-muted">Zone</dt>
                <dd className="font-semibold">{site.zone ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-3 border-b border-line pb-1.5">
                <dt className="text-muted">FSR</dt>
                <dd className="num font-semibold">{site.currentFsr != null ? fsr(site.currentFsr) : "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Provenance</dt>
                <dd className="font-semibold">{detailed ? "Detailed" : "Screening"}</dd>
              </div>
            </dl>
          </div>
          <ScoreRing score={site.score} label={screeningLabel(site.score)} />
        </div>

        {hasProposed && (
          <div className="rounded-[7px] border border-accent/35 bg-accent-soft/80 px-3 py-2 text-[12.5px] text-warn">
            Proposed planning — Review separately from current controls
            {site.proposedFsr != null ? ` (FSR ${fsr(site.proposedFsr)})` : ""}.
          </div>
        )}

        {detailed && (
          <div className="space-y-1 text-[12.5px]">
            {site.existingValue != null && (
              <div>
                Existing <span className="num font-semibold">{money(site.existingValue, { compact: true })}</span>
              </div>
            )}
            {site.maxPayable != null && (
              <div>
                Max payable <span className="num font-semibold">{money(site.maxPayable, { compact: true })}</span>
              </div>
            )}
            {site.headroom != null && (
              <div className={cx(site.headroom > 0 ? "text-good" : "text-muted")}>
                Headroom <span className="num font-semibold">{money(site.headroom, { compact: true })}</span>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2 pt-1">
          <Link
            href={analyse}
            className="inline-flex h-10 items-center justify-center rounded-[7px] bg-brand px-3 text-[13px] font-semibold text-white hover:bg-[#0e2325]"
          >
            Open analysis →
          </Link>
          <Link
            href={map}
            className="inline-flex h-10 items-center justify-center rounded-[7px] border border-line bg-panel px-3 text-[13px] font-semibold text-ink hover:bg-canvas"
          >
            Open map
          </Link>
        </div>
        <p className="text-[11px] leading-snug text-muted">
          Figures come from live app data for this workspace — not the illustrative concept mock.
        </p>
      </div>
    </Panel>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[8px] border border-dashed border-line bg-panel/60 px-4 py-5 text-[13px] text-muted">
      {children}
    </div>
  );
}
