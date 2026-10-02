"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { BBox, ParcelData } from "@/lib/types";
import type { GeocodeResult } from "@/lib/data-sources/providers";
import type { AssemblyCandidate } from "@/lib/analysis/assembly";
import { computeAssemblyMetrics, scoreAssembly } from "@/lib/analysis/assembly";
import { buildAdjacency } from "@/lib/analysis/geometry";
import type { Assumptions } from "@/lib/analysis/assumptions";
import { parcelLabel, parcelToAnalysisLot } from "@/lib/parcel-analysis";
import { fsr, money, num, sqm } from "@/lib/format";
import { Badge, Button, LiveDataBadge, ScoreBadge, cx } from "@/components/ui";
import { ParcelPanel } from "./parcel-panel";

const LeafletMap = dynamic(() => import("./leaflet-map"), { ssr: false, loading: () => <div className="h-full w-full bg-[#e8eaed]" /> });

const MIN_PARCEL_ZOOM = 17;
const START = { lat: -33.8362, lng: 151.2176, zoom: 18 };

interface LoadState {
  loading: boolean;
  cadastreStatus?: string;
  planningStatus?: string;
  messages: string[];
  zoom: number;
}

interface FindResult {
  startId: string;
  candidates: AssemblyCandidate[];
  neighbours: string[];
  messages: string[];
}

export function MapWorkspace({ assumptions }: { assumptions: Assumptions }) {
  const router = useRouter();
  const [parcels, setParcels] = useState<Map<string, ParcelData>>(new Map());
  const [load, setLoad] = useState<LoadState>({ loading: false, messages: [], zoom: START.zoom });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assembly, setAssembly] = useState<string[]>([]);
  const [find, setFind] = useState<FindResult | null>(null);
  const [finding, setFinding] = useState(false);
  const [findError, setFindError] = useState<string | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [zoneFill, setZoneFill] = useState(true);
  const [zoningWms, setZoningWms] = useState(false);
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number; zoom?: number; bbox?: BBox; nonce: number } | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [geoMessage, setGeoMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBBox = useRef<BBox | null>(null);
  const candidatesRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (find) candidatesRef.current?.scrollIntoView({ block: "start" });
  }, [find]);

  const fetchParcels = useCallback(async (bbox: BBox) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoad((s) => ({ ...s, loading: true }));
    try {
      const res = await fetch(`/api/parcels?bbox=${[bbox.west, bbox.south, bbox.east, bbox.north].map((n) => n.toFixed(6)).join(",")}`, { signal: ac.signal });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Parcel request failed");
      setParcels((prev) => {
        const next = prev.size > 4000 ? new Map<string, ParcelData>() : new Map(prev);
        for (const p of body.parcels as ParcelData[]) next.set(p.externalParcelId, p);
        return next;
      });
      setLoad((s) => ({ ...s, loading: false, cadastreStatus: body.cadastreStatus, planningStatus: body.planningStatus, messages: body.messages }));
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setLoad((s) => ({ ...s, loading: false, messages: [(err as Error).message] }));
    }
  }, []);

  const onViewportChange = useCallback(
    (bbox: BBox, zoom: number) => {
      lastBBox.current = bbox;
      setLoad((s) => ({ ...s, zoom }));
      if (zoom < MIN_PARCEL_ZOOM) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => fetchParcels(bbox), 350);
    },
    [fetchParcels],
  );

  const parcelList = useMemo(() => [...parcels.values()], [parcels]);
  const selected = selectedId ? parcels.get(selectedId) ?? null : null;

  const onParcelClick = useCallback((id: string, shift: boolean) => {
    if (shift) setAssembly((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));
    setSelectedId(id);
  }, []);

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    if (query.trim().length < 2) return;
    setGeoMessage(null);
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
    const body = await res.json();
    setResults(body.results ?? []);
    setGeoMessage(body.message ?? (body.results?.length ? null : "No NSW matches found."));
    if (body.results?.length === 1) goTo(body.results[0]);
  }

  function goTo(r: GeocodeResult) {
    setResults(null);
    setQuery(r.label.split(",")[0]);
    const zoom = r.kind === "address" ? 19 : 17;
    setFlyTo({ lat: r.lat, lng: r.lng, zoom, bbox: r.kind === "address" ? undefined : r.bbox, nonce: Date.now() });
  }

  async function findAssemblies(p: ParcelData) {
    setFinding(true);
    setFindError(null);
    setActiveKey(null);
    try {
      const res = await fetch("/api/assemblies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ startId: p.externalParcelId, lng: p.centroid[0], lat: p.centroid[1] }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Assembly search failed");
      setParcels((prev) => {
        const next = new Map(prev);
        for (const x of body.parcels as ParcelData[]) if (!next.has(x.externalParcelId)) next.set(x.externalParcelId, x);
        return next;
      });
      setFind({ startId: body.startId, candidates: body.candidates, neighbours: body.neighbours, messages: body.messages });
    } catch (err) {
      setFindError((err as Error).message);
    } finally {
      setFinding(false);
    }
  }

  const assemblyParcels = assembly.map((id) => parcels.get(id)).filter((p): p is ParcelData => !!p);
  const manualMetrics = useMemo(() => {
    if (assemblyParcels.length < 1) return null;
    const adj = buildAdjacency(assemblyParcels.map((p) => ({ id: p.externalParcelId, geometry: p.geometry })));
    const m = computeAssemblyMetrics(assemblyParcels.map(parcelToAnalysisLot), assumptions, adj);
    return { metrics: m, score: scoreAssembly(m, assumptions) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assembly.join("|"), assumptions, parcels]);

  const highlightIds = useMemo(() => {
    const key = hoverKey ?? activeKey;
    return find?.candidates.find((c) => c.key === key)?.lotIds ?? [];
  }, [hoverKey, activeKey, find]);

  function defaultName(ids: string[]) {
    const ps = ids.map((id) => parcels.get(id)).filter(Boolean) as ParcelData[];
    const suburb = ps.find((p) => p.suburb)?.suburb ?? "NSW";
    const streets = ps.map((p) => p.address?.replace(/^[\d\-/A-Za-z]+\s+/, "").replace(/,.*$/, "")).filter(Boolean) as string[];
    const street = streets.sort((a, b) => streets.filter((s) => s === b).length - streets.filter((s) => s === a).length)[0];
    return `${suburb} – ${street ?? "Site"} Assembly`;
  }

  async function save(ids: string[], name?: string) {
    setSaving(true);
    const ps = ids.map((id) => parcels.get(id)).filter(Boolean);
    const res = await fetch("/api/opportunities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name?.trim() || defaultName(ids), parcels: ps }) });
    const body = await res.json();
    setSaving(false);
    if (!res.ok) return setFindError(body.error ?? "Could not save opportunity");
    router.push(`/opportunities/${body.id}`);
  }

  useEffect(() => {
    setSaveName(assembly.length ? defaultName(assembly) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assembly.join("|")]);

  const letters = "ABCDEFGH";
  const showZoomHint = load.zoom < MIN_PARCEL_ZOOM;

  return (
    <div className="flex h-full">
      <div className="relative min-w-0 flex-1">
        <LeafletMap
          parcels={parcelList}
          selectedId={selectedId}
          assemblyIds={assembly}
          highlightIds={highlightIds}
          neighbourIds={find && selectedId === find.startId && !highlightIds.length ? find.neighbours : []}
          zoneFill={zoneFill}
          zoningWms={zoningWms}
          flyTo={flyTo}
          initial={START}
          onParcelClick={onParcelClick}
          onViewportChange={onViewportChange}
        />
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[1000] flex items-start gap-3 p-3">
          <form onSubmit={search} className="pointer-events-auto relative w-[380px]">
            <div className="flex overflow-hidden rounded-[3px] border border-line bg-white shadow-sm">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search address or suburb — e.g. Neutral Bay NSW"
                className="h-9 flex-1 px-3 outline-none"
                aria-label="Search address or suburb"
              />
              <button className="border-l border-line px-3 text-[11px] font-semibold uppercase tracking-wide text-brand hover:bg-canvas">Search</button>
            </div>
            {(results?.length || geoMessage) && (
              <div className="mt-1 rounded-[3px] border border-line bg-white shadow-md">
                {geoMessage && <div className="px-3 py-2 text-[11.5px] text-muted">{geoMessage}</div>}
                {results?.map((r) => (
                  <button type="button" key={`${r.lat},${r.lng},${r.label}`} onClick={() => goTo(r)} className="block w-full border-t border-line px-3 py-2 text-left text-[12px] first:border-0 hover:bg-canvas">
                    {r.label}
                    <span className="ml-2 text-[10.5px] uppercase text-muted">{r.kind}</span>
                  </button>
                ))}
              </div>
            )}
          </form>
          <div className="pointer-events-auto flex items-center gap-1 rounded-[3px] border border-line bg-white p-1 shadow-sm">
            <label className="flex cursor-pointer items-center gap-1.5 px-2 text-[11.5px]">
              <input type="checkbox" checked={zoneFill} onChange={(e) => setZoneFill(e.target.checked)} /> Zone fill
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 border-l border-line px-2 text-[11.5px]">
              <input type="checkbox" checked={zoningWms} onChange={(e) => setZoningWms(e.target.checked)} /> LEP zoning layer
            </label>
          </div>
          <div className="pointer-events-auto ml-auto flex items-center gap-2 rounded-[3px] border border-line bg-white px-2.5 py-1.5 shadow-sm">
            {load.cadastreStatus === "unavailable" ? <Badge tone="bad">Cadastre unavailable</Badge> : <LiveDataBadge cached={load.cadastreStatus === "cached"} />}
            {load.planningStatus && load.planningStatus !== "live" && <Badge tone="warn">Planning {load.planningStatus}</Badge>}
            <span className="num text-[11px] text-muted">{load.loading ? "Loading parcels…" : `${parcels.size.toLocaleString("en-AU")} parcels`}</span>
          </div>
        </div>
        {showZoomHint && (
          <div className="absolute bottom-8 left-1/2 z-[1000] -translate-x-1/2 rounded-[3px] bg-ink/85 px-3 py-1.5 text-[12px] text-white">Zoom in to view NSW cadastral parcels</div>
        )}
        {load.messages.length > 0 && (
          <div className="absolute bottom-8 left-3 z-[1000] max-w-[460px] rounded-[3px] border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-900 shadow-sm">
            {load.messages.map((m) => (
              <div key={m}>{m}</div>
            ))}
            <button className="mt-1 text-[11px] font-semibold uppercase underline" onClick={() => lastBBox.current && fetchParcels(lastBBox.current)}>
              Retry
            </button>
          </div>
        )}
        <div className="absolute bottom-8 right-14 z-[1000] rounded-[3px] bg-white/90 px-2 py-1 text-[10.5px] text-muted shadow-sm">Click a parcel · Shift-click to add to assembly</div>
      </div>

      <aside className="flex w-[400px] shrink-0 flex-col overflow-y-auto border-l border-line bg-white">
        {assembly.length > 0 && manualMetrics && (
          <div className="border-b border-line bg-brand-soft/60 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-brand">Current assembly · {assembly.length} lots</h3>
              <button className="text-[11px] text-muted hover:text-ink" onClick={() => setAssembly([])}>
                Clear
              </button>
            </div>
            <ul className="mt-2 space-y-1">
              {assemblyParcels.map((p) => (
                <li key={p.externalParcelId} className="flex items-center justify-between gap-2 text-[12px]">
                  <button className="truncate text-left hover:underline" onClick={() => setSelectedId(p.externalParcelId)}>
                    {parcelLabel(p)}
                  </button>
                  <span className="num shrink-0 text-muted">{sqm(p.areaSqm)}</span>
                  <button aria-label="Remove" className="text-muted hover:text-bad" onClick={() => setAssembly((a) => a.filter((x) => x !== p.externalParcelId))}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
              <div>
                <div className="text-[10.5px] uppercase text-muted">Site</div>
                <div className="num font-semibold">{sqm(manualMetrics.metrics.totalAreaSqm)}</div>
              </div>
              <div>
                <div className="text-[10.5px] uppercase text-muted">GFA (ind.)</div>
                <div className="num font-semibold">{sqm(manualMetrics.metrics.gfa)}</div>
              </div>
              <div>
                <div className="text-[10.5px] uppercase text-muted">Score</div>
                <ScoreBadge score={manualMetrics.score.score} />
              </div>
            </div>
            {!manualMetrics.metrics.connected && assembly.length > 1 && <div className="mt-2 text-[11.5px] font-medium text-bad">Lots are not contiguous — check the selection.</div>}
            <div className="mt-3 flex gap-2">
              <input value={saveName} onChange={(e) => setSaveName(e.target.value)} className="h-8 min-w-0 flex-1 rounded-[3px] border border-line bg-white px-2 text-[12px]" aria-label="Opportunity name" />
              <Button variant="primary" size="sm" className="h-8" disabled={saving} onClick={() => save(assembly, saveName)}>
                {saving ? "Saving…" : "Save opportunity"}
              </Button>
            </div>
          </div>
        )}

        <div className="p-4">
          {selected ? (
            <ParcelPanel
              parcel={selected}
              assumptions={assumptions}
              inAssembly={assembly.includes(selected.externalParcelId)}
              onAdd={() => setAssembly((a) => [...a, selected.externalParcelId])}
              onRemove={() => setAssembly((a) => a.filter((x) => x !== selected.externalParcelId))}
              onFind={() => findAssemblies(selected)}
              finding={finding}
              onRetry={() => lastBBox.current && fetchParcels(lastBBox.current)}
            />
          ) : (
            <div className="text-[12.5px] leading-relaxed text-muted">
              <h2 className="mb-2 text-[15px] font-semibold text-ink">Development map</h2>
              <p>Search a Sydney suburb or address, then click a residential parcel to see its NSW planning controls.</p>
              <p className="mt-2">
                <strong className="text-ink">Find assemblies</strong> tests connected combinations of 2–{assumptions.maxAssemblySize} adjoining lots and ranks them by opportunity score. Shift-click lots to build an assembly manually.
              </p>
            </div>
          )}
        </div>

        {findError && <div className="mx-4 mb-3 rounded-[3px] border border-red-200 bg-red-50 p-2 text-[12px] text-bad">{findError}</div>}

        {find && find.startId === selectedId && (
          <div className="border-t border-line p-4" ref={candidatesRef}>
            <div className="flex items-baseline justify-between">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Assembly candidates</h3>
              <span className="text-[11px] text-muted">{find.neighbours.length} adjoining lots found</span>
            </div>
            {find.candidates.length === 0 && <p className="mt-2 text-[12px] text-muted">No developable adjoining combinations found for this lot.</p>}
            <div className="mt-2 space-y-2">
              {find.candidates.map((c, i) => (
                <div
                  key={c.key}
                  onMouseEnter={() => setHoverKey(c.key)}
                  onMouseLeave={() => setHoverKey(null)}
                  onClick={() => setActiveKey(c.key)}
                  className={cx("cursor-pointer rounded-[3px] border p-3 transition-colors", activeKey === c.key ? "border-accent bg-orange-50/40" : "border-line hover:border-accent/60")}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-[12.5px] font-semibold">
                        Option {letters[i]} · {c.metrics.lotCount} lots
                      </div>
                      <div className="mt-0.5 text-[11px] leading-snug text-muted">{c.lotIds.map((id) => (parcels.get(id) ? parcelLabel(parcels.get(id)!) : id)).join(" + ")}</div>
                    </div>
                    <ScoreBadge score={c.score.score} />
                  </div>
                  <div className="num mt-2 grid grid-cols-4 gap-1 text-[11.5px]">
                    <div>
                      <div className="text-[10px] uppercase text-muted">Site</div>
                      {num(c.metrics.totalAreaSqm)} m²
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-muted">Owners</div>
                      {c.metrics.owners}
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-muted">FSR</div>
                      {fsr(c.metrics.weightedFsr)}
                      {c.metrics.fsrEstimated && "*"}
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-muted">GFA</div>
                      {num(c.metrics.gfa)} m²
                    </div>
                  </div>
                  <div className="mt-1 text-[11px] text-muted">
                    Indicative land budget {money(c.metrics.indicativeBudget, { compact: true })} vs est. value {money(c.metrics.combinedValue, { compact: true })}
                  </div>
                  <ul className="mt-2 space-y-0.5 text-[11.5px]">
                    {c.score.factors.slice(0, 5).map((f) => (
                      <li key={f.text} className={f.sign === "+" ? "text-good" : "text-bad"}>
                        {f.sign === "+" ? "+" : "−"} {f.text}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={saving}
                      onClick={(e) => {
                        e.stopPropagation();
                        save(c.lotIds);
                      }}
                    >
                      Analyse
                    </Button>
                    <Button
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setAssembly(c.lotIds);
                      }}
                    >
                      Edit selection
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[10.5px] text-muted">* FSR estimated where the LEP maps none. Scores use global assumptions and estimated existing values ($/sqm) until values are entered.</p>
          </div>
        )}
      </aside>
    </div>
  );
}
