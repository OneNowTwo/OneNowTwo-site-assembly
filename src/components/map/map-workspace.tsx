"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { BBox, ParcelData } from "@/lib/types";
import type { GeocodeResult } from "@/lib/data-sources/providers";
import type { AssemblyCandidate } from "@/lib/analysis/assembly";
import { computeAssemblyMetrics, scoreAssembly } from "@/lib/analysis/assembly";
import { buildAdjacency } from "@/lib/analysis/geometry";
import type { Assumptions, OpportunityInputs } from "@/lib/analysis/assumptions";
import type { ScanCandidate } from "@/lib/analysis/area-scan";
import type { NominatedCentre } from "@/lib/data-sources/housing-sepp-lmr";
import { parcelLabel, parcelToAnalysisLot } from "@/lib/parcel-analysis";
import { money, num, pct, sqm, fsr } from "@/lib/format";
import { Badge, Button, LiveDataBadge, ScoreBadge, Select, cx } from "@/components/ui";
import { ParcelPanel } from "./parcel-panel";
import {
  clearScanSession,
  loadMapState,
  loadScanSession,
  newScanSessionId,
  saveMapState,
  saveScanSession,
} from "@/lib/map-state";
import { SCAN_CALCULATION_VERSION } from "@/lib/analysis/assembly-feasibility";
import { ApiJsonError, fetchApiJson, fetchApiJsonWithRetry, isTransientHttpError } from "@/lib/api-json";
import {
  POST_SCAN_PARCEL_COOLDOWN_MS,
  POST_SCAN_PARCEL_REFRESH_DELAY_MS,
  scanReturnedSufficientParcels,
  shouldSilentSoftFailTransient,
} from "@/lib/map-parcel-refresh";

const LeafletMap = dynamic(() => import("./leaflet-map"), { ssr: false, loading: () => <div className="h-full w-full bg-[#e8eaed]" /> });

const MIN_PARCEL_ZOOM = 17;
const DEFAULT_START = { lat: -33.8362, lng: 151.2176, zoom: 18 };

/** Wall clock outside the component so React Compiler does not treat map handlers as impure render. */
function nowMs(): number {
  return Date.now();
}

/** Client-side stage labels while /api/scan is in flight (server returns final progress). */
const SCAN_STAGE_LABELS = [
  "Planning scan complete",
  "Generating assemblies",
  "Valuing properties",
  "Running feasibility",
  "Ranking opportunities",
] as const;

function initialMapStart() {
  const saved = typeof window !== "undefined" ? loadMapState() : null;
  if (saved) return { lat: saved.lat, lng: saved.lng, zoom: saved.zoom };
  return DEFAULT_START;
}

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
  sessionId: string | null;
  candidates: ScanCandidate[];
  families: { familyId: string; best: ScanCandidate; alternatives: ScanCandidate[] }[];
  messages: string[];
  progress: string[];
  parcelsConsidered: number;
  parcelsEligible: number;
  assembliesGenerated: number;
  funnelSummary: string | null;
  hiddenKeys: string[];
  showAllAssemblies: boolean;
  bbox: BBox | null;
}

function emptyScan(): ScanState {
  return {
    scanning: false,
    stage: "",
    error: null,
    sessionId: null,
    candidates: [],
    families: [],
    messages: [],
    progress: [],
    parcelsConsidered: 0,
    parcelsEligible: 0,
    assembliesGenerated: 0,
    funnelSummary: null,
    hiddenKeys: [],
    showAllAssemblies: true,
    bbox: null,
  };
}

export function MapWorkspace({
  assumptions,
  initialScanQuery = null,
  mapVisible = true,
}: {
  assumptions: Assumptions;
  initialScanQuery?: string | null;
  /** False while the persistent shell keeps the map mounted but hidden under another tab. */
  mapVisible?: boolean;
}) {
  const router = useRouter();
  const start = useMemo(() => initialMapStart(), []);
  const restoredScan = useMemo(() => (typeof window !== "undefined" ? loadScanSession() : null), []);
  const [parcels, setParcels] = useState<Map<string, ParcelData>>(new Map());
  const [load, setLoad] = useState<LoadState>({ loading: false, messages: [], zoom: start.zoom });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assembly, setAssembly] = useState<string[]>([]);
  const [find, setFind] = useState<FindResult | null>(null);
  const [finding, setFinding] = useState(false);
  const [findError, setFindError] = useState<string | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(restoredScan?.activeKey ?? null);
  const [zoneFill, setZoneFill] = useState(() => loadMapState()?.zoneFill ?? true);
  const [zoningWms, setZoningWms] = useState(() => loadMapState()?.zoningWms ?? false);
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number; zoom?: number; bbox?: BBox; nonce: number } | null>(null);
  const [query, setQuery] = useState(() => initialScanQuery ?? loadMapState()?.query ?? restoredScan?.query ?? "");
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [geoMessage, setGeoMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [compareSort, setCompareSort] = useState<CompareSort>("headroom");
  const [centres, setCentres] = useState<NominatedCentre[]>((restoredScan?.centres as NominatedCentre[]) ?? []);
  const [scan, setScan] = useState<ScanState>(() =>
    restoredScan
      ? {
          scanning: false,
          stage: "Restored",
          error: null,
          sessionId: restoredScan.sessionId,
          candidates: (restoredScan.candidates as ScanCandidate[]) ?? [],
          families: (restoredScan.families as ScanState["families"]) ?? [],
          messages: restoredScan.messages ?? [],
          progress: restoredScan.progress ?? [],
          parcelsConsidered: restoredScan.parcelsConsidered ?? 0,
          parcelsEligible: restoredScan.parcelsEligible ?? 0,
          assembliesGenerated: restoredScan.assembliesGenerated ?? 0,
          funnelSummary: (restoredScan.messages ?? []).find((m: string) => m.startsWith("Scan funnel:")) ?? null,
          hiddenKeys: restoredScan.hiddenKeys ?? [],
          showAllAssemblies: restoredScan.showAllAssemblies ?? true,
          bbox: restoredScan.bbox,
        }
      : emptyScan(),
  );
  const [scanExpanded, setScanExpanded] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBBox = useRef<BBox | null>(restoredScan?.bbox ?? null);
  const mapViewRef = useRef({ lat: start.lat, lng: start.lng, zoom: start.zoom });
  const candidatesRef = useRef<HTMLDivElement | null>(null);
  const parcelsCountRef = useRef(0);
  /** Suppress aggressive /api/parcels calls right after a heavy /api/scan (avoids Render 502). */
  const parcelCooldownUntilRef = useRef(0);
  const postScanRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (find || scan.candidates.length) candidatesRef.current?.scrollIntoView({ block: "start" });
  }, [find, scan.candidates.length]);

  const persistClientState = useCallback(
    (opts?: { activeKey?: string | null; scanOverride?: ScanState }) => {
      const s = opts?.scanOverride ?? scan;
      const view = mapViewRef.current;
      saveMapState({
        lat: view.lat,
        lng: view.lng,
        zoom: view.zoom,
        query,
        zoneFill,
        zoningWms,
        updatedAt: new Date().toISOString(),
      });
      if (s.candidates.length && s.sessionId) {
        saveScanSession({
          sessionId: s.sessionId,
          query,
          bbox: s.bbox,
          lat: view.lat,
          lng: view.lng,
          zoom: view.zoom,
          candidates: s.candidates,
          families: s.families,
          messages: s.messages,
          progress: s.progress,
          parcelsConsidered: s.parcelsConsidered,
          parcelsEligible: s.parcelsEligible,
          assembliesGenerated: s.assembliesGenerated,
          centres,
          activeKey: opts?.activeKey !== undefined ? opts.activeKey : activeKey,
          hiddenKeys: s.hiddenKeys,
          showAllAssemblies: s.showAllAssemblies,
          updatedAt: new Date().toISOString(),
        });
      }
      try {
        const params = new URLSearchParams();
        params.set("lat", view.lat.toFixed(5));
        params.set("lng", view.lng.toFixed(5));
        params.set("zoom", String(Math.round(view.zoom * 10) / 10));
        if (query.trim()) params.set("scan", query.trim());
        window.history.replaceState(null, "", `/map?${params.toString()}`);
      } catch {
        // ignore
      }
    },
    [scan, query, zoneFill, zoningWms, centres, activeKey],
  );

  const fetchParcels = useCallback(async (bbox: BBox, opts?: { soft?: boolean }) => {
    // soft !== false means automatic refresh; soft === false is an explicit Retry (bypass cooldown).
    const explicitRetry = opts?.soft === false;
    if (!explicitRetry && nowMs() < parcelCooldownUntilRef.current) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoad((s) => ({ ...s, loading: true }));
    try {
      const body = await fetchApiJsonWithRetry<{
        parcels: ParcelData[];
        cadastreStatus?: string;
        planningStatus?: string;
        messages?: string[];
        error?: string;
      }>(`/api/parcels?bbox=${[bbox.west, bbox.south, bbox.east, bbox.north].map((n) => n.toFixed(6)).join(",")}`, { signal: ac.signal }, { retries: 1, delayMs: 2000 });
      setParcels((prev) => {
        const next = prev.size > 4000 ? new Map<string, ParcelData>() : new Map(prev);
        for (const p of body.parcels as ParcelData[]) next.set(p.externalParcelId, p);
        parcelsCountRef.current = next.size;
        return next;
      });
      setLoad((s) => ({
        ...s,
        loading: false,
        cadastreStatus: body.cadastreStatus ?? s.cadastreStatus,
        planningStatus: body.planningStatus ?? s.planningStatus,
        messages: body.messages ?? [],
      }));
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      const transient = isTransientHttpError(err);
      // Silent only when usable parcel data already exists — never hide an empty/broken map.
      if (
        shouldSilentSoftFailTransient({
          transient,
          explicitRetry,
          usableParcelCount: parcelsCountRef.current,
        })
      ) {
        setLoad((s) => ({ ...s, loading: false }));
        return;
      }
      const base = (err as Error).message;
      const msg =
        transient && parcelsCountRef.current === 0
          ? `${base} Map parcels could not be loaded — retry when the server recovers.`
          : base;
      setLoad((s) => ({ ...s, loading: false, messages: [msg] }));
    }
  }, []);

  const onViewportChange = useCallback(
    (bbox: BBox, zoom: number) => {
      lastBBox.current = bbox;
      mapViewRef.current = {
        lat: (bbox.south + bbox.north) / 2,
        lng: (bbox.west + bbox.east) / 2,
        zoom,
      };
      setLoad((s) => ({ ...s, zoom }));
      if (zoom < MIN_PARCEL_ZOOM) return;
      if (nowMs() < parcelCooldownUntilRef.current) {
        persistClientState();
        return;
      }
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void fetchParcels(bbox, { soft: true });
        const pad = 0.02;
        fetchApiJson<{ centres?: NominatedCentre[] }>(
          `/api/lmr/centres?bbox=${[bbox.west - pad, bbox.south - pad, bbox.east + pad, bbox.north + pad].map((n) => n.toFixed(5)).join(",")}`,
        )
          .then((body) => {
            if (Array.isArray(body.centres)) setCentres(body.centres);
          })
          .catch(() => null);
        persistClientState();
      }, 350);
    },
    [fetchParcels, persistClientState],
  );

  const parcelList = useMemo(() => [...parcels.values()], [parcels]);
  const selected = selectedId ? parcels.get(selectedId) ?? null : null;

  const onParcelClick = useCallback((id: string, shift: boolean) => {
    if (shift) {
      setAssembly((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));
      setSelectedId(id);
      return;
    }
    // Toggle: second click on the same parcel deselects.
    setSelectedId((cur) => (cur === id ? null : id));
    setAssembly((a) => {
      if (!a.length) return a;
      if (a.includes(id) && a.length === 1) return [];
      if (a.includes(id)) return a.filter((x) => x !== id);
      return a;
    });
  }, []);

  const onBlankMapClick = useCallback(() => {
    setSelectedId(null);
  }, []);

  function clearSelection() {
    setSelectedId(null);
    setAssembly([]);
    setFind(null);
    setActiveKey(null);
    setHoverKey(null);
  }

  function clearScanResults() {
    const cleared = emptyScan();
    setScan(cleared);
    setActiveKey(null);
    setHoverKey(null);
    setScanExpanded(null);
    clearScanSession();
    persistClientState({ scanOverride: cleared, activeKey: null });
  }

  function clearAssembliesFromMap() {
    setScan((s) => {
      const next = { ...s, hiddenKeys: s.candidates.map((c) => c.key), showAllAssemblies: false };
      persistClientState({ scanOverride: next });
      return next;
    });
    setActiveKey(null);
  }

  function showAllAssemblies() {
    setScan((s) => {
      const next = { ...s, hiddenKeys: [], showAllAssemblies: true };
      persistClientState({ scanOverride: next });
      return next;
    });
  }

  function hideAssembly(key: string) {
    setScan((s) => {
      const hidden = s.hiddenKeys.includes(key) ? s.hiddenKeys : [...s.hiddenKeys, key];
      const next = { ...s, hiddenKeys: hidden };
      persistClientState({ scanOverride: next, activeKey: activeKey === key ? null : activeKey });
      return next;
    });
    if (activeKey === key) setActiveKey(null);
  }

  function resetMap() {
    clearScanSession();
    setScan(emptyScan());
    setSelectedId(null);
    setAssembly([]);
    setFind(null);
    setActiveKey(null);
    setHoverKey(null);
    setQuery("");
    setResults(null);
    setZoneFill(true);
    setZoningWms(false);
    mapViewRef.current = { ...DEFAULT_START };
    setFlyTo({ ...DEFAULT_START, nonce: nowMs() });
    saveMapState({
      ...DEFAULT_START,
      query: "",
      zoneFill: true,
      zoningWms: false,
      updatedAt: new Date().toISOString(),
    });
    try {
      window.history.replaceState(null, "", "/map");
    } catch {
      // ignore
    }
  }

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    if (query.trim().length < 2) return;
    setGeoMessage(null);
    try {
      const body = await fetchApiJson<{ results?: GeocodeResult[]; message?: string }>(`/api/geocode?q=${encodeURIComponent(query)}`);
      setResults(body.results ?? []);
      setGeoMessage(body.message ?? (body.results?.length ? null : "No NSW matches found."));
      if (body.results?.length === 1) goTo(body.results[0]!);
    } catch (err) {
      setResults([]);
      setGeoMessage((err as Error).message);
    }
  }

  function goTo(r: GeocodeResult) {
    setResults(null);
    setQuery(r.label.split(",")[0]);
    const zoom = r.kind === "address" ? 19 : 17;
    setFlyTo({ lat: r.lat, lng: r.lng, zoom, bbox: r.kind === "address" ? undefined : r.bbox, nonce: nowMs() });
  }

  async function findAssemblies(p: ParcelData) {
    setFinding(true);
    setFindError(null);
    setActiveKey(null);
    try {
      const body = await fetchApiJson<{
        parcels: ParcelData[];
        startId: string;
        candidates: AssemblyCandidate[];
        neighbours: string[];
        messages: string[];
      }>("/api/assemblies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startId: p.externalParcelId, lng: p.centroid[0], lat: p.centroid[1] }),
      });
      setParcels((prev) => {
        const next = new Map(prev);
        for (const x of body.parcels) if (!next.has(x.externalParcelId)) next.set(x.externalParcelId, x);
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
    const sessionId = newScanSessionId();
    setScan((s) => ({
      ...s,
      scanning: true,
      stage: SCAN_STAGE_LABELS[0],
      progress: [...SCAN_STAGE_LABELS],
      error: null,
      candidates: [],
      families: [],
      sessionId,
      hiddenKeys: [],
      showAllAssemblies: true,
    }));
    setFind(null);
    setActiveKey(null);
    let stageIdx = 0;
    const stageTimer = setInterval(() => {
      stageIdx = Math.min(stageIdx + 1, SCAN_STAGE_LABELS.length - 1);
      setScan((s) => (s.scanning ? { ...s, stage: SCAN_STAGE_LABELS[stageIdx]! } : s));
    }, 2200);
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
      const body = await fetchApiJsonWithRetry<{
        bbox?: BBox;
        centres?: NominatedCentre[];
        valuedParcels?: ParcelData[];
        candidates?: ScanCandidate[];
        families?: ScanState["families"];
        messages?: string[];
        progress?: string[];
        parcelsConsidered?: number;
        parcelsEligible?: number;
        assembliesGenerated?: number;
        funnel?: { parcelsConsidered: number; parcelsEligible: number; assembliesGenerated: number; candidatesReturned: number };
        error?: string;
      }>("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bodyPayload) }, { retries: 1, delayMs: 3500 });
      // Merge scan parcels/valuations first so the map stays useful even if /api/parcels 502s.
      const valuedParcels = Array.isArray(body.valuedParcels) ? (body.valuedParcels as ParcelData[]) : [];
      const rankedCandidates = body.candidates ?? [];
      if (valuedParcels.length) {
        setParcels((prev) => {
          const next = new Map(prev);
          for (const p of valuedParcels) {
            const existing = next.get(p.externalParcelId);
            next.set(p.externalParcelId, existing ? { ...existing, valuation: p.valuation ?? existing.valuation } : p);
          }
          parcelsCountRef.current = next.size;
          return next;
        });
      }
      if (Array.isArray(body.centres)) setCentres(body.centres);

      const candidateLotIds = rankedCandidates.flatMap((c) => c.lotIds ?? []);
      const parcelsSufficient = scanReturnedSufficientParcels({ valuedParcels, candidateLotIds });
      // Block viewport-driven /api/parcels storms while Render recovers from the scan.
      parcelCooldownUntilRef.current = nowMs() + POST_SCAN_PARCEL_COOLDOWN_MS;

      if (body.bbox) {
        lastBBox.current = body.bbox;
        setFlyTo({
          lat: (body.bbox.south + body.bbox.north) / 2,
          lng: (body.bbox.west + body.bbox.east) / 2,
          bbox: body.bbox,
          zoom: 16,
          nonce: nowMs(),
        });
        if (postScanRefreshTimer.current) clearTimeout(postScanRefreshTimer.current);
        // Prefer scan-returned parcels — only schedule a delayed refresh when map data is incomplete.
        if (!parcelsSufficient) {
          const refreshBbox = body.bbox;
          postScanRefreshTimer.current = setTimeout(() => {
            // Only clear cooldown after the full delay has elapsed (not at 4s).
            parcelCooldownUntilRef.current = 0;
            void fetchParcels(refreshBbox, { soft: true });
          }, POST_SCAN_PARCEL_REFRESH_DELAY_MS);
        }
      }
      const next: ScanState = {
        scanning: false,
        stage: "Done",
        error: null,
        sessionId,
        candidates: body.candidates ?? [],
        families: body.families ?? [],
        messages: body.messages ?? [],
        progress: body.progress?.length ? body.progress : [...SCAN_STAGE_LABELS],
        parcelsConsidered: body.parcelsConsidered ?? 0,
        parcelsEligible: body.parcelsEligible ?? 0,
        assembliesGenerated: body.assembliesGenerated ?? 0,
        funnelSummary:
          (body.messages as string[] | undefined)?.find((m) => m.startsWith("Scan funnel:")) ??
          (body.funnel
            ? `Scan funnel: ${body.funnel.parcelsConsidered} considered → ${body.funnel.parcelsEligible} eligible → ${body.funnel.assembliesGenerated} assemblies → ${body.funnel.candidatesReturned} ranked`
            : null),
        hiddenKeys: [],
        showAllAssemblies: true,
        bbox: body.bbox ?? bbox,
      };
      setScan(next);
      setLoad((s) => ({ ...s, messages: [] }));
      persistClientState({ scanOverride: next, activeKey: null });
    } catch (err) {
      const msg =
        err instanceof ApiJsonError && isTransientHttpError(err)
          ? `${err.message} Scan may still complete if you retry in a moment.`
          : (err as Error).message;
      setScan((s) => ({ ...s, scanning: false, stage: "", error: msg }));
    } finally {
      clearInterval(stageTimer);
    }
  }

  const assemblyKey = assembly.join("|");
  const assemblyParcels = assembly.map((id) => parcels.get(id)).filter((p): p is ParcelData => !!p);
  const manualMetrics = useMemo(() => {
    if (assemblyParcels.length < 1) return null;
    const adj = buildAdjacency(assemblyParcels.map((p) => ({ id: p.externalParcelId, geometry: p.geometry })));
    const m = computeAssemblyMetrics(assemblyParcels.map(parcelToAnalysisLot), assumptions, adj);
    return { metrics: m, score: scoreAssembly(m, assumptions) };
    // assemblyParcels is derived from assemblyKey + parcels
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assemblyKey, assumptions, parcels]);

  const visibleScanCandidates = useMemo(() => {
    const hidden = new Set(scan.hiddenKeys);
    return scan.candidates.filter((c) => !hidden.has(c.key));
  }, [scan.candidates, scan.hiddenKeys]);

  const highlightIds = useMemo(() => {
    const key = hoverKey ?? activeKey;
    const fromFind = find?.candidates.find((c) => c.key === key)?.lotIds;
    if (fromFind) return fromFind;
    return scan.candidates.find((c) => c.key === key)?.lotIds ?? scan.families.find((f) => f.familyId === key)?.best.lotIds ?? [];
  }, [hoverKey, activeKey, find, scan.candidates, scan.families]);

  /** Soft outline of all visible scan assemblies when none is focused. */
  const scanAssemblyIds = useMemo(() => {
    if (assembly.length) return assembly;
    if (activeKey || hoverKey) return [];
    if (!scan.showAllAssemblies) return [];
    const ids = new Set<string>();
    for (const c of visibleScanCandidates) for (const id of c.lotIds) ids.add(id);
    return [...ids];
  }, [assembly, activeKey, hoverKey, scan.showAllAssemblies, visibleScanCandidates]);

  function defaultName(ids: string[]) {
    const ps = ids.map((id) => parcels.get(id)).filter(Boolean) as ParcelData[];
    const suburb = ps.find((p) => p.suburb)?.suburb ?? "NSW";
    const streets = ps.map((p) => p.address?.replace(/^[\d\-/A-Za-z]+\s+/, "").replace(/,.*$/, "")).filter(Boolean) as string[];
    const street = streets.sort((a, b) => streets.filter((s) => s === b).length - streets.filter((s) => s === a).length)[0];
    return `${suburb} – ${street ?? "Site"} Assembly`;
  }

  async function save(ids: string[], name?: string, scanCandidate?: ScanCandidate, familyId?: string | null) {
    setSaving(true);
    setFindError(null);
    const ps = ids
      .map((id) => {
        const base = parcels.get(id);
        if (!base) return null;
        const fromScan = scanCandidate?.lotValuations?.[id];
        const fromParcel = base.valuation;
        const src = fromScan ?? fromParcel;
        if (!src) return base;
        return {
          ...base,
          valuation: {
            mid: src.mid ?? null,
            low: src.low ?? null,
            high: src.high ?? null,
            status: ("source" in src ? src.source : fromParcel?.source) ?? "COMPARABLE_DERIVED",
            confidence: ("confidence" in src ? src.confidence : fromParcel?.confidence) ?? "UNKNOWN",
            source: ("source" in src ? src.source : fromParcel?.source) ?? "COMPARABLE_DERIVED",
            provider: ("provider" in src ? src.provider : fromParcel?.provider) ?? "NSW",
            method:
              ("provider" in src ? src.provider : fromParcel?.provider) === "DOMAIN"
                ? "priceEstimate"
                : "nsw_registered_comps_weighted",
            checkedAt: ("checkedAt" in src ? src.checkedAt : fromParcel?.checkedAt) ?? null,
            note: ("note" in src ? src.note : fromParcel?.note) ?? null,
            numberOfComps: ("numberOfComps" in src ? src.numberOfComps : fromParcel?.numberOfComps) ?? null,
            comps: ("comps" in src ? src.comps : fromParcel?.comps) ?? null,
            subjectLastSale: ("subjectLastSale" in src ? src.subjectLastSale : fromParcel?.subjectLastSale) ?? null,
            valuationLabel: ("valuationLabel" in src ? src.valuationLabel : fromParcel?.valuationLabel) ?? null,
          },
        } satisfies ParcelData;
      })
      .filter((p): p is ParcelData => !!p);
    if (!ps.length) {
      setSaving(false);
      return setFindError("Parcels for this assembly are not loaded — zoom to the site and retry Analyse");
    }

    const lotValuationDetails: NonNullable<OpportunityInputs["lotValuationDetails"]> = {};
    for (const p of ps) {
      if (!p.valuation) continue;
      lotValuationDetails[p.externalParcelId] = {
        mid: p.valuation.mid,
        low: p.valuation.low,
        high: p.valuation.high,
        confidence: p.valuation.confidence,
        source: p.valuation.source,
        provider: p.valuation.provider,
        numberOfComps: p.valuation.numberOfComps ?? null,
        valuationLabel: p.valuation.valuationLabel ?? null,
        subjectLastSale: p.valuation.subjectLastSale ?? null,
        comps: p.valuation.comps ?? undefined,
      };
    }

    let inputs: Partial<OpportunityInputs> | undefined;
    if (scanCandidate?.calculationSnapshot) {
      const snap = scanCandidate.calculationSnapshot;
      const view = mapViewRef.current;
      inputs = {
        fsrOverride: snap.modelledEffectiveFsr,
        fsrOverrideKind: snap.modelledEffectiveFsr != null ? "SCAN_MODELLED" : "NONE",
        fsrOverrideCertainty: snap.effectiveCertainty,
        heightOverrideM: snap.effectiveHeightM,
        lotValuationDetails,
        scanProvenance: {
          originType: "AREA_SCAN",
          scanSessionId: scan.sessionId ?? newScanSessionId(),
          assemblyFamilyId: familyId ?? null,
          assemblyKey: scanCandidate.key,
          scanRank: scanCandidate.rank,
          scanCalculatedAt: snap.calculatedAt,
          calculationVersion: snap.version || SCAN_CALCULATION_VERSION,
          scanCalculationSnapshot: snap as unknown as Record<string, unknown>,
          mapRestore: {
            lat: view.lat,
            lng: view.lng,
            zoom: view.zoom,
            query,
            scanQuery: query,
          },
        },
      };
    } else if (Object.keys(lotValuationDetails).length) {
      inputs = { lotValuationDetails };
    }

    persistClientState({ activeKey: scanCandidate?.key ?? activeKey });

    try {
      const body = await fetchApiJson<{ id: string }>("/api/opportunities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name?.trim() || defaultName(ids), parcels: ps, inputs }),
      });
      setSaving(false);
      router.push(`/opportunities/${body.id}`);
    } catch (err) {
      setSaving(false);
      setFindError((err as Error).message || "Could not save opportunity");
    }
  }

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setSaveName(assembly.length ? defaultName(assembly) : "");
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assemblyKey]);

  // Bootstrap from ?scan= once — never re-trigger when AppShell keeps MapWorkspace mounted across tabs.
  const bootstrappedScanQueryRef = useRef<string | null>(null);
  useEffect(() => {
    if (!initialScanQuery || initialScanQuery.length < 2) return;
    if (bootstrappedScanQueryRef.current === initialScanQuery) return;
    // Live or restored session already covers this query — keep state, do not start a duplicate scan.
    if (scan.scanning || scan.candidates.length > 0) {
      bootstrappedScanQueryRef.current = initialScanQuery;
      return;
    }
    if (restoredScan?.query && restoredScan.candidates.length && restoredScan.query.toLowerCase() === initialScanQuery.toLowerCase()) {
      bootstrappedScanQueryRef.current = initialScanQuery;
      return;
    }
    bootstrappedScanQueryRef.current = initialScanQuery;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setQuery(initialScanQuery);
      void scanThisArea(initialScanQuery);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialScanQuery]);

  const letters = "ABCDEFGH";
  const showZoomHint = load.zoom < MIN_PARCEL_ZOOM;
  const visibleFamilies = useMemo(() => {
    const hidden = new Set(scan.hiddenKeys);
    return scan.families.filter((f) => !hidden.has(f.best.key));
  }, [scan.families, scan.hiddenKeys]);

  return (
    <div className="flex h-full">
      <div className="relative min-w-0 flex-1">
        <LeafletMap
          parcels={parcelList}
          selectedId={selectedId}
          assemblyIds={scanAssemblyIds}
          highlightIds={highlightIds}
          neighbourIds={find && selectedId === find.startId && !highlightIds.length ? find.neighbours : []}
          zoneFill={zoneFill}
          zoningWms={zoningWms}
          flyTo={flyTo}
          initial={start}
          onParcelClick={onParcelClick}
          onBlankClick={onBlankMapClick}
          onViewportChange={onViewportChange}
          visible={mapVisible}
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
          <div className="pointer-events-auto flex flex-wrap items-center gap-1 rounded-[3px] border border-line bg-white p-1 shadow-sm">
            <Button size="sm" variant="accent" className="h-8" disabled={scan.scanning} onClick={() => scanThisArea()}>
              {scan.scanning ? scan.stage || "Scanning…" : "Scan this area"}
            </Button>
            {scan.scanning && (
              <span className="hidden max-w-[220px] truncate px-1 text-[10.5px] text-muted sm:inline" title={scan.stage}>
                {scan.stage}
              </span>
            )}
            {!!scan.candidates.length && (
              <>
                <Button size="sm" className="h-8" onClick={clearScanResults}>
                  Clear results
                </Button>
                <Button size="sm" className="h-8" onClick={clearAssembliesFromMap}>
                  Clear assemblies
                </Button>
                <Button size="sm" className="h-8" onClick={showAllAssemblies}>
                  Show all
                </Button>
              </>
            )}
            <Button size="sm" variant="ghost" className="h-8" onClick={resetMap}>
              Reset map
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
            <button className="mt-1 text-[11px] font-semibold uppercase underline" onClick={() => lastBBox.current && void fetchParcels(lastBBox.current, { soft: false })}>
              Retry
            </button>
          </div>
        )}
        <div className="absolute bottom-8 right-14 z-[1000] rounded-[3px] bg-white/90 px-2 py-1 text-[10.5px] text-muted shadow-sm">Click parcel to select · click again to deselect · Shift-click for assembly</div>
      </div>

      <aside className="flex w-[400px] shrink-0 flex-col overflow-y-auto border-l border-line bg-white">
        {assembly.length > 0 && manualMetrics && (
          <div className="border-b border-line bg-brand-soft/60 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-brand">Current assembly · {assembly.length} lots</h3>
              <button className="text-[11px] font-semibold uppercase tracking-wide text-muted hover:text-ink" onClick={clearSelection}>
                Clear selection
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

        {(selectedId || assembly.length > 0) && !(assembly.length > 0 && manualMetrics) && (
          <div className="border-b border-line px-4 py-2">
            <button className="text-[11px] font-semibold uppercase tracking-wide text-muted hover:text-ink" onClick={clearSelection}>
              Clear selection
            </button>
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
              onRetry={() => lastBBox.current && void fetchParcels(lastBBox.current, { soft: false })}
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

        {scan.scanning && (
          <div className="border-t border-line p-4" ref={candidatesRef}>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Scanning area</h3>
            <ol className="mt-3 space-y-1.5 text-[12px]">
              {SCAN_STAGE_LABELS.map((label) => {
                const current = scan.stage === label;
                const done = SCAN_STAGE_LABELS.indexOf(label as (typeof SCAN_STAGE_LABELS)[number]) < SCAN_STAGE_LABELS.indexOf(scan.stage as (typeof SCAN_STAGE_LABELS)[number]);
                return (
                  <li key={label} className={cx(current ? "font-semibold text-ink" : done ? "text-good" : "text-muted")}>
                    {done ? "✓ " : current ? "→ " : "· "}
                    {label}
                  </li>
                );
              })}
            </ol>
            <p className="mt-3 text-[11px] text-muted">Headroom figures stay hidden until property valuation finishes — no fake green numbers.</p>
          </div>
        )}

        {!!scan.candidates.length && (
          <div className="border-t border-line p-4" ref={candidatesRef}>
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Top opportunities in scan</h3>
              <div className="flex items-center gap-2">
                <button className="text-[10.5px] font-semibold uppercase text-muted hover:text-ink" onClick={clearScanResults}>
                  Clear results
                </button>
                <span className="text-[10.5px] text-muted">
                  {scan.parcelsEligible}/{scan.parcelsConsidered} eligible · {scan.assembliesGenerated} combos · top {scan.candidates.length}
                </span>
              </div>
            </div>
            <div className="mt-1 flex flex-wrap gap-2 text-[10.5px]">
              <Badge tone="neutral">Planning first · auto-value top assemblies</Badge>
              <Badge tone="neutral">Negative headroom kept</Badge>
              <button className="underline text-muted" onClick={showAllAssemblies}>
                Show all
              </button>
              <button className="underline text-muted" onClick={clearAssembliesFromMap}>
                Hide all
              </button>
            </div>
            {scan.funnelSummary && <p className="mt-1 text-[11px] font-medium text-ink">{scan.funnelSummary}</p>}
            {scan.messages.map((m) => (
              <p key={m} className="mt-1 text-[11px] text-amber-900">
                {m}
              </p>
            ))}
            <div className="mt-3 space-y-2">
              {scan.families.map((fam) => {
                const c = fam.best;
                const open = scanExpanded === fam.familyId;
                const hidden = scan.hiddenKeys.includes(c.key);
                return (
                  <div
                    key={fam.familyId}
                    onMouseEnter={() => setHoverKey(c.key)}
                    onMouseLeave={() => setHoverKey(null)}
                    onClick={() => {
                      const next = activeKey === c.key ? null : c.key;
                      setActiveKey(next);
                      persistClientState({ activeKey: next });
                    }}
                    className={cx(
                      "cursor-pointer rounded-[3px] border p-3 transition-colors",
                      hidden && "opacity-45",
                      activeKey === c.key ? "border-accent bg-orange-50/40" : "border-line hover:border-accent/60",
                    )}
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
                        <div className="mt-1 flex flex-wrap gap-1">
                          {c.effectiveCertainty === "REQUIRES_PLANNING_CONFIRMATION" ? (
                            <Badge tone="warn">Modelled planning control</Badge>
                          ) : (
                            <Badge tone="good">Live planning data</Badge>
                          )}
                          {c.financialRankingAvailable ? (
                            <Badge tone="good">Trusted values</Badge>
                          ) : (
                            <Badge tone="warn">Financial ranking pending property values</Badge>
                          )}
                          <Badge tone="estimate">Planning-led scan</Badge>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <ScoreBadge score={c.score.score} />
                        <button
                          type="button"
                          aria-label="Hide from map"
                          className="text-[14px] leading-none text-muted hover:text-ink"
                          onClick={(e) => {
                            e.stopPropagation();
                            hideAssembly(c.key);
                          }}
                        >
                          ×
                        </button>
                      </div>
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
                        <div className="text-[10px] uppercase text-muted">Existing mid</div>
                        {c.financialRankingAvailable ? money(c.existingValue, { compact: true }) : "—"}
                        {c.financialRankingAvailable && c.existingValueLow != null && c.existingValueHigh != null && (
                          <div className="text-[9.5px] font-sans text-muted">
                            L {money(c.existingValueLow, { compact: true })} · H {money(c.existingValueHigh, { compact: true })}
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="text-[10px] uppercase text-muted">Max payable</div>
                        {money(c.maxPayable, { compact: true })}
                      </div>
                      <div>
                        <div className="text-[10px] uppercase text-muted">Headroom mid</div>
                        {c.financialRankingAvailable ? (
                          <span className={cx("font-semibold", (c.headroom ?? 0) >= 0 ? "text-good" : "text-bad")}>{money(c.headroom, { compact: true })}</span>
                        ) : (
                          <span className="text-[10px] font-sans text-amber-800">Pending values</span>
                        )}
                        {c.financialRankingAvailable && c.headroomLow != null && c.headroomHigh != null && (
                          <div className="text-[9.5px] font-sans text-muted">
                            Low case {money(c.headroomHigh, { compact: true })} · High case {money(c.headroomLow, { compact: true })}
                          </div>
                        )}
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
                          void save(c.lotIds, undefined, c, fam.familyId);
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
                          setActiveKey(c.key);
                        }}
                      >
                        View on map
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          hideAssembly(c.key);
                        }}
                      >
                        Hide from map
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
                            <span className={cx("num", alt.financialRankingAvailable ? ((alt.headroom ?? 0) >= 0 ? "text-good" : "text-bad") : "text-muted")}>
                              {alt.financialRankingAvailable ? money(alt.headroom, { compact: true }) : "Pending"}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {!visibleFamilies.length && (
              <p className="mt-2 text-[12px] text-muted">All assemblies hidden from map. Use Show all to restore highlights.</p>
            )}
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
                            return (y.metrics.acquisitionHeadroom ?? -Infinity) - (x.metrics.acquisitionHeadroom ?? -Infinity);
                          case "profit":
                            return y.metrics.profit - x.metrics.profit;
                          case "moc":
                            return y.metrics.marginOnCost - x.metrics.marginOnCost;
                          case "owners":
                            return x.metrics.owners - y.metrics.owners || (y.metrics.acquisitionHeadroom ?? -Infinity) - (x.metrics.acquisitionHeadroom ?? -Infinity);
                          case "area":
                            return y.metrics.totalAreaSqm - x.metrics.totalAreaSqm;
                          default:
                            return y.score.score - x.score.score || (y.metrics.acquisitionHeadroom ?? -Infinity) - (x.metrics.acquisitionHeadroom ?? -Infinity);
                        }
                      })
                      .map((c, i, arr) => {
                        const bestHeadroom = Math.max(...arr.map((x) => x.metrics.acquisitionHeadroom ?? -Infinity));
                        const isBest = (c.metrics.acquisitionHeadroom ?? -Infinity) === bestHeadroom && bestHeadroom > 0;
                        const isLargest = c.metrics.lotCount === Math.max(...arr.map((x) => x.metrics.lotCount));
                        return (
                          <tr
                            key={c.key}
                            onMouseEnter={() => setHoverKey(c.key)}
                            onMouseLeave={() => setHoverKey(null)}
                            onClick={() => setActiveKey((k) => (k === c.key ? null : c.key))}
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
                                  void save(c.lotIds);
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
                  onClick={() => setActiveKey((k) => (k === c.key ? null : c.key))}
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
                        void save(c.lotIds);
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
