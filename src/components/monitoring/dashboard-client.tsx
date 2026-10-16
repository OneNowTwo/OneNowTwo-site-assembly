"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, cx } from "@/components/ui";
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

type ControlSnap = {
  zone?: string | null;
  fsr?: number | null;
  heightM?: number | null;
  affordableHousingContributionPct?: number | null;
  notes?: string | null;
};

type ScreeningSample = {
  lng: number;
  lat: number;
  zone?: string | null;
  fsr?: number | null;
  heightM?: number | null;
  mixedAcrossKeySite: boolean;
  distinctZones?: string[];
  distinctFsrs?: number[];
  distinctHeights?: number[];
  scope: "INTERIOR_POINT_SAMPLE";
};

type StoryDetail = {
  officialTitle: string | null;
  locationLabel: string | null;
  areaLabel: string | null;
  status: string | null;
  awaitingVerification: boolean;
  plainSummary: string | null;
  previousControls: ControlSnap | null;
  proposedControls: ControlSnap | null;
  screeningSample?: ScreeningSample | null;
  officialDate: string | null;
  officialDateLabel: string | null;
  detectedAt: string | null;
  whyItMatters: string | null;
  sourceName: string | null;
  documentTitle: string | null;
  documentSection: string | null;
  sourceUrl: string | null;
  webpageUrl: string | null;
  planningChangeAreaId: string | null;
  keySiteIds: string[];
  affectedCandidateIds: string[];
  mapHref: string | null;
  findHref: string | null;
  cardTitle?: string;
  cardExplanation?: string;
  typeLabel?: string;
  affectedSites?: number | null;
};

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
  detail?: StoryDetail | null;
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

export function DashboardClient() {
  const router = useRouter();
  const [data, setData] = useState<TodayPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<DevelopmentStrategy>("APARTMENTS");
  const [showSources, setShowSources] = useState(false);
  const [showAllChanges, setShowAllChanges] = useState(false);
  const [expandedFamily, setExpandedFamily] = useState<string | null>(null);
  const [selectedUpdate, setSelectedUpdate] = useState<Story | null>(null);

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
  const orientation = data.orientation?.trim() || todayOrientationLine();

  return (
    <div className="h-full overflow-y-auto bg-canvas">
      {/* Compact header — daily entry point */}
      <div className="border-b border-line bg-[#0b2f49] px-5 py-4 text-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/65">
              {data.marketScope?.label ?? "Greater Sydney"}
            </div>
            <h1 className="text-[22px] font-semibold tracking-tight leading-tight">
              {data.headline || "Your development brief"}
            </h1>
            <p className="mt-1 max-w-2xl text-[13px] leading-snug text-white/80">
              {data.subheading}
            </p>
          </div>
          {data.morningReport && (
            <Link href="/morning-report" className="text-[12px] font-semibold text-white/85 underline-offset-2 hover:underline">
              {data.morningReport.summaryLine || data.morningReport.title} →
            </Link>
          )}
        </div>

        <p className="mt-2 max-w-3xl text-[12px] leading-snug text-white/65">{orientation}</p>

        <div className="mt-3">
          <StrategySelector value={strategy} onChange={setStrategy} tone="dark" variant="filter" />
        </div>

        {strip && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-white/80">
            <span>
              <span className="num font-semibold text-white">{strip.indexedSites.toLocaleString("en-AU")}</span>{" "}
              potential sites
            </span>
            <span className="text-white/35">·</span>
            <span>
              <span className="num font-semibold text-white">{strip.analysedToday}</span> fully analysed
            </span>
            <span className="text-white/35">·</span>
            <span>
              <span className="num font-semibold text-white">{strip.worthChecking}</span> worth looking at
            </span>
            <span className="text-white/35">·</span>
            <span>
              <span className="num font-semibold text-white">{strip.planningChanges}</span> new planning updates
            </span>
            {strip.watched > 0 && (
              <>
                <span className="text-white/35">·</span>
                <span>
                  <span className="num font-semibold text-white">{strip.watched}</span> watched sites
                </span>
              </>
            )}
          </div>
        )}
      </div>

      <div className="mx-auto max-w-[1400px] space-y-4 p-4 sm:p-5">
        {/* A. SITES WORTH LOOKING AT — dominant */}
        <section>
          <div className="mb-1 flex items-end justify-between gap-3">
            <div>
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink">
                Sites worth looking at
              </h2>
              <p className="mt-0.5 text-[12px] text-muted">{sitesWorthLookingSubheading(strategy)}</p>
            </div>
            <Link href="/find" className="text-[11px] font-semibold text-brand hover:underline">
              Find more
            </Link>
          </div>
          <p className="mb-2 text-[11.5px] text-muted">
            <span className="font-semibold text-ink/70">SCREENING</span> = quick first-pass assessment
            <span className="mx-1.5 text-line">·</span>
            <span className="font-semibold text-ink/70">DETAILED</span> = site has been fully analysed
          </p>

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
                      ? `Proposed ${fsr(s.proposedFsr)}`
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
                                + {alts} other lot combination{alts === 1 ? "" : "s"} nearby
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
                              Other ways to combine lots on this street exist. Open the map to compare them.
                            </p>
                          )}
                        </div>

                        {/* FINANCIAL + RIGHT */}
                        <div className="col-span-12 flex items-start justify-between gap-3 sm:col-span-3 lg:col-span-4">
                          <div className="min-w-0 text-[12px]">
                            {detailed ? (
                              <div className="space-y-0.5">
                                <div className="text-[10.5px] font-semibold uppercase tracking-wide text-brand">
                                  DETAILED
                                </div>
                                <div className="text-[11px] text-muted">Full analysis</div>
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
                                <div className="mt-1 text-[11.5px] text-muted">Quick assessment</div>
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
                                Show on map
                              </Link>
                              {detailed && s.analyseHref && (
                                <Link
                                  href={s.analyseHref}
                                  className="rounded-[3px] bg-brand px-2 py-1 text-[11px] font-semibold text-white"
                                >
                                  Open analysis
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

        {/* B. WHAT YOU NEED TO KNOW — compact feed */}
        <section>
          <div className="mb-2 flex items-end justify-between gap-3">
            <div>
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink">
                What you need to know
              </h2>
              <p className="mt-0.5 text-[12px] text-muted">
                Recent planning and development updates that could affect potential sites.
              </p>
            </div>
            <Link href="/feed" className="text-[11px] font-semibold text-brand hover:underline">
              View all updates
            </Link>
          </div>
          {!stories.length ? (
            <Empty>No new planning or development updates in Greater Sydney in the last 7 days.</Empty>
          ) : (
            <div className="overflow-hidden rounded-[3px] border border-line bg-white">
              <ul className="divide-y divide-line">
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
                  const viewSitesLabel =
                    ev.affectedSites === 1 ? "View site" : "View affected sites";
                  return (
                    <li key={ev.id} className="flex flex-wrap items-start gap-3 px-3 py-2.5 sm:px-4">
                      <div className="w-full shrink-0 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted sm:w-44">
                        {presented.typeLabel}
                        <span className="text-muted/70"> · {formatShortDate(ev.date)}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          className="text-left text-[13px] font-semibold leading-snug text-ink hover:text-brand hover:underline"
                          onClick={() => setSelectedUpdate(ev)}
                        >
                          {presented.title}
                        </button>
                        <p className="mt-0.5 text-[12.5px] text-ink/85">{presented.explanation}</p>
                        {sitesLabel && <p className="mt-0.5 text-[11.5px] text-muted">{sitesLabel}</p>}
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          className="text-[11px] font-semibold text-brand hover:underline"
                          onClick={() => setSelectedUpdate(ev)}
                        >
                          Details
                        </button>
                        {(ev.mapHref || ev.href) && (
                          <Link
                            href={ev.mapHref || ev.href || "/map"}
                            className="text-[11px] font-semibold text-brand hover:underline"
                          >
                            Show on map
                          </Link>
                        )}
                        <Link
                          href={ev.findHref || `/find?strategy=${strategy}`}
                          className="text-[11px] font-semibold text-brand hover:underline"
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
                  className="w-full border-t border-line px-3 py-2 text-left text-[11px] font-semibold text-muted hover:bg-canvas hover:text-ink"
                  onClick={() => setShowAllChanges((v) => !v)}
                >
                  {showAllChanges ? "Show fewer updates" : `View all updates (${stories.length})`}
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
                  <div>
                    <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink">
                      Sites you&apos;re watching
                    </h2>
                    <p className="mt-0.5 text-[12px] text-muted">
                      Updates to sites you&apos;ve already saved or analysed.
                    </p>
                  </div>
                  <Link href="/watching" className="text-[11px] font-semibold text-brand hover:underline">
                    Manage
                  </Link>
                </div>
                <ul className="divide-y divide-line overflow-hidden rounded-[3px] border border-line bg-white">
                  {data.watchedChanges.map((c) => (
                    <li key={c.id} className="px-3 py-2 sm:px-4">
                      <div className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted">
                        {todayTypeLabel(c.type, c.title)} · {formatShortDate(c.date)}
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
                <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink">
                  Development activity
                </h2>
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
                        {todayTypeLabel(a.kind, a.title)} · {formatShortDate(a.createdAt)}
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

      {selectedUpdate && (
        <PlanningUpdateDetailPanel
          story={selectedUpdate}
          strategy={strategy}
          onClose={() => setSelectedUpdate(null)}
        />
      )}
    </div>
  );
}

function formatControlSnap(c: ControlSnap | null | undefined): string | null {
  if (!c) return null;
  const bits: string[] = [];
  if (c.zone) bits.push(`Zone ${c.zone}`);
  if (c.fsr != null) bits.push(`FSR ${c.fsr}`);
  if (c.heightM != null) bits.push(`Height ${c.heightM} m`);
  if (c.affordableHousingContributionPct != null) {
    bits.push(`AH ${c.affordableHousingContributionPct}%`);
  }
  return bits.length ? bits.join(" · ") : null;
}

function PlanningUpdateDetailPanel({
  story,
  strategy,
  onClose,
}: {
  story: Story;
  strategy: string;
  onClose: () => void;
}) {
  const d = story.detail;
  const title = d?.officialTitle || story.title;
  const location = d?.locationLabel || story.location;
  const status = d?.status?.replaceAll("_", " ") ?? null;
  const mapHref = d?.mapHref || story.mapHref || story.href;
  const findHref = d?.findHref || story.findHref || `/find?strategy=${strategy}`;
  const previousLabel = formatControlSnap(d?.previousControls);
  const proposedLabel = formatControlSnap(d?.proposedControls);
  const sample = d?.screeningSample ?? null;
  const sampleLabel = sample
    ? [
        sample.zone ? `Zone ${sample.zone}` : null,
        sample.fsr != null ? `FSR ${sample.fsr}` : null,
        sample.heightM != null ? `Height ${sample.heightM} m` : null,
      ]
        .filter(Boolean)
        .join(" · ") || null
    : null;
  const keySiteIds = d?.keySiteIds ?? [];
  const candidateIds = d?.affectedCandidateIds ?? [];
  const awaiting = !!d?.awaitingVerification;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-3 sm:items-center" role="dialog" aria-modal="true">
      <div className="max-h-[min(90vh,720px)] w-full max-w-lg overflow-y-auto rounded-[3px] border border-line bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted">
              {story.typeLabel || "Planning update"}
              {d?.areaLabel ? ` · ${d.areaLabel}` : ""}
            </div>
            <h2 className="mt-0.5 text-[15px] font-semibold leading-snug text-ink">{title}</h2>
            {location && <p className="mt-0.5 text-[12.5px] text-muted">{location}</p>}
          </div>
          <button type="button" className="shrink-0 text-[12px] font-semibold text-muted hover:text-ink" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="space-y-3.5 px-4 py-3.5 text-[13px]">
          {awaiting && (
            <div className="rounded-[3px] border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-950">
              Source updated — change details awaiting verification. This is not confirmed as a zoning, FSR or height
              control change.
            </div>
          )}

          <section>
            <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted">What changed</h3>
            <p className="mt-1 leading-snug text-ink/90">
              {d?.plainSummary ||
                (awaiting
                  ? "Source updated — change details awaiting verification."
                  : story.whatChanged)}
            </p>
          </section>

          <section className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-[3px] border border-line bg-canvas px-3 py-2">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted">Previous controls</div>
              <div className="mt-1 font-medium leading-snug">
                {previousLabel ?? "Not recorded in monitored sources"}
              </div>
            </div>
            <div className="rounded-[3px] border border-amber-200 bg-amber-50/60 px-3 py-2">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-amber-950">
                Proposed controls
              </div>
              <div className="mt-1 font-medium leading-snug">
                {sample?.mixedAcrossKeySite
                  ? "Mixed across key site — not uniform"
                  : awaiting
                    ? "Source updated — change details awaiting verification"
                    : proposedLabel ?? "Not recorded in monitored sources"}
              </div>
              {!awaiting && proposedLabel && !sample?.mixedAcrossKeySite && (
                <div className="mt-0.5 text-[11px] text-muted">
                  Proposed — not current LEP law
                  {sample ? " · interior-point sample (not parcel-level)" : ""}
                </div>
              )}
            </div>
          </section>

          {sample && sampleLabel && (
            <section className="rounded-[3px] border border-line bg-canvas px-3 py-2">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted">
                Screening sample (interior point only)
              </div>
              <div className="mt-1 font-medium leading-snug">{sampleLabel}</div>
              <p className="mt-1 text-[11px] text-muted">
                {sample.mixedAcrossKeySite
                  ? `Mixed control polygons detected${sample.distinctFsrs?.length ? ` (FSR ${sample.distinctFsrs.join(", ")})` : ""}${sample.distinctZones?.length ? `; zones ${sample.distinctZones.join(", ")}` : ""}. Sample is for screening only — not parcel-level evidence and not an area-wide control.`
                  : "Verified uniform across intersecting control polygons for this key site. Sample is for screening only — not parcel-level evidence."}
              </p>
            </section>
          )}

          <section className="grid gap-2 sm:grid-cols-2">
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted">Planning status</div>
              <div className="mt-0.5 font-medium">{status ?? "Not stated in source"}</div>
            </div>
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted">
                {d?.officialDateLabel || "Official date"}
              </div>
              <div className="mt-0.5 font-medium">
                {d?.officialDate ? formatShortDate(d.officialDate) : "Not stated in source"}
              </div>
            </div>
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted">
                Detected by Site Assembly
              </div>
              <div className="mt-0.5 font-medium">{formatShortDate(d?.detectedAt || story.date)}</div>
            </div>
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted">
                Affected potential sites
              </div>
              <div className="mt-0.5 font-medium">
                {candidateIds.length
                  ? `${candidateIds.length} indexed assembl${candidateIds.length === 1 ? "y" : "ies"}`
                  : story.affectedSites != null
                    ? String(story.affectedSites)
                    : keySiteIds.length
                      ? `Key site ${keySiteIds.join(", ")}`
                      : "None linked yet"}
              </div>
            </div>
          </section>

          {(keySiteIds.length > 0 || candidateIds.length > 0) && (
            <section>
              <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted">Exact affected sites</h3>
              <ul className="mt-1 space-y-0.5 text-[12.5px] text-ink/90">
                {keySiteIds.map((id) => (
                  <li key={`ks-${id}`}>Key site {id}</li>
                ))}
                {candidateIds.slice(0, 12).map((id) => (
                  <li key={`c-${id}`} className="font-mono text-[11.5px]">
                    {id}
                  </li>
                ))}
                {candidateIds.length > 12 && (
                  <li className="text-muted">+{candidateIds.length - 12} more via Inspect affected sites</li>
                )}
              </ul>
            </section>
          )}

          <section>
            <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted">Why it matters</h3>
            <p className="mt-1 leading-snug text-ink/90">{d?.whyItMatters || story.whyItMatters}</p>
          </section>

          <section>
            <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted">Official source</h3>
            <p className="mt-1 font-medium">{d?.sourceName || story.sourceLabel || "Not stated in source"}</p>
            {d?.documentTitle && (
              <p className="mt-0.5 text-[12px] text-muted">
                {d.documentTitle}
                {d.documentSection ? ` · ${d.documentSection}` : ""}
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-3">
              {(d?.webpageUrl || story.sourceHref) && (
                <a
                  href={d?.webpageUrl || story.sourceHref || "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[12px] font-semibold text-brand hover:underline"
                >
                  Official webpage / source
                </a>
              )}
              {d?.sourceUrl && d.sourceUrl !== (d.webpageUrl || story.sourceHref) && (
                <a
                  href={d.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[12px] font-semibold text-brand hover:underline"
                >
                  Source document
                </a>
              )}
            </div>
          </section>

          <section className="flex flex-wrap gap-3 border-t border-line pt-3">
            {mapHref && (
              <Link href={mapHref} className="text-[12px] font-semibold text-brand hover:underline" onClick={onClose}>
                Show affected area on map
              </Link>
            )}
            <Link href={findHref} className="text-[12px] font-semibold text-brand hover:underline" onClick={onClose}>
              {candidateIds.length === 1 || story.affectedSites === 1
                ? "Inspect affected site"
                : "Inspect affected sites"}
            </Link>
          </section>
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
