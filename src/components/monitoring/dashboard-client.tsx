"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SelectedSiteMapPreview } from "@/components/monitoring/selected-site-map-preview";
import { money, sqm, fsr } from "@/lib/format";
import { fetchApiJson } from "@/lib/api-json";
import { STRATEGY_LABELS, type DevelopmentStrategy } from "@/lib/source-watcher/strategy-profile";
import { presentTodayStory } from "@/lib/intelligence/today-agent-copy";
import styles from "./development-brief.module.css";

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

function Arrow() { return <span aria-hidden="true">↗</span>; }
function SearchIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>; }
function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleDateString("en-AU", {day:"numeric", month:"short", timeZone:"Australia/Sydney"});
}
function siteHref(site: TodaySite) { return site.analyseHref || site.href || "/map"; }

export function DashboardClient() {
  const router = useRouter();
  const [data, setData] = useState<TodayPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [strategy, setStrategy] = useState<DevelopmentStrategy>("APARTMENTS");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showUpdates, setShowUpdates] = useState(false);
  const [openStory, setOpenStory] = useState<Story | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchApiJson<TodayPayload>(`/api/dashboard?strategy=${strategy}`).then(body => {
      if (cancelled) return;
      setData(body);
      setSelectedId(previous => body.sitesToLookAt.some(site => site.id === previous) ? previous : body.sitesToLookAt[0]?.id ?? null);
    }).catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load your brief."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [strategy]);

  function onSearch(event: FormEvent) {
    event.preventDefault();
    if (search.trim()) router.push(`/map?scan=${encodeURIComponent(search.trim())}`);
  }
  const selected = data?.sitesToLookAt.find(site => site.id === selectedId) ?? data?.sitesToLookAt[0];
  const stories = data?.topIntelligence?.length ? data.topIntelligence : data?.whatChanged ?? [];
  const summary = data?.summaryStrip;
  const findHref = `/find?strategy=${strategy}`;

  return <div className={styles.page}>
    <header className={styles.utility}>
      <div className={styles.breadcrumb}>Workspace <span>/</span> <strong>Today</strong></div>
      <form onSubmit={onSearch} className={styles.search}>
        <SearchIcon/><input aria-label="Search address or suburb" placeholder="Search an address or suburb" value={search} onChange={event => setSearch(event.target.value)}/>
        <kbd>↵</kbd>
      </form>
      <Link href="/watching" className={styles.utilityLink}>Watched sites <Arrow/></Link>
    </header>
    <main className={styles.canvas} aria-busy={loading}>
      <div className={styles.heading}>
        <div><div className={styles.eyebrow}>{new Date().toLocaleDateString("en-AU",{weekday:"long",day:"numeric",month:"long",timeZone:"Australia/Sydney"})} <span> / </span> {data?.marketScope?.label ?? "Sydney metro"}</div>
          <h1>Your development brief<span>.</span></h1>
          <p>Sites to investigate. Planning changes to understand.</p>
        </div>
        <label className={styles.strategy}><span>Development focus</span><select value={strategy} onChange={event => { setLoading(true); setError(null); setStrategy(event.target.value as DevelopmentStrategy); }} aria-label="Development strategy">{STRATEGIES.map(item => <option value={item} key={item}>{STRATEGY_LABELS[item]}</option>)}</select></label>
      </div>
      {error ? <div role="alert" className={styles.empty}>{error}</div> : null}
      {!data ? <div className={styles.empty} role="status">{loading ? "Preparing your development brief…" : "Your brief could not be loaded."}</div> : <>
        <div className={styles.metrics}>
          <Link href={findHref}><span className={styles.metricNumber}>{summary?.worthChecking ?? data.sitesToLookAt.length}</span><div><strong>Sites to investigate</strong><span>Matching your development focus</span></div><Arrow/></Link>
          <a href="#planning-updates"><span className={styles.metricNumber}>{summary?.planningChanges ?? stories.length}</span><div><strong>Planning updates</strong><span>Changes worth a closer look</span></div><Arrow/></a>
          <Link href="/watching"><span className={styles.metricNumber}>{summary?.watched ?? "—"}</span><div><strong>Watched sites</strong><span>Your saved areas and opportunities</span></div><Arrow/></Link>
        </div>
        <div className={styles.workspace}>
          <div className={styles.leftColumn}>
            <section className={styles.card} aria-labelledby="sites-title">
              <div className={styles.sectionHeader}><div><span className={styles.kicker}>Your shortlist</span><h2 id="sites-title">Sites worth investigating</h2></div><Link href={findHref}>View all <Arrow/></Link></div>
              {data.sitesToLookAt.length ? <>
                <div className={styles.listHeader}><span>Site & location</span><span>Current controls</span><span>Screening</span></div>
                <ul className={styles.siteList}>{data.sitesToLookAt.slice(0,3).map((site, index) => <li key={site.id}>
                  <button type="button" className={`${styles.siteRow} ${selected?.id === site.id ? styles.selected : ""}`} onClick={() => setSelectedId(site.id)} aria-pressed={selected?.id === site.id}>
                    <span className={styles.siteIdentity}><span className={styles.rank}>{String(index+1).padStart(2,"0")}</span><span><strong>{site.address || site.name}</strong><span className={styles.siteMeta}>{[site.lotCount != null ? `${site.lotCount} lots` : null,site.siteAreaSqm != null ? sqm(site.siteAreaSqm) : null].filter(Boolean).join(" · ")}</span><span className={styles.siteLocation}>{site.suburb ?? site.lga ?? "Sydney"}{site.stationDistanceM != null ? ` · ~${Math.round(site.stationDistanceM)} m to station` : ""}</span></span></span>
                    <span className={styles.controls}><span>{site.zone ?? "Zone unavailable"}</span><span>{site.currentFsr != null ? `${fsr(site.currentFsr)} FSR` : "FSR not available"}</span></span>
                    <span className={styles.score}><strong>{site.score ?? "—"}</strong><span>{site.scoreProvenance === "DETAILED" ? "Detailed" : "Screening"}</span></span>
                  </button>
                </li>)}</ul>
                <Link className={styles.cardFooter} href={findHref}>Explore all {data.sitesToLookAt.length} sites <span aria-hidden="true">→</span></Link>
              </> : <div className={styles.empty}>{data.indexPreparingMessage || "No sites match this development focus yet."}</div>}
            </section>
            <section className={styles.card} id="planning-updates" aria-labelledby="updates-title">
              <div className={styles.sectionHeader}><div><span className={styles.kicker}>Planning intelligence</span><h2 id="updates-title">What’s changed</h2></div><Link href="/feed">All updates <Arrow/></Link></div>
              {stories.length ? <ul className={styles.updates}>{(showUpdates ? stories : stories.slice(0,3)).map(story => {
                const presentation = presentTodayStory(story,strategy);
                return <li key={story.id}><div className={styles.date}>{dateLabel(story.date)}</div><div className={styles.updateContent}><button type="button" onClick={() => setOpenStory(story)}>{story.title || presentation.title} <Arrow/></button><p>{story.whatChanged || presentation.explanation}</p><div className={styles.updateLinks}><span className={styles.tag}>{story.typeLabel || presentation.typeLabel}</span>{story.affectedSites != null ? <span>{story.affectedSites} potential site{story.affectedSites === 1 ? "" : "s"}</span> : null}{story.findHref ? <Link href={story.findHref}>View sites →</Link> : null}</div></div></li>;
              })}</ul> : <div className={styles.empty}>No new planning updates in your brief.</div>}
              {stories.length > 3 ? <button type="button" className={styles.cardFooter} onClick={() => setShowUpdates(!showUpdates)}>{showUpdates ? "Show fewer updates" : `Show all ${stories.length} updates`} <span aria-hidden="true">↓</span></button> : null}
            </section>
          </div>
          {selected ? <aside className={`${styles.card} ${styles.inspector}`} aria-label="Selected site">
            <div className={styles.map}><SelectedSiteMapPreview candidateId={selected.id}/><span className={styles.mapLabel}>Selected assembly</span></div>
            <div className={styles.inspectorBody}>
              <div className={styles.kicker}>Site overview <span className={styles.dot}/>{selected.scoreProvenance === "DETAILED" ? "Detailed analysis" : "Screening assessment"}</div>
              <h2>{selected.address || selected.name}</h2>
              <p className={styles.inspectorMeta}>{[selected.lotCount != null ? `${selected.lotCount} properties` : null,selected.siteAreaSqm != null ? sqm(selected.siteAreaSqm) : null, selected.suburb].filter(Boolean).join(" · ")}</p>
              <div className={styles.controlHeading}>Current planning <span>LEP controls</span></div>
              <dl className={styles.controlTable}><div><dt>Zone</dt><dd>{selected.zone ?? "Not available"}</dd></div><div><dt>Floor space ratio</dt><dd>{selected.currentFsr != null ? fsr(selected.currentFsr) : "Not available"}</dd></div></dl>
              {selected.proposedFsr != null ? <div className={styles.proposed}><span>Proposed planning</span><strong>FSR {fsr(selected.proposedFsr)}</strong><p>Proposed controls are separate from current planning.</p></div> : null}
              {selected.whyItMatters || selected.reasons[0] ? <div className={styles.why}><h3>Why look here</h3><p>{selected.whyItMatters || selected.reasons[0]}</p></div> : null}
              {selected.scoreProvenance === "DETAILED" ? <div className={styles.financials}>{selected.existingValue != null ? <div><span>Existing value</span><strong>{money(selected.existingValue,{compact:true})}</strong></div> : null}{selected.maxPayable != null ? <div><span>Max payable</span><strong>{selected.maxPayable > 0 ? money(selected.maxPayable,{compact:true}) : "No supported land value"}</strong></div> : null}</div> : null}
              <div className={styles.actions}><Link className={styles.primaryAction} href={siteHref(selected)}>Open analysis <span>→</span></Link><Link className={styles.secondaryAction} href={selected.href || "/map"}>Open map <Arrow/></Link></div>
            </div>
          </aside> : null}
        </div>
        <footer className={styles.pageFooter}><span>Site Assembly <span> / </span> Development intelligence</span><Link href="/feed">Review sources & updates <Arrow/></Link></footer>
      </>}
    </main>
    {openStory ? <UpdateDialog story={openStory} strategy={strategy} onClose={() => setOpenStory(null)}/> : null}
  </div>;
}

function UpdateDialog({story,strategy,onClose}:{story:Story;strategy:string;onClose:()=>void}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element=dialog.current;
    element?.showModal();
    closeButton.current?.focus();
    return () => element?.close();
  },[]);
  const presentation=presentTodayStory(story,strategy);
  return <dialog ref={dialog} className={styles.dialog} onCancel={onClose} onClick={event => {if(event.target===event.currentTarget) onClose();}} aria-labelledby="update-title">
    <button ref={closeButton} className={styles.dialogClose} onClick={onClose} aria-label="Close update">×</button>
    <span className={styles.kicker}>{story.typeLabel || presentation.typeLabel} · {dateLabel(story.date)}</span>
    <h2 id="update-title">{story.title || presentation.title}</h2>
    <p>{story.whatChanged || presentation.explanation}</p>
    {story.whyItMatters && story.whyItMatters !== story.whatChanged ? <p>{story.whyItMatters}</p> : null}
    {story.sourceHref ? <a href={story.sourceHref} target="_blank" rel="noopener noreferrer" className={styles.sourceLink}>{story.sourceLabel || "Official source"} <Arrow/></a> : <p className={styles.sourceNote}>Source details are not available in this brief.</p>}
    <div className={styles.actions}>{story.mapHref || story.href ? <Link href={story.mapHref || story.href || "/map"} className={styles.primaryAction}>Show on map →</Link> : null}{story.findHref ? <Link className={styles.secondaryAction} href={story.findHref}>Affected sites <Arrow/></Link> : null}</div>
  </dialog>;
}
