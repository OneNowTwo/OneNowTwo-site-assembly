"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Button, Panel, ScoreBadge, cx } from "@/components/ui";
import { fsr, money, sqm } from "@/lib/format";
import { StrategySelector } from "@/components/strategy-selector";
import type { DevelopmentStrategy } from "@/lib/source-watcher/strategy-profile";
import { fetchApiJson } from "@/lib/api-json";
import { buildMapHref } from "@/lib/map/map-target";

type FindRow = {
  key: string;
  locationLabel: string;
  suburb: string | null;
  siteAreaSqm: number;
  zone: string | null;
  currentFsr: number | null;
  proposedFsr: number | null;
  proposedHeight: number | null;
  planningChangeStatus: string | null;
  keySiteId: string | null;
  stationDistanceM: number | null;
  nearestStationLabel: string | null;
  score: number;
  headroom: number | null;
  maxPayable: number | null;
  lotCount: number;
  owners: number;
  whyMatched: Array<{ title: string; body: string }>;
  opportunityId: string | null;
  lotIds?: string[];
  bboxHint?: { west: number; south: number; east: number; north: number } | null;
};

type AppliedFilter = { label: string; value: string };

type FindApiBody = {
  results: FindRow[];
  messages: string[];
  diagnostics?: string[];
  source?: "index" | "live";
  assessedCount?: number;
  matchedCount?: number;
  elapsedMs?: number;
  appliedFilters?: AppliedFilter[];
};

const NL_PLACEHOLDER =
  "Show me non-strata sites over 450 sqm inside proposed FSR 2.5+ within 400m of a station";

export function FindClient() {
  const [strategy, setStrategy] = useState<DevelopmentStrategy>("APARTMENTS");
  const [nl, setNl] = useState("");
  const [suburb, setSuburb] = useState("");
  const [minSiteArea, setMinSiteArea] = useState("450");
  const [minProposedFsr, setMinProposedFsr] = useState("");
  const [excludeStrata, setExcludeStrata] = useState(true);
  const [insidePca, setInsidePca] = useState(false);
  const [keySiteOnly, setKeySiteOnly] = useState(false);
  const [minHeadroom, setMinHeadroom] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<string[]>([]);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [results, setResults] = useState<FindRow[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [source, setSource] = useState<"index" | "live" | null>(null);
  const [assessedCount, setAssessedCount] = useState(0);
  const [appliedFilters, setAppliedFilters] = useState<AppliedFilter[]>([]);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const canSearch = useMemo(() => suburb.trim().length >= 2 || nl.trim().length >= 8, [suburb, nl]);

  async function runSearch(mode: "index" | "live") {
    setLoading(true);
    setError(null);
    setHasSearched(true);
    try {
      const body = await fetchApiJson<FindApiBody>("/api/find", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategy,
          naturalLanguage: nl.trim() || null,
          suburb: suburb.trim() || null,
          centreQuery: suburb.trim() || null,
          minSiteAreaSqm: minSiteArea ? Number(minSiteArea) : null,
          minProposedFsr: minProposedFsr ? Number(minProposedFsr) : null,
          excludeStrata,
          insidePlanningChangeArea: insidePca ? true : null,
          keySiteOnly: keySiteOnly ? true : null,
          minHeadroom: minHeadroom ? Number(minHeadroom) : null,
          maxResults: 15,
          mode,
        }),
      });
      setResults(body.results ?? []);
      setMessages(body.messages ?? []);
      setDiagnostics(body.diagnostics ?? []);
      setSource(body.source ?? mode);
      setAssessedCount(body.assessedCount ?? 0);
      setAppliedFilters(body.appliedFilters ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="border-b border-line bg-gradient-to-r from-[#f3f6f8] via-white to-[#eef5f2] px-6 py-6">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">Find</div>
        <h1 className="mt-1 text-[24px] font-semibold tracking-tight">Find development sites</h1>
        <p className="mt-1 max-w-2xl text-[13px] text-muted">
          Search indexed Sydney candidates first. Filters stay authoritative — strategy affects ranking, not hidden cut-offs.
        </p>
        <div className="mt-4">
          <StrategySelector value={strategy} onChange={setStrategy} />
        </div>
        <label className="mt-4 block">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">Optional natural language</span>
          <textarea
            className="mt-1 w-full rounded-[3px] border border-line bg-white px-3 py-2 text-[13px]"
            rows={2}
            value={nl}
            placeholder={NL_PLACEHOLDER}
            onChange={(e) => setNl(e.target.value)}
          />
        </label>
      </div>

      <div className="grid gap-4 p-6 lg:grid-cols-12">
        <aside className="space-y-3 lg:col-span-4">
          <Panel title="Filters">
            <Field label="Suburb / centre">
              <input
                className="w-full rounded-[3px] border border-line px-2 py-1.5 text-[13px]"
                placeholder="Any Greater Sydney suburb or LGA"
                value={suburb}
                onChange={(e) => setSuburb(e.target.value)}
              />
            </Field>
            <Field label="Minimum site area (sqm)">
              <input
                className="w-full rounded-[3px] border border-line px-2 py-1.5 text-[13px] num"
                value={minSiteArea}
                onChange={(e) => setMinSiteArea(e.target.value)}
              />
            </Field>
            <Field label="Minimum proposed FSR">
              <input
                className="w-full rounded-[3px] border border-line px-2 py-1.5 text-[13px] num"
                value={minProposedFsr}
                onChange={(e) => setMinProposedFsr(e.target.value)}
                placeholder="optional"
              />
            </Field>
            <Field label="Minimum headroom ($)">
              <input
                className="w-full rounded-[3px] border border-line px-2 py-1.5 text-[13px] num"
                value={minHeadroom}
                onChange={(e) => setMinHeadroom(e.target.value)}
                placeholder="optional"
              />
            </Field>
            <label className="flex items-center gap-2 text-[12.5px]">
              <input type="checkbox" checked={excludeStrata} onChange={(e) => setExcludeStrata(e.target.checked)} />
              Exclude strata
            </label>
            <label className="flex items-center gap-2 text-[12.5px]">
              <input type="checkbox" checked={insidePca} onChange={(e) => setInsidePca(e.target.checked)} />
              Inside PlanningChangeArea
            </label>
            <label className="flex items-center gap-2 text-[12.5px]">
              <input type="checkbox" checked={keySiteOnly} onChange={(e) => setKeySiteOnly(e.target.checked)} />
              Key Site only
            </label>
            <Button className="mt-3 w-full" variant="primary" disabled={!canSearch || loading} onClick={() => void runSearch("index")}>
              {loading && source !== "live" ? "Searching…" : "Search sites"}
            </Button>
            <Button
              className="mt-2 w-full"
              variant="secondary"
              disabled={!canSearch || loading}
              onClick={() => void runSearch("live")}
            >
              {loading && source === "live" ? "Deep scanning…" : "Run live deep scan"}
            </Button>
            <p className="mt-2 text-[11px] text-muted">
              Search uses the Sydney candidate index when available. Live deep scan runs the full parcel/assembly engine on demand.{" "}
              <Link href="/radar" className="font-semibold text-brand hover:underline">
                Precinct radar
              </Link>{" "}
              remains available.
            </p>
          </Panel>
        </aside>

        <div className="space-y-3 lg:col-span-8">
          {messages.map((m) => (
            <div key={m} className="rounded-[3px] border border-line bg-white px-3 py-2 text-[13px] text-ink">
              {m}
              {source ? (
                <span className="ml-2 text-[11px] uppercase tracking-wide text-muted">
                  · {source === "index" ? "indexed" : "live scan"}
                </span>
              ) : null}
            </div>
          ))}

          {hasSearched && !results.length && !loading && assessedCount > 0 && (
            <div className="rounded-[3px] border border-line bg-canvas/40 px-3 py-3 text-[12.5px]">
              <div className="font-semibold">No sites matched your current filters.</div>
              <p className="mt-1 text-muted">
                {assessedCount} candidate{assessedCount === 1 ? "" : "s"} assessed; 0 matched.
              </p>
              {appliedFilters.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {appliedFilters.map((f) => (
                    <li key={f.label} className="rounded-[3px] border border-line bg-white px-2 py-0.5 text-[11px]">
                      <span className="text-muted">{f.label}:</span> {f.value}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {diagnostics.length > 0 && (
            <details
              className="rounded-[3px] border border-line bg-canvas/30 px-3 py-2 text-[12px]"
              open={showDiagnostics}
              onToggle={(e) => setShowDiagnostics((e.target as HTMLDetailsElement).open)}
            >
              <summary className="cursor-pointer font-semibold text-muted">Diagnostics / Search details</summary>
              <ul className="mt-2 space-y-1 text-[11.5px] text-muted">
                {diagnostics.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </details>
          )}

          {error && <div className="rounded-[3px] border border-red-200 bg-red-50 p-3 text-[13px] text-bad">{error}</div>}

          {!hasSearched && !loading && (
            <Empty>Enter a suburb, then search. Indexed results return quickly; live deep scan is optional.</Empty>
          )}
          {hasSearched && !results.length && !loading && assessedCount === 0 && !messages.length && (
            <Empty>No sites matched your current filters.</Empty>
          )}

          {results.map((r) => (
            <article key={r.key} className="border border-line bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-[15px] font-semibold">{r.locationLabel}</h2>
                  <p className="mt-0.5 text-[12px] text-muted">
                    {sqm(r.siteAreaSqm)}
                    {r.zone ? ` · ${r.zone}` : ""} · {r.lotCount} lot{r.lotCount === 1 ? "" : "s"} · {r.owners} owner
                    {r.owners === 1 ? "" : "s"}
                  </p>
                </div>
                <ScoreBadge score={r.score} />
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-[12.5px]">
                <span>Current FSR {r.currentFsr != null ? fsr(r.currentFsr) : "—"}</span>
                <span className={cx(r.proposedFsr != null ? "font-semibold text-brand" : "text-muted")}>
                  Proposed FSR {r.proposedFsr != null ? fsr(r.proposedFsr) : "—"}
                </span>
                {r.stationDistanceM != null && (
                  <span>
                    {Math.round(r.stationDistanceM)}m from {r.nearestStationLabel ?? "station"}
                  </span>
                )}
                {r.planningChangeStatus && <Badge tone="warn">{r.planningChangeStatus}</Badge>}
                {r.keySiteId && <Badge tone="brand">Key Site</Badge>}
                <span className="num">{r.headroom != null ? money(r.headroom, { compact: true }) : "—"} headroom</span>
              </div>
              <div className="mt-3">
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">Why this matched</div>
                <ul className="mt-1 space-y-0.5">
                  {r.whyMatched.length ? (
                    r.whyMatched.map((w) => (
                      <li key={`${r.key}-${w.title}`} className="text-[12.5px]">
                        <span className="text-good">✓</span> {w.title}
                        <span className="text-muted"> — {w.body}</span>
                      </li>
                    ))
                  ) : (
                    <li className="text-[12.5px] text-muted">Matched explicit filters.</li>
                  )}
                </ul>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {r.opportunityId ? (
                  <Link
                    href={`/opportunities/${r.opportunityId}`}
                    className="rounded-[3px] bg-brand px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white"
                  >
                    View site
                  </Link>
                ) : null}
                <Link
                  href={buildMapHref({
                    opportunityId: r.opportunityId,
                    keySiteId: r.keySiteId,
                    parcelId: r.lotIds?.[0] ?? null,
                    bbox: r.bboxHint ?? null,
                    scan: r.suburb || r.locationLabel,
                    zoom: 17,
                  })}
                  className="rounded-[3px] bg-brand px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white"
                >
                  View on map
                </Link>
                <Link
                  href="/watching"
                  className="rounded-[3px] border border-line px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide hover:bg-canvas"
                >
                  Watch
                </Link>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="border border-dashed border-line bg-canvas/50 px-4 py-8 text-center text-[13px] text-muted">{children}</div>;
}
