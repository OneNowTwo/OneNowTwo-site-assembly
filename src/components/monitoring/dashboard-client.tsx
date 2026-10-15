"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, cx } from "@/components/ui";
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

function typeLabel(kind: string) {
  if (kind.includes("KEY_SITE") || kind === "KEY_SITE_PROGRAM") return "KEY SITE";
  if (kind.includes("DEVELOPMENT") || kind.includes("HDA") || kind.includes("SSD") || kind.includes("DA_")) {
    return "DEVELOPMENT";
  }
  if (kind.includes("FSR") || kind.includes("HEIGHT") || kind.includes("ZONE") || kind.includes("PLANNING")) {
    return "PLANNING CHANGE";
  }
  return kind.replaceAll("_", " ").toUpperCase();
}

function formatShortDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" }).toUpperCase();
}

function primaryHref(s: TodaySite): string {
  if (s.analyseHref) return s.analyseHref;
  return s.href || "/map";
}

export function DashboardClient() {
  const router = useRouter();
  const [data, setData] = useState<TodayPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<DevelopmentStrategy>("APARTMENTS");
  const [showSources, setShowSources] = useState(false);
  const [showAllChanges, setShowAllChanges] = useState(false);
  const [expandedFamily, setExpandedFamily] = useState<string | null>(null);

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
    return <div className="p-5 text-[13px] text-bad">{error}</div>;
  }
  if (!data) {
    return <div className="p-5 text-[13px] text-muted">Loading…</div>;
  }

  const stories = data.topIntelligence?.length ? data.topIntelligence : data.whatChanged;
  const visibleChanges = showAllChanges ? stories : stories.slice(0, 5);
  const showWatched = data.showWatchedSection !== false && data.watchedChanges.length > 0;
  const strip = data.summaryStrip;

  return (
    <div className="h-full overflow-y-auto bg-canvas">
      {/* Compact header — daily entry point */}
      <div className="border-b border-line bg-[#0b2f49] px-5 py-4 text-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/65">
              {data.marketScope?.label ?? "Greater Sydney"}
            </div>
            <h1 className="text-[22px] font-semibold tracking-tight leading-tight">{data.headline}</h1>
          </div>
          {data.morningReport && (
            <Link href="/morning-report" className="text-[12px] font-semibold text-white/85 underline-offset-2 hover:underline">
              {data.morningReport.summaryLine || data.morningReport.title} →
            </Link>
          )}
        </div>

        <div className="mt-3">
          <StrategySelector value={strategy} onChange={setStrategy} tone="dark" variant="filter" />
        </div>

        {strip && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-white/80">
            <span>
              <span className="num font-semibold text-white">{strip.indexedSites.toLocaleString("en-AU")}</span> indexed
            </span>
            <span className="text-white/35">·</span>
            <span>
              <span className="num font-semibold text-white">{strip.analysedToday}</span> analysed in list
            </span>
            <span className="text-white/35">·</span>
            <span>
              <span className="num font-semibold text-white">{strip.worthChecking}</span> worth checking
            </span>
            <span className="text-white/35">·</span>
            <span>
              <span className="num font-semibold text-white">{strip.planningChanges}</span> planning changes
            </span>
            {strip.watched > 0 && (
              <>
                <span className="text-white/35">·</span>
                <span>
                  <span className="num font-semibold text-white">{strip.watched}</span> watched
                </span>
              </>
            )}
          </div>
        )}
      </div>

      <div className="mx-auto max-w-[1400px] space-y-4 p-4 sm:p-5">
        {/* A. TOP OPPORTUNITIES — dominant */}
        <section>
          <div className="mb-2 flex items-end justify-between gap-3">
            <h2 className="text-[13px] font-semibold text-ink">Top opportunities today</h2>
            <Link href="/find" className="text-[11px] font-semibold text-brand hover:underline">
              Find more
            </Link>
          </div>

          {data.indexPreparingMessage && !data.sitesToLookAt.length ? (
            <Empty>{data.indexPreparingMessage}</Empty>
          ) : !data.sitesToLookAt.length ? (
            <Empty>No sites ranked for this strategy yet.</Empty>
          ) : (
            <div className="overflow-hidden rounded-[3px] border border-line bg-white">
              <ul className="divide-y divide-line">
                {data.sitesToLookAt.map((s, i) => {
                  const detailed = s.scoreProvenance === "DETAILED";
                  const href = primaryHref(s);
                  const alts = s.familyAlternativeCount ?? 0;
                  const why =
                    s.whyItMatters?.trim() ||
                    (s.reasons[0] ? s.reasons[0] : "Worth checking on the map");
                  const planningBits = [
                    s.zone ? `Zone ${s.zone}` : null,
                    s.currentFsr != null ? `FSR ${fsr(s.currentFsr)}` : null,
                    s.proposedFsr != null && (s.currentFsr == null || s.proposedFsr > s.currentFsr)
                      ? `Pathway ${fsr(s.proposedFsr)}`
                      : null,
                    s.stationDistanceM != null && s.stationDistanceM <= 1200
                      ? `~${Math.round(s.stationDistanceM)}m station`
                      : null,
                  ].filter(Boolean);

                  return (
                    <li key={s.id}>
                      <div
                        role="link"
                        tabIndex={0}
                        onClick={() => router.push(href)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            router.push(href);
                          }
                        }}
                        className="grid cursor-pointer grid-cols-12 gap-3 px-3 py-2.5 transition-colors hover:bg-brand-soft/30 focus:bg-brand-soft/40 focus:outline-none sm:px-4"
                      >
                        {/* LEFT: rank + identity */}
                        <div className="col-span-12 flex gap-3 sm:col-span-4 lg:col-span-3">
                          <div className="num w-6 shrink-0 pt-0.5 text-[13px] font-bold text-muted">{i + 1}</div>
                          <div className="min-w-0">
                            <div className="truncate text-[14px] font-semibold leading-snug text-ink">
                              {s.address || s.name}
                            </div>
                            <div className="mt-0.5 text-[12px] text-muted">
                              {[
                                s.suburb ?? s.lga ?? "Sydney",
                                s.lotCount != null ? `${s.lotCount} lot${s.lotCount === 1 ? "" : "s"}` : null,
                                s.siteAreaSqm != null ? sqm(s.siteAreaSqm) : null,
                                s.parcelHint && !(s.address || "").match(/\d/) ? s.parcelHint : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </div>
                            {alts > 0 && (
                              <button
                                type="button"
                                className="mt-1 text-[11px] font-semibold text-brand hover:underline"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedFamily((id) => (id === s.id ? null : s.id));
                                }}
                              >
                                + {alts} alternative assembly configuration{alts === 1 ? "" : "s"}
                              </button>
                            )}
                          </div>
                        </div>

                        {/* MIDDLE: why + planning */}
                        <div className="col-span-12 min-w-0 sm:col-span-5 lg:col-span-5">
                          <div className="text-[13px] leading-snug text-ink">{why}</div>
                          {planningBits.length > 0 && (
                            <div className="mt-1 text-[11.5px] text-muted">{planningBits.join(" · ")}</div>
                          )}
                          {expandedFamily === s.id && alts > 0 && (
                            <p className="mt-1.5 text-[11.5px] text-muted">
                              Other overlapping lot configurations exist in the index family. Open Map to compare
                              assemblies on the same street — only this primary row is ranked for Today.
                            </p>
                          )}
                        </div>

                        {/* FINANCIAL + RIGHT */}
                        <div className="col-span-12 flex items-start justify-between gap-3 sm:col-span-3 lg:col-span-4">
                          <div className="min-w-0 text-[12px]">
                            {detailed ? (
                              <div className="space-y-0.5">
                                <div className="text-[10.5px] uppercase tracking-wide text-muted">Detailed</div>
                                {s.existingValue != null && (
                                  <div>
                                    Existing{" "}
                                    <span className="num font-semibold">{money(s.existingValue, { compact: true })}</span>
                                  </div>
                                )}
                                {s.maxPayable != null && (
                                  <div>
                                    Max payable{" "}
                                    <span className="num font-semibold">{money(s.maxPayable, { compact: true })}</span>
                                  </div>
                                )}
                                {s.headroom != null && (
                                  <div className={cx(s.headroom > 0 ? "text-good" : "text-muted")}>
                                    Headroom{" "}
                                    <span className="num font-semibold">{money(s.headroom, { compact: true })}</span>
                                  </div>
                                )}
                                {s.maxPayable == null && s.headroom == null && (
                                  <div className="text-muted">Open for full economics</div>
                                )}
                              </div>
                            ) : (
                              <div>
                                <Badge tone="neutral">SCREENING</Badge>
                                <div className="mt-1 text-[11.5px] text-muted">Discovery ranking only</div>
                              </div>
                            )}
                          </div>

                          <div className="flex shrink-0 flex-col items-end gap-1.5">
                            <div className="text-right">
                              <div className="num text-[18px] font-bold leading-none text-ink">
                                {s.score != null ? Math.round(s.score) : "—"}
                              </div>
                              <div
                                className={cx(
                                  "mt-0.5 text-[10px] font-bold uppercase tracking-[0.08em]",
                                  detailed ? "text-brand" : "text-muted",
                                )}
                              >
                                {detailed ? "DETAILED" : "SCREENING"}
                              </div>
                            </div>
                            <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                              <Link
                                href={s.href || "/map"}
                                className="rounded-[3px] border border-line px-2 py-1 text-[11px] font-semibold hover:bg-canvas"
                              >
                                Map
                              </Link>
                              {detailed && s.analyseHref && (
                                <Link
                                  href={s.analyseHref}
                                  className="rounded-[3px] bg-brand px-2 py-1 text-[11px] font-semibold text-white"
                                >
                                  Open
                                </Link>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>

        {/* B. WHAT CHANGED — compact feed */}
        <section>
          <div className="mb-2 flex items-end justify-between gap-3">
            <h2 className="text-[13px] font-semibold text-ink">What changed</h2>
            <Link href="/feed" className="text-[11px] font-semibold text-brand hover:underline">
              View all changes
            </Link>
          </div>
          {!stories.length ? (
            <Empty>Nothing material in Greater Sydney in the last 7 days.</Empty>
          ) : (
            <div className="overflow-hidden rounded-[3px] border border-line bg-white">
              <ul className="divide-y divide-line">
                {visibleChanges.map((ev) => (
                  <li key={ev.id} className="flex flex-wrap items-start gap-3 px-3 py-2 sm:px-4">
                    <div className="w-full shrink-0 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted sm:w-40">
                      {typeLabel(ev.type)}
                      <span className="text-muted/70"> · {formatShortDate(ev.date)}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold leading-snug">{ev.title}</div>
                      <p className="mt-0.5 text-[12.5px] text-ink/85">
                        {ev.whyItMatters || ev.whatChanged}
                        {ev.affectedSites != null && ev.affectedSites > 0
                          ? ` ${ev.affectedSites} indexed assemblies in scope.`
                          : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {(ev.mapHref || ev.href) && (
                        <Link
                          href={ev.mapHref || ev.href || "/map"}
                          className="text-[11px] font-semibold text-brand hover:underline"
                        >
                          Map
                        </Link>
                      )}
                      <Link
                        href={ev.findHref || `/find?strategy=${strategy}`}
                        className="text-[11px] font-semibold text-brand hover:underline"
                      >
                        View sites
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
              {stories.length > 5 && (
                <button
                  type="button"
                  className="w-full border-t border-line px-3 py-2 text-left text-[11px] font-semibold text-muted hover:bg-canvas hover:text-ink"
                  onClick={() => setShowAllChanges((v) => !v)}
                >
                  {showAllChanges ? "Show fewer changes" : `View all changes (${stories.length})`}
                </button>
              )}
            </div>
          )}
        </section>

        {/* C. WATCHED / FOLLOW-UP */}
        {(showWatched || data.developmentActivity.length > 0) && (
          <div className={cx("grid gap-3", showWatched ? "lg:grid-cols-2" : "")}>
            {showWatched && (
              <section>
                <div className="mb-2 flex items-end justify-between gap-3">
                  <h2 className="text-[13px] font-semibold text-ink">Watched / follow-up</h2>
                  <Link href="/watching" className="text-[11px] font-semibold text-brand hover:underline">
                    Manage
                  </Link>
                </div>
                <ul className="divide-y divide-line overflow-hidden rounded-[3px] border border-line bg-white">
                  {data.watchedChanges.map((c) => (
                    <li key={c.id} className="px-3 py-2 sm:px-4">
                      <div className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted">
                        {typeLabel(c.type)} · {formatShortDate(c.date)}
                      </div>
                      {c.href ? (
                        <Link href={c.href} className="mt-0.5 block text-[13px] font-semibold hover:text-brand">
                          {c.title}
                        </Link>
                      ) : (
                        <div className="mt-0.5 text-[13px] font-semibold">{c.title}</div>
                      )}
                      {c.summary && <p className="text-[12px] text-muted">{c.summary}</p>}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section>
              <div className="mb-2">
                <h2 className="text-[13px] font-semibold text-ink">Development activity</h2>
              </div>
              <ul className="divide-y divide-line overflow-hidden rounded-[3px] border border-line bg-white">
                {!data.developmentActivity.length ? (
                  <li className="px-3 py-3 text-[12px] text-muted sm:px-4">
                    New applications and assessments will show up here.
                  </li>
                ) : (
                  data.developmentActivity.slice(0, 5).map((a) => (
                    <li key={a.id} className="px-3 py-2 sm:px-4">
                      <div className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted">
                        {a.kind.replaceAll("_", " ")} · {formatShortDate(a.createdAt)}
                      </div>
                      {a.href ? (
                        <Link href={a.href} className="mt-0.5 block text-[13px] font-semibold hover:text-brand">
                          {a.title}
                        </Link>
                      ) : (
                        <div className="mt-0.5 text-[13px] font-semibold">{a.title}</div>
                      )}
                      {a.summary && <p className="text-[12px] text-muted">{a.summary}</p>}
                    </li>
                  ))
                )}
              </ul>
            </section>
          </div>
        )}

        {/* D. diagnostics / sources — tertiary */}
        <div className="border-t border-line pt-2">
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
                <div key={s.id} className="rounded-[3px] border border-line bg-white px-2 py-1.5">
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

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[3px] border border-dashed border-line bg-white/60 px-4 py-5 text-[12.5px] text-muted">
      {children}
    </div>
  );
}
