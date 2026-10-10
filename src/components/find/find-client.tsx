"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Button, Panel, ScoreBadge, cx } from "@/components/ui";
import { fsr, money, sqm } from "@/lib/format";
import { StrategySelector } from "@/components/strategy-selector";
import type { DevelopmentStrategy } from "@/lib/source-watcher/strategy-profile";
import { fetchApiJson } from "@/lib/api-json";

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
  score: number;
  headroom: number | null;
  maxPayable: number | null;
  lotCount: number;
  owners: number;
  whyMatched: Array<{ title: string; body: string }>;
  opportunityId: string | null;
};

export function FindClient() {
  const [strategy, setStrategy] = useState<DevelopmentStrategy>("APARTMENTS");
  const [nl, setNl] = useState(
    "Show me non-strata sites over 450 sqm inside proposed FSR 2.5+ within 400m of a station",
  );
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
  const [results, setResults] = useState<FindRow[]>([]);

  const canSearch = useMemo(() => suburb.trim().length >= 2 || nl.trim().length >= 8, [suburb, nl]);

  async function runSearch() {
    setLoading(true);
    setError(null);
    try {
      const body = await fetchApiJson<{ results: FindRow[]; messages: string[] }>("/api/find", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategy,
          naturalLanguage: nl || null,
          suburb: suburb.trim() || null,
          centreQuery: suburb.trim() || null,
          minSiteAreaSqm: minSiteArea ? Number(minSiteArea) : null,
          minProposedFsr: minProposedFsr ? Number(minProposedFsr) : null,
          excludeStrata,
          insidePlanningChangeArea: insidePca ? true : null,
          keySiteOnly: keySiteOnly ? true : null,
          minHeadroom: minHeadroom ? Number(minHeadroom) : null,
          maxResults: 15,
        }),
      });
      setResults(body.results ?? []);
      setMessages(body.messages ?? []);
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
          Search available parcels and assemblies with explicit filters. Natural language is a shortcut — filters stay authoritative.
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
                placeholder="e.g. Ashfield, Edgecliff, Parramatta"
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
            <Button className="mt-3 w-full" variant="primary" disabled={!canSearch || loading} onClick={() => void runSearch()}>
              {loading ? "Searching…" : "Search sites"}
            </Button>
            <p className="mt-2 text-[11px] text-muted">
              Uses the existing parcel scanner, assembly generator and score engine.{" "}
              <Link href="/radar" className="font-semibold text-brand hover:underline">
                Precinct radar
              </Link>{" "}
              remains available.
            </p>
          </Panel>
        </aside>

        <div className="space-y-3 lg:col-span-8">
          {messages.map((m) => (
            <div key={m} className="rounded-[3px] border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-950">
              {m}
            </div>
          ))}
          {error && <div className="rounded-[3px] border border-red-200 bg-red-50 p-3 text-[13px] text-bad">{error}</div>}
          {!results.length && !loading && (
            <Empty>Enter a suburb or natural-language query, then search. Results show why each site matched.</Empty>
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
                {r.stationDistanceM != null && <span>{r.stationDistanceM}m from station</span>}
                {r.planningChangeStatus && <Badge tone="warn">{r.planningChangeStatus}</Badge>}
                {r.keySiteId && <Badge tone="brand">Key Site</Badge>}
                <span className="num">{r.headroom != null ? money(r.headroom, { compact: true }) : "—"} headroom</span>
              </div>
              <div className="mt-3">
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">Why this matched</div>
                <ul className="mt-1 space-y-0.5">
                  {r.whyMatched.length ? (
                    r.whyMatched.map((w) => (
                      <li key={w.title} className="text-[12.5px]">
                        <span className="text-good">✓</span> {w.title}
                        <span className="text-muted"> — {w.body}</span>
                      </li>
                    ))
                  ) : (
                    <li className="text-[12.5px] text-muted">Matched scan ranking criteria.</li>
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
                ) : (
                  <Link
                    href={`/map?q=${encodeURIComponent(r.locationLabel)}`}
                    className="rounded-[3px] bg-brand px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white"
                  >
                    View on map
                  </Link>
                )}
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
