"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Panel, cx } from "@/components/ui";
import { ListRow } from "@/components/shell/list-row";
import { ScoreRing, StatusChip } from "@/components/shell/status-chip";
import { SelectedSiteMapPreview } from "@/components/monitoring/selected-site-map-preview";
import { money, sqm, fsr } from "@/lib/format";
import { fetchApiJson } from "@/lib/api-json";
import {
  STRATEGY_LABELS,
  type DevelopmentStrategy,
} from "@/lib/source-watcher/strategy-profile";
import { presentTodayStory, todayPageSubheading } from "@/lib/intelligence/today-agent-copy";

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

const STRATEGIES: DevelopmentStrategy[] = ["APARTMENTS", "CO_LIVING", "TOWNHOUSES", "GENERAL_RESIDENTIAL"];

function formatShortDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" }).toUpperCase();
}

function formatTodayEyebrow() {
  return new Date().toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).toUpperCase();
}

function primaryHref(s: TodaySite): string {
  if (s.analyseHref) return s.analyseHref;
  return s.href || "/map";
}

function mapHrefFor(s: TodaySite): string {
  return s.href || "/map";
}

export function DashboardClient() {
  const router = useRouter();
  const [data, setData] = useState<TodayPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<DevelopmentStrategy>("APARTMENTS");
  const [showAllChanges, setShowAllChanges] = useState(false);
  const [expandedFamily, setExpandedFamily] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQ, setSearchQ] = useState("");

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

  function onSearch(e: FormEvent) {
    e.preventDefault();
    const q = searchQ.trim();
    if (!q) return;
    router.push(`/map?scan=${encodeURIComponent(q)}`);
  }

  if (error) {
    return <div className="p-5 text-[14px] text-bad">{error}</div>;
  }
  if (!data) {
    return <div className="p-5 text-[14px] text-muted">Loading…</div>;
  }

  const stories = data.topIntelligence?.length ? data.topIntelligence : data.whatChanged;
  const visibleChanges = showAllChanges ? stories : stories.slice(0, 5);
  const strip = data.summaryStrip;
  const selected = data.sitesToLookAt.find((s) => s.id === selectedId) ?? data.sitesToLookAt[0] ?? null;

  return (
    <div className="h-full overflow-y-auto bg-canvas">
      {/* Compact utility bar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-panel px-4 py-2.5 sm:px-5">
        <form onSubmit={onSearch} className="flex min-w-0 flex-1 items-center gap-2">
          <input
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Search an address, suburb or planning area"
            aria-label="Search address or suburb"
            className="h-9 min-w-0 flex-1 rounded-[7px] border border-line bg-canvas/40 px-3 text-[13.5px] outline-none focus:border-brand"
          />
        </form>
        <label className="flex shrink-0 items-center gap-2 text-[12px] text-muted">
          <span className="sr-only">Strategy</span>
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as DevelopmentStrategy)}
            className="h-9 rounded-[7px] border border-line bg-panel px-2.5 text-[13px] font-medium text-ink outline-none focus:border-brand"
            aria-label="Strategy"
          >
            {STRATEGIES.map((s) => (
              <option key={s} value={s}>
                {STRATEGY_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="px-4 pt-5 sm:px-5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{formatTodayEyebrow()}</div>
        <h1 className="font-display mt-1 text-[28px] font-semibold leading-tight tracking-tight text-ink">
          {data.headline || "Your development brief"}
        </h1>
        <p className="mt-1 max-w-2xl text-[14px] leading-snug text-muted">
          {data.subheading?.trim() || todayPageSubheading()}
        </p>

        {/* Slim metrics strip — rules, not cards */}
        {strip && (
          <div className="mt-4 flex flex-wrap items-stretch border-y border-line py-3">
            <MetricCell
              value={strip.planningChanges}
              label="planning updates"
              hint="New or updated recently"
            />
            <MetricCell
              value={strip.worthChecking}
              label="sites to investigate"
              hint="Match your criteria"
              divider
            />
            <MetricCell
              value={strip.watched}
              label="watched sites"
              hint="Changes or opportunities"
              divider
            />
          </div>
        )}
      </div>

      {/* 60 / 40 list + detail */}
      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,3fr)_minmax(280px,2fr)] lg:items-start sm:p-5">
        <div className="min-w-0 space-y-4">
          <Panel
            title="Sites worth investigating"
            actions={
              <Link href="/find" className="text-[12px] font-semibold text-brand hover:underline">
                Find more
              </Link>
            }
            bodyClassName="p-0"
            className="overflow-hidden"
          >
            {data.indexPreparingMessage && !data.sitesToLookAt.length ? (
              <Empty>{data.indexPreparingMessage}</Empty>
            ) : !data.sitesToLookAt.length ? (
              <Empty>No sites ranked for this strategy yet.</Empty>
            ) : (
              <>
                <div className="hidden grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.1fr)_72px_64px] gap-3 border-b border-line bg-canvas/50 px-4 py-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted xl:grid">
                  <span>Site</span>
                  <span>Key details</span>
                  <span>Planning</span>
                  <span className="text-right">Area</span>
                  <span className="text-center">Score</span>
                </div>
                <ul>
                  {data.sitesToLookAt.map((s) => {
                    const alts = s.familyAlternativeCount ?? 0;
                    const why =
                      s.whyItMatters?.trim() || (s.reasons[0] ? s.reasons[0] : "Worth checking on the map");
                    const isSelected = selected?.id === s.id;
                    return (
                      <li key={s.id}>
                        <ListRow
                          selected={isSelected}
                          onSelect={() => setSelectedId(s.id)}
                          className={cx(
                            "!grid-cols-1 xl:!grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.1fr)_72px_64px] xl:items-center",
                            isSelected && "border-l-[3px] border-l-accent",
                          )}
                        >
                          <div className="grid gap-2 xl:col-span-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.1fr)_72px_64px] xl:items-center xl:gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-[14px] font-semibold leading-snug text-ink">
                                {s.address || s.name}
                              </div>
                              <div className="mt-0.5 line-clamp-2 text-[12.5px] text-muted">{why}</div>
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
                                  Other lot combinations exist nearby — open the map to compare.
                                </p>
                              )}
                            </div>
                            <div className="text-[12.5px] text-muted">
                              {[
                                s.suburb ?? s.lga ?? "Sydney",
                                s.lotCount != null ? `${s.lotCount} lot${s.lotCount === 1 ? "" : "s"}` : null,
                                s.owners != null ? `${s.owners} owner${s.owners === 1 ? "" : "s"}` : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {s.zone && <StatusChip tone="zone">{s.zone}</StatusChip>}
                              {s.currentFsr != null && <StatusChip tone="fsr">FSR {fsr(s.currentFsr)}</StatusChip>}
                              {s.proposedFsr != null &&
                                (s.currentFsr == null || s.proposedFsr > s.currentFsr) && (
                                  <StatusChip tone="proposed">Proposed {fsr(s.proposedFsr)}</StatusChip>
                                )}
                            </div>
                            <div className="num text-right text-[13px] font-semibold text-ink">
                              {s.siteAreaSqm != null ? sqm(s.siteAreaSqm) : "—"}
                            </div>
                            <div className="flex justify-center">
                              <ScoreRing
                                score={s.score}
                                caption={s.scoreProvenance === "DETAILED" ? "Detailed" : "Screening"}
                              />
                            </div>
                          </div>
                        </ListRow>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </Panel>

          <Panel
            title="Planning updates"
            actions={
              <Link href="/feed" className="text-[12px] font-semibold text-brand hover:underline">
                View all
              </Link>
            }
            bodyClassName="p-0"
            className="overflow-hidden"
          >
            {!stories.length ? (
              <Empty>No new planning or development updates in Greater Sydney in the last 7 days.</Empty>
            ) : (
              <>
                <div className="hidden grid-cols-[88px_minmax(0,1fr)_100px_auto] gap-3 border-b border-line bg-canvas/50 px-4 py-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted sm:grid">
                  <span>Date</span>
                  <span>Update</span>
                  <span>Impact</span>
                  <span className="text-right">Actions</span>
                </div>
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
                    const viewSitesLabel = ev.affectedSites === 1 ? "View site" : "View sites";
                    return (
                      <li
                        key={ev.id}
                        className="grid gap-2 border-b border-line px-4 py-3 last:border-b-0 sm:grid-cols-[88px_minmax(0,1fr)_100px_auto] sm:items-center"
                      >
                        <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
                          {formatShortDate(ev.date)}
                        </div>
                        <div className="min-w-0">
                          <div className="text-[13.5px] font-semibold leading-snug">{presented.title}</div>
                          <p className="mt-0.5 line-clamp-2 text-[12.5px] text-muted">{presented.explanation}</p>
                        </div>
                        <div>
                          <StatusChip tone={/proposed/i.test(presented.typeLabel) ? "proposed" : "neutral"}>
                            {presented.typeLabel}
                          </StatusChip>
                        </div>
                        <div className="flex flex-wrap justify-end gap-x-3 gap-y-1">
                          {(ev.mapHref || ev.href) && (
                            <Link
                              href={ev.mapHref || ev.href || "/map"}
                              className="text-[12px] font-semibold text-brand hover:underline"
                            >
                              Map
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
                    {showAllChanges ? "Show fewer" : `View all (${stories.length})`}
                  </button>
                )}
              </>
            )}
          </Panel>
        </div>

        <aside className="lg:sticky lg:top-4">
          {selected ? <SelectedSitePanel site={selected} /> : (
            <Panel>
              <p className="text-[13px] text-muted">Select a site to preview it on the map.</p>
            </Panel>
          )}
        </aside>
      </div>
    </div>
  );
}

function MetricCell({
  value,
  label,
  hint,
  divider,
}: {
  value: number;
  label: string;
  hint: string;
  divider?: boolean;
}) {
  return (
    <div
      className={cx(
        "min-w-[160px] flex-1 px-1 py-0.5 sm:px-4",
        divider && "sm:border-l sm:border-line",
      )}
    >
      <div className="flex items-baseline gap-2">
        <span className="num font-display text-[26px] font-semibold leading-none text-ink">{value}</span>
        <span className="text-[13px] font-semibold text-ink">{label}</span>
      </div>
      <div className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.06em] text-muted">{hint}</div>
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
      <div className="h-[220px] border-b border-line bg-[#e8e4da] sm:h-[240px]">
        <SelectedSiteMapPreview candidateId={site.id} />
      </div>
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display truncate text-[20px] font-semibold text-ink">
              {site.address || site.name}
            </h2>
            <div className="mt-0.5 text-[13px] text-muted">
              {[
                site.lotCount != null ? `${site.lotCount} propert${site.lotCount === 1 ? "y" : "ies"}` : null,
                site.siteAreaSqm != null ? sqm(site.siteAreaSqm) : null,
                site.suburb,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          <ScoreRing
            score={site.score}
            caption={detailed ? "Detailed" : "Screening"}
          />
        </div>

        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Current planning</div>
          <dl className="mt-1.5 space-y-0">
            <div className="flex justify-between gap-3 border-b border-line py-1.5 text-[13px]">
              <dt className="text-muted">Zone</dt>
              <dd className="font-semibold">{site.zone ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-3 border-b border-line py-1.5 text-[13px]">
              <dt className="text-muted">FSR</dt>
              <dd className="num font-semibold">{site.currentFsr != null ? fsr(site.currentFsr) : "—"}</dd>
            </div>
          </dl>
        </div>

        {hasProposed && (
          <div className="rounded-[7px] border border-accent/35 bg-accent-soft/80 px-3 py-2 text-[12.5px] text-warn">
            Proposed planning — review separately from current controls
            {site.proposedFsr != null ? ` (FSR ${fsr(site.proposedFsr)})` : ""}.
          </div>
        )}

        {detailed && (site.existingValue != null || site.maxPayable != null || site.headroom != null) && (
          <div className="space-y-1 border-t border-line pt-2 text-[12.5px]">
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
          Official planning sources ·{" "}
          <Link href="/feed" className="font-semibold text-brand hover:underline">
            View feed
          </Link>
        </p>
      </div>
    </Panel>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-6 text-[13px] text-muted">{children}</div>;
}
