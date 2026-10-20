"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Panel, cx } from "@/components/ui";
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
  const visibleChanges = showAllChanges ? stories : stories.slice(0, 3);
  const strip = data.summaryStrip;
  const selected = data.sitesToLookAt.find((s) => s.id === selectedId) ?? data.sitesToLookAt[0] ?? null;
  const topSites = data.sitesToLookAt.slice(0, 3);
  const totalSites = data.sitesToLookAt.length;

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
      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,3fr)_minmax(300px,2fr)] lg:items-start sm:p-5">
        <div className="min-w-0 space-y-5">
          <section>
            <div className="mb-2 flex items-end justify-between gap-3">
              <h2 className="font-display text-[23px] font-semibold leading-tight text-ink">Sites worth investigating</h2>
              <Link href="/find" className="shrink-0 text-[13px] font-semibold text-brand hover:underline">
                Find more
              </Link>
            </div>
            <Panel bodyClassName="p-0" className="@container/sites overflow-hidden">
              {data.indexPreparingMessage && !data.sitesToLookAt.length ? (
                <Empty>{data.indexPreparingMessage}</Empty>
              ) : !data.sitesToLookAt.length ? (
                <Empty>No sites ranked for this strategy yet.</Empty>
              ) : (
                <>
                  <div className={`${SITE_ROW_GRID} box-border border-b border-line bg-canvas/50 px-4 py-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted`}>
                    <span className="hidden @[560px]/sites:block">Site</span>
                    <span className="hidden @[560px]/sites:block">Key details</span>
                    <span className="hidden @[560px]/sites:block">Planning</span>
                    <span className="hidden text-right @[560px]/sites:block">Area</span>
                    <span className="hidden text-center @[560px]/sites:block">Score</span>
                    <span className="@[560px]/sites:hidden">Sites</span>
                  </div>
                  <ul className="w-full min-w-0">
                    {topSites.map((s) => (
                      <TodaySiteRow
                        key={s.id}
                        site={s}
                        selected={selected?.id === s.id}
                        onSelect={() => setSelectedId(s.id)}
                      />
                    ))}
                  </ul>
                  {totalSites > 3 && (
                    <div className="border-t border-line px-4 py-2.5">
                      <Link href={`/find?strategy=${strategy}`} className="text-[13px] font-semibold text-brand hover:underline">
                        View all {totalSites} sites →
                      </Link>
                    </div>
                  )}
                </>
              )}
            </Panel>
          </section>

          <section>
            <div className="mb-2 flex items-end justify-between gap-3">
              <h2 className="font-display text-[23px] font-semibold leading-tight text-ink">Planning updates</h2>
              <Link href="/feed" className="shrink-0 text-[13px] font-semibold text-brand hover:underline">
                View all
              </Link>
            </div>
            <Panel bodyClassName="p-0" className="overflow-hidden">
              {!stories.length ? (
                <Empty>No new planning or development updates in Greater Sydney in the last 7 days.</Empty>
              ) : (
                <>
                  <div className="hidden grid-cols-[72px_minmax(0,1fr)_auto_auto] gap-3 border-b border-line bg-canvas/50 px-4 py-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted sm:grid">
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
                          className="grid grid-cols-1 gap-1.5 border-b border-line px-4 py-2.5 last:border-b-0 sm:grid-cols-[72px_minmax(0,1fr)_auto_auto] sm:items-center sm:gap-3"
                        >
                          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
                            {formatShortDate(ev.date)}
                          </div>
                          <div className="min-w-0">
                            <div className="text-[14px] font-semibold leading-snug">{presented.title}</div>
                            <p className="mt-0.5 line-clamp-1 text-[13px] text-muted">{presented.explanation}</p>
                          </div>
                          <div>
                            <StatusChip tone={/proposed/i.test(presented.typeLabel) ? "proposed" : "neutral"}>
                              {presented.typeLabel}
                            </StatusChip>
                          </div>
                          <div className="flex flex-wrap justify-start gap-x-3 gap-y-1 sm:justify-end">
                            {(ev.mapHref || ev.href) && (
                              <Link
                                href={ev.mapHref || ev.href || "/map"}
                                className="text-[13px] font-semibold text-brand hover:underline"
                              >
                                Map
                              </Link>
                            )}
                            <Link
                              href={ev.findHref || `/find?strategy=${strategy}`}
                              className="text-[13px] font-semibold text-brand hover:underline"
                            >
                              {viewSitesLabel}
                            </Link>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  {stories.length > 3 && (
                    <button
                      type="button"
                      className="w-full border-t border-line px-4 py-2 text-left text-[13px] font-semibold text-muted hover:bg-canvas hover:text-ink"
                      onClick={() => setShowAllChanges((v) => !v)}
                    >
                      {showAllChanges ? "Show fewer" : `View all (${stories.length})`}
                    </button>
                  )}
                </>
              )}
            </Panel>
          </section>
        </div>

        <aside className="lg:sticky lg:top-3">
          {selected ? (
            <SelectedSitePanel site={selected} />
          ) : (
            <Panel>
              <p className="text-[14px] text-muted">Select a site to preview it on the map.</p>
            </Panel>
          )}
        </aside>
      </div>
    </div>
  );
}

/** Shared column track for header + rows — fr tracks consume full panel content width. */
const SITE_ROW_GRID =
  "grid w-full min-w-0 grid-cols-1 items-center gap-x-3 gap-y-1.5 @[560px]/sites:grid-cols-[minmax(0,1.4fr)_minmax(0,0.9fr)_minmax(0,1fr)_72px_64px]";

function TodaySiteRow({
  site,
  selected,
  onSelect,
}: {
  site: TodaySite;
  selected: boolean;
  onSelect: () => void;
}) {
  const why = site.whyItMatters?.trim() || (site.reasons[0] ? site.reasons[0] : "Worth checking on the map");
  return (
    <li className="min-w-0">
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
        className={cx(
          SITE_ROW_GRID,
          "box-border w-full min-w-0 cursor-pointer border-b border-line px-4 py-3 last:border-b-0",
          "min-h-[90px] @[560px]/sites:min-h-[96px] @[560px]/sites:max-h-[110px]",
          selected
            ? "border-l-[3px] border-l-accent bg-accent-soft/60"
            : "border-l-[3px] border-l-transparent hover:bg-brand-soft/35",
        )}
      >
        <div className="min-w-0">
          <div className="line-clamp-2 text-[14px] font-semibold leading-snug text-ink">{site.address || site.name}</div>
          <div className="mt-0.5 line-clamp-1 text-[13px] text-muted @[560px]/sites:line-clamp-2">{why}</div>
        </div>
        <div className="min-w-0 text-[13px] leading-snug text-muted">
          {[
            site.suburb ?? site.lga ?? "Sydney",
            site.lotCount != null ? `${site.lotCount} lot${site.lotCount === 1 ? "" : "s"}` : null,
            site.owners != null ? `${site.owners} owner${site.owners === 1 ? "" : "s"}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
        <div className="flex min-w-0 flex-wrap gap-1">
          {site.zone && <StatusChip tone="zone">{site.zone}</StatusChip>}
          {site.currentFsr != null && <StatusChip tone="fsr">FSR {fsr(site.currentFsr)}</StatusChip>}
          {site.proposedFsr != null && (site.currentFsr == null || site.proposedFsr > site.currentFsr) && (
            <StatusChip tone="proposed">Proposed {fsr(site.proposedFsr)}</StatusChip>
          )}
        </div>
        <div className="num text-[14px] font-semibold text-ink @[560px]/sites:text-right">
          {site.siteAreaSqm != null ? sqm(site.siteAreaSqm) : "—"}
        </div>
        <div className="flex @[560px]/sites:justify-center">
          <ScoreRing score={site.score} caption={site.scoreProvenance === "DETAILED" ? "Detailed" : "Screening"} />
        </div>
      </div>
    </li>
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

        <div className="flex flex-col gap-2 pt-1 sm:flex-row">
          <Link
            href={analyse}
            className="inline-flex h-10 flex-1 items-center justify-center rounded-[7px] bg-brand px-3 text-[13px] font-semibold text-white hover:bg-[#0e2325]"
          >
            Open analysis →
          </Link>
          <Link
            href={map}
            className="inline-flex h-10 flex-1 items-center justify-center rounded-[7px] border border-line bg-panel px-3 text-[13px] font-semibold text-ink hover:bg-canvas"
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
