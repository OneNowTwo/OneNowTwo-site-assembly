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
import type { ScanCandidate } from "@/lib/analysis/area-scan";
import type { NominatedCentre } from "@/lib/data-sources/housing-sepp-lmr";
import { parcelLabel, parcelToAnalysisLot } from "@/lib/parcel-analysis";
import { money, num, pct, sqm, fsr } from "@/lib/format";
import { Badge, Button, LiveDataBadge, ScoreBadge, Select, cx } from "@/components/ui";
import { ParcelPanel } from "./parcel-panel";

const LeafletMap = dynamic(() => import("./leaflet-map"), { ssr: false, loading: () => <div className="h-full w-full bg-[#e8eaed]" /> });

const MIN_PARCEL_ZOOM = 17;
const START = { lat: -33.8362, lng: 151.2176, zoom: 18 };

type CompareSort = "score" | "headroom" | "profit" | "owners" | "area" | "moc";

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

interface ScanState {
  scanning: boolean;
  stage: string;
  error: string | null;
  candidates: ScanCandidate[];
  families: { familyId: string; best: ScanCandidate; alternatives: ScanCandidate[] }[];
  messages: string[];
  progress: string[];
  parcelsConsidered: number;
  parcelsEligible: number;
  assembliesGenerated: number;
}

export function MapWorkspace({ assumptions, initialScanQuery = null }: { assumptions: Assumptions; initialScanQuery?: string | null }) {
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
  const [compareSort, setCompareSort] = useState<CompareSort>("headroom");
  const [centres, setCentres] = useState<NominatedCentre[]>([]);
  const [scan, setScan] = useState<ScanState>({
    scanning: false,
    stage: "",
    error: null,
    candidates: [],
    families: [],
    messages: [],
    progress: [],
    parcelsConsidered: 0,
    parcelsEligible: 0,
    assembliesGenerated: 0,
  });
  const [scanExpanded, setScanExpanded] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBBox = useRef<BBox | null>(null);
  const candidatesRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (find || scan.candidates.length) candidatesRef.current?.scrollIntoView({ block: "start" });
  }, [find, scan.candidates.length]);

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
      timerRef.current = setTimeout(() => {
        fetchParcels(bbox);
        const pad = 0.02;
        fetch(`/api/lmr/centres?bbox=${[bbox.west - pad, bbox.south - pad, bbox.east + pad, bbox.north + pad].map((n) => n.toFixed(5)).join(",")}`)
          .then((r) => r.json())
          .then((body) => {
            if (Array.isArray(body.centres)) setCentres(body.centres);
          })
          .catch(() => null);
      }, 350);
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

  async function scanThisArea(forceQuery?: string) {
    const bbox = lastBBox.current;
    const q = (forceQuery ?? query).trim();
    setScan((s) => ({ ...s, scanning: true, stage: "Loading parcels…", error: null, candidates: [], families: [] }));
    setFind(null);
    setActiveKey(null);
    try {
      const bodyPayload: Record<string, unknown> = { maxResults: 12 };
      if (q.length >= 2) bodyPayload.suburbHint = q;
      else if (bbox) {
        bodyPayload.west = bbox.west;
        bodyPayload.south = bbox.south;
        bodyPayload.east = bbox.east;
        bodyPayload.north = bbox.north;
      } else {
        throw new Error("Search a suburb or zoom the map before scanning");
      }
      setScan((s) => ({ ...s, stage: "Applying planning controls…" }));
      const res = await fetch("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bodyPayload) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Area scan failed");
      if (body.bbox) {
        setFlyTo({
          lat: (body.bbox.south + body.bbox.north) / 2,
          lng: (body.bbox.west + body.bbox.east) / 2,
          bbox: body.bbox,
          zoom: 16,
          nonce: Date.now(),
        });
        fetchParcels(body.bbox);
      }
      if (Array.isArray(body.centres)) setCentres(body.centres);
      setScan({
        scanning: false,
        stage: "Done",
        error: null,
        candidates: body.candidates ?? [],
        families: body.families ?? [],
        messages: body.messages ?? [],
        progress: body.progress ?? [],
        parcelsConsidered: body.parcelsConsidered ?? 0,
        parcelsEligible: body.parcelsEligible ?? 0,
        assembliesGenerated: body.assembliesGenerated ?? 0,
      });
    } catch (err) {
      setScan((s) => ({ ...s, scanning: false, stage: "", error: (err as Error).message }));
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
    const fromFind = find?.candidates.find((c) => c.key === key)?.lotIds;
    if (fromFind) return fromFind;
    return scan.candidates.find((c) => c.key === key)?.lotIds ?? scan.families.find((f) => f.familyId === key)?.best.lotIds ?? [];
  }, [hoverKey, activeKey, find, scan.candidates, scan.families]);

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

  useEffect(() => {
    if (!initialScanQuery || initialScanQuery.length < 2) return;
    setQuery(initialScanQuery);
    void scanThisArea(initialScanQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialScanQuery]);

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
            <Button size="sm" variant="accent" className="h-8" disabled={scan.scanning} onClick={() => scanThisArea()}>
              {scan.scanning ? scan.stage || "Scanning…" : "Scan this area"}
            </Button>
            <label className="flex cursor-pointer items-center gap-1.5 border-l border-line px-2 text-[11.5px]">
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
              centres={centres}
            />
          ) : (
            <div className="text-[12.5px] leading-relaxed text-muted">
              <h2 className="mb-2 text-[15px] font-semibold text-ink">Development map</h2>
              <p>Three ways to work:</p>
              <ul className="mt-2 list-disc space-y-1.5 pl-4">
                <li>
                  <strong className="text-ink">Search property</strong> — analyse a known site.
                </li>
                <li>
                  <strong className="text-ink">Find assemblies</strong> — start from a selected parcel (2–{assumptions.maxAssemblySize} lots).
                </li>
                <li>
                  <strong className="text-ink">Scan this area</strong> — auto-discover assemblies without picking a start lot.
                </li>
              </ul>
              <p className="mt-2">
                Use <strong className="text-ink">Radar</strong> in the nav to find promising precincts (e.g. LMR centre catchments), then scan.
              </p>
            </div>
          )}
        </div>

        {findError && <div className="mx-4 mb-3 rounded-[3px] border border-red-200 bg-red-50 p-2 text-[12px] text-bad">{findError}</div>}
        {scan.error && <div className="mx-4 mb-3 rounded-[3px] border border-red-200 bg-red-50 p-2 text-[12px] text-bad">{scan.error}</div>}

        {!!scan.candidates.length && (
          <div className="border-t border-line p-4" ref={candidatesRef}>
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Top opportunities in scan</h3>
              <span className="text-[10.5px] text-muted">
                {scan.parcelsEligible}/{scan.parcelsConsidered} eligible · {scan.assembliesGenerated} combos
              </span>
            </div>
            {scan.messages.map((m) => (
              <p key={m} className="mt-1 text-[11px] text-amber-900">
                {m}
              </p>
            ))}
            <div className="mt-3 space-y-2">
              {scan.families.map((fam) => {
                const c = fam.best;
                const open = scanExpanded === fam.familyId;
                return (
                  <div
                    key={fam.familyId}
                    onMouseEnter={() => setHoverKey(c.key)}
                    onMouseLeave={() => setHoverKey(null)}
                    onClick={() => setActiveKey(c.key)}
                    className={cx("cursor-pointer rounded-[3px] border p-3 transition-colors", activeKey === c.key ? "border-accent bg-orange-50/40" : "border-line hover:border-accent/60")}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-[12.5px] font-semibold">
                          #{c.rank} · {c.locationLabel}
                        </div>
                        <div className="mt-0.5 text-[11px] text-muted">
                          {c.lotCount} lots · {c.owners} owners · {sqm(c.siteAreaSqm)}
                          {c.lmrCentre ? ` · near ${c.lmrCentre}` : ""}
                        </div>
                      </div>
                      <ScoreBadge score={c.score.score} />
                    </div>
                    <div className="num mt-2 grid grid-cols-3 gap-1 text-[11.5px]">
                      <div>
                        <div className="text-[10px] uppercase text-muted">LEP FSR</div>
                        {c.lepFsr != null ? fsr(c.lepFsr) : "—"}
                      </div>
                      <div>
                        <div className="text-[10px] uppercase text-muted">Effective FSR</div>
                        <span className="font-semibold">{c.effectiveFsr != null ? fsr(c.effectiveFsr) : "—"}</span>
                        {c.effectiveCertainty === "REQUIRES_PLANNING_CONFIRMATION" && <div className="text-[9.5px] font-sans text-amber-800">Confirm</div>}
                      </div>
                      <div>
                        <div className="text-[10px] uppercase text-muted">Units (ind.)</div>
                        {c.indicativeUnits}
                      </div>
                      <div>
                        <div className="text-[10px] uppercase text-muted">Existing</div>
                        {money(c.existingValue, { compact: true })}
                        {c.existingValueEstimated ? "*" : ""}
                      </div>
                      <div>
                        <div className="text-[10px] uppercase text-muted">Max payable</div>
                        {money(c.maxPayable, { compact: true })}
                      </div>
                      <div>
                        <div className="text-[10px] uppercase text-muted">Headroom</div>
                        <span className="font-semibold text-good">{money(c.headroom, { compact: true })}</span>
                      </div>
                    </div>
                    {!!c.constraints.length && <div className="mt-2 text-[10.5px] text-muted">{c.constraints.join(" · ")}</div>}
                    <ul className="mt-2 space-y-0.5 text-[11.5px]">
                      {c.scoreFactors.slice(0, 3).map((f) => (
                        <li key={f.text} className={f.sign === "+" ? "text-good" : "text-bad"}>
                          {f.sign === "+" ? "+" : "−"} {f.text}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-2 flex flex-wrap gap-2">
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
                          setSelectedId(c.lotIds[0] ?? null);
                        }}
                      >
                        View on map
                      </Button>
                      {!!fam.alternatives.length && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            setScanExpanded(open ? null : fam.familyId);
                          }}
                        >
                          {open ? "Hide" : `${fam.alternatives.length} alternatives`}
                        </Button>
                      )}
                    </div>
                    {open && (
                      <div className="mt-2 space-y-1 border-t border-line pt-2">
                        {fam.alternatives.map((alt) => (
                          <button
                            key={alt.key}
                            type="button"
                            className="flex w-full items-center justify-between rounded-[2px] px-1 py-1 text-left text-[11px] hover:bg-canvas"
                            onMouseEnter={() => setHoverKey(alt.key)}
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveKey(alt.key);
                              setAssembly(alt.lotIds);
                            }}
                          >
                            <span>
                              {alt.lotCount} lots · {sqm(alt.siteAreaSqm)} · eff {alt.effectiveFsr != null ? fsr(alt.effectiveFsr) : "—"}
                            </span>
                            <span className="num text-good">{money(alt.headroom, { compact: true })}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {find && find.startId === selectedId && (
          <div className="border-t border-line p-4" ref={candidatesRef}>
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Assembly comparison</h3>
              <Select
                value={compareSort}
                onChange={(v) => setCompareSort(v as CompareSort)}
                options={[
                  { value: "headroom", label: "Sort: Headroom $" },
                  { value: "score", label: "Sort: Score" },
                  { value: "profit", label: "Sort: Profit" },
                  { value: "moc", label: "Sort: MOC" },
                  { value: "owners", label: "Sort: Fewest owners" },
                  { value: "area", label: "Sort: Site area" },
                ]}
                className="h-7 text-[11px]"
              />
            </div>
            <p className="mt-1 text-[11px] text-muted">{find.neighbours.length} adjoining lots · best combo is not always the largest</p>
            {find.candidates.length === 0 && <p className="mt-2 text-[12px] text-muted">No developable adjoining combinations found for this lot.</p>}
            {!!find.candidates.length && (
              <div className="mt-2 overflow-x-auto rounded-[3px] border border-line">
                <table className="num w-full min-w-[640px] text-[11px]">
                  <thead className="bg-canvas text-[10px] uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-2 py-1.5 text-left">Assembly</th>
                      <th className="px-1 py-1.5 text-right">Lots</th>
                      <th className="px-1 py-1.5 text-right">Area</th>
                      <th className="px-1 py-1.5 text-right">Existing</th>
                      <th className="px-1 py-1.5 text-right">Units</th>
                      <th className="px-1 py-1.5 text-right">GRV</th>
                      <th className="px-1 py-1.5 text-right">Max payable</th>
                      <th className="px-1 py-1.5 text-right">Headroom</th>
                      <th className="px-1 py-1.5 text-right">Headroom %</th>
                      <th className="px-1 py-1.5 text-right">Score</th>
                      <th className="px-1 py-1.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {[...find.candidates]
                      .sort((x, y) => {
                        switch (compareSort) {
                          case "headroom":
                            return y.metrics.acquisitionHeadroom - x.metrics.acquisitionHeadroom;
                          case "profit":
                            return y.metrics.profit - x.metrics.profit;
                          case "moc":
                            return y.metrics.marginOnCost - x.metrics.marginOnCost;
                          case "owners":
                            return x.metrics.owners - y.metrics.owners || y.metrics.acquisitionHeadroom - x.metrics.acquisitionHeadroom;
                          case "area":
                            return y.metrics.totalAreaSqm - x.metrics.totalAreaSqm;
                          default:
                            return y.score.score - x.score.score || y.metrics.acquisitionHeadroom - x.metrics.acquisitionHeadroom;
                        }
                      })
                      .map((c, i, arr) => {
                        const bestHeadroom = Math.max(...arr.map((x) => x.metrics.acquisitionHeadroom));
                        const isBest = c.metrics.acquisitionHeadroom === bestHeadroom && bestHeadroom > 0;
                        const isLargest = c.metrics.lotCount === Math.max(...arr.map((x) => x.metrics.lotCount));
                        return (
                          <tr
                            key={c.key}
                            onMouseEnter={() => setHoverKey(c.key)}
                            onMouseLeave={() => setHoverKey(null)}
                            onClick={() => setActiveKey(c.key)}
                            className={cx("cursor-pointer border-t border-line", activeKey === c.key && "bg-orange-50/50", isBest && "bg-emerald-50/40")}
                          >
                            <td className="px-2 py-1.5">
                              <div className="font-semibold">
                                Option {letters[i]}
                                {isBest && !isLargest && <Badge tone="good">Best headroom</Badge>}
                                {isLargest && !isBest && <Badge tone="warn">Largest ≠ best</Badge>}
                              </div>
                              <div className="max-w-[160px] truncate text-[10px] text-muted">{c.lotIds.map((id) => (parcels.get(id) ? parcelLabel(parcels.get(id)!) : id)).join(" + ")}</div>
                            </td>
                            <td className="px-1 py-1.5 text-right">{c.metrics.lotCount}</td>
                            <td className="px-1 py-1.5 text-right">{num(c.metrics.totalAreaSqm)}</td>
                            <td className="px-1 py-1.5 text-right">{money(c.metrics.combinedValue, { compact: true })}</td>
                            <td className="px-1 py-1.5 text-right">{c.metrics.dwellings}</td>
                            <td className="px-1 py-1.5 text-right">{money(c.metrics.grv, { compact: true })}</td>
                            <td className="px-1 py-1.5 text-right font-semibold text-brand">{money(c.metrics.maxPayableToOwners, { compact: true })}</td>
                            <td className="px-1 py-1.5 text-right font-semibold text-good">{money(c.metrics.acquisitionHeadroom, { compact: true })}</td>
                            <td className="px-1 py-1.5 text-right">{pct(c.metrics.acquisitionHeadroomPercent, 0)}</td>
                            <td className="px-1 py-1.5 text-right">
                              <ScoreBadge score={c.score.score} />
                            </td>
                            <td className="px-1 py-1.5 text-right">
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
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-3 space-y-2">
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
                        Option {letters[i]} · {c.metrics.lotCount} lots · {c.metrics.owners} owners
                      </div>
                      <div className="mt-0.5 text-[11px] leading-snug text-muted">{c.lotIds.map((id) => (parcels.get(id) ? parcelLabel(parcels.get(id)!) : id)).join(" + ")}</div>
                    </div>
                    <ScoreBadge score={c.score.score} />
                  </div>
                  <div className="num mt-2 grid grid-cols-4 gap-1 text-[11.5px]">
                    <div>
                      <div className="text-[10px] uppercase text-muted">Max payable</div>
                      {money(c.metrics.maxPayableToOwners, { compact: true })}
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-muted">Existing</div>
                      {money(c.metrics.combinedValue, { compact: true })}
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-muted">Headroom</div>
                      <span className="font-semibold text-good">{money(c.metrics.acquisitionHeadroom, { compact: true })}</span>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase text-muted">Headroom %</div>
                      {pct(c.metrics.acquisitionHeadroomPercent, 0)}
                    </div>
                  </div>
                  <ul className="mt-2 space-y-0.5 text-[11.5px]">
                    {c.score.factors.slice(0, 4).map((f) => (
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
            <p className="mt-2 text-[10.5px] text-muted">Headroom = max payable − existing property value. Existing values use the fallback $/sqm estimate until entered. Largest assembly is highlighted when it is not the best headroom.</p>
          </div>
        )}
      </aside>
    </div>
  );
}
