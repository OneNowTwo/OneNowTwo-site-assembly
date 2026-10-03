"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { OpportunityDTO } from "@/lib/opportunity-dto";
import { dtoToLots } from "@/lib/opportunity-dto";
import { analyseOpportunity } from "@/lib/analysis/opportunity";
import { mergeAssumptions, type Assumptions, type OpportunityInputs } from "@/lib/analysis/assumptions";
import { buildAdjacency } from "@/lib/analysis/geometry";
import { OPPORTUNITY_STATUSES, DISCLAIMER } from "@/lib/constants";
import { money, pct, sqm } from "@/lib/format";
import { Badge, DemoFinancialBadge, LiveDataBadge, ScoreBadge, Select, cx } from "@/components/ui";
import { Ctx, type LotPatch, type OpportunityCtx } from "./context";
import { OverviewTab } from "./overview-tab";
import { PlanningTab } from "./planning-tab";
import { YieldTab } from "./yield-tab";
import { FeasibilityTab } from "./feasibility-tab";
import { MarketTab } from "./market-tab";
import { AcquisitionTab } from "./acquisition-tab";

const TABS = ["overview", "planning", "yield", "feasibility", "market", "acquisition"] as const;
type Tab = (typeof TABS)[number];

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export function OpportunityView({ id, initialTab }: { id: string; initialTab?: string }) {
  const [dto, setDto] = useState<OpportunityDTO | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(TABS.includes(initialTab as Tab) ? (initialTab as Tab) : "overview");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [pendingInputs, setPendingInputs] = useState<OpportunityInputs | null>(null);

  const [autoValuing, setAutoValuing] = useState(false);
  const autoValueTriedRef = useRef(false);

  useEffect(() => {
    autoValueTriedRef.current = false;
    api<OpportunityDTO>(`/api/opportunities/${id}`).then(setDto, (e) => setLoadError(e.message));
  }, [id]);

  // If Analyse opens without lot values, automatically run NSW comps valuation once.
  useEffect(() => {
    if (!dto || autoValueTriedRef.current) return;
    const missing = dto.lots.some((l) => l.included && !(l.marketValue != null && l.marketValue > 0));
    if (!missing) return;
    autoValueTriedRef.current = true;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setAutoValuing(true);
    });
    api<OpportunityDTO>(`/api/opportunities/${id}/valuate`, { method: "POST" })
      .then((next) => {
        if (!cancelled) setDto(next);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setAutoValuing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dto, id]);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState(null, "", url);
  }, [tab]);

  const lotKey = dto ? dto.lots.map((l) => l.id).join("|") : "";
  const lotGeometries = useMemo(() => dto?.lots.map((l) => ({ id: l.id, geometry: l.geometry })) ?? [], [lotKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const adjacency = useMemo(() => (lotGeometries.length ? buildAdjacency(lotGeometries) : null), [lotGeometries]);
  const a: Assumptions | null = useMemo(() => (dto ? mergeAssumptions(dto.globalAssumptions, dto.inputs.overrides) : null), [dto]);
  const analysis = useMemo(() => (dto && a && adjacency ? analyseOpportunity(dtoToLots(dto), a, dto.inputs, adjacency) : null), [dto, a, adjacency]);

  const run = useCallback(async <T,>(fn: () => Promise<T>) => {
    setSaving(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message);
      return undefined;
    } finally {
      setSaving(false);
    }
  }, []);

  useEffect(() => {
    if (!pendingInputs) return;
    const t = setTimeout(() => {
      setPendingInputs(null);
      void run(async () => setDto(await api<OpportunityDTO>(`/api/opportunities/${id}`, { method: "PATCH", body: JSON.stringify({ inputs: pendingInputs }) })));
    }, 500);
    return () => clearTimeout(t);
  }, [pendingInputs, id, run]);

  const updateInputs = useCallback(
    (patch: Partial<OpportunityInputs>) => {
      if (!dto) return;
      const inputs = { ...dto.inputs, ...patch };
      setDto({ ...dto, inputs });
      setPendingInputs(inputs);
    },
    [dto],
  );

  const ctx: OpportunityCtx | null =
    dto && analysis && a
      ? {
          dto,
          analysis,
          a,
          saving,
          error,
          updateInputs,
          updateOverrides: (patch) => {
            const overrides = { ...dto.inputs.overrides } as Record<string, unknown>;
            for (const [k, v] of Object.entries(patch)) {
              if (v === undefined || v === null) delete overrides[k];
              else overrides[k] = v;
            }
            updateInputs({ overrides: overrides as OpportunityInputs["overrides"] });
          },
          updateLot: async (lotId: string, patch: LotPatch) => {
            setDto((d) =>
              d
                ? {
                    ...d,
                    lots: d.lots.map((l) => {
                      if (l.id !== lotId) return l;
                      const { owner, planning, ...rest } = patch;
                      return {
                        ...l,
                        ...rest,
                        ...(planning ?? {}),
                        owner: owner ? { name: null, ownerType: null, phone: null, email: null, mailingAddress: null, notes: null, ...l.owner, ...owner } : l.owner,
                      };
                    }),
                  }
                : d,
            );
            await run(async () => setDto(await api<OpportunityDTO>(`/api/opportunities/${id}/lots/${lotId}`, { method: "PATCH", body: JSON.stringify(patch) })));
          },
          updateOpportunity: async (patch) => {
            setDto((d) => (d ? { ...d, ...patch } : d));
            await run(async () => setDto(await api<OpportunityDTO>(`/api/opportunities/${id}`, { method: "PATCH", body: JSON.stringify(patch) })));
          },
          addActivity: async (lotId, body) => {
            await run(async () => {
              await api(`/api/opportunities/${id}/lots/${lotId}/activities`, { method: "POST", body: JSON.stringify(body) });
              setDto(await api<OpportunityDTO>(`/api/opportunities/${id}`));
            });
          },
          refreshPlanning: async () => {
            setSaving(true);
            try {
              setDto(await api<OpportunityDTO>(`/api/opportunities/${id}/planning`, { method: "POST" }));
              return { ok: true };
            } catch (e) {
              return { ok: false, message: (e as Error).message };
            } finally {
              setSaving(false);
            }
          },
          refresh: async () => {
            setDto(await api<OpportunityDTO>(`/api/opportunities/${id}`));
          },
          setDto,
        }
      : null;

  if (loadError) return <div className="p-8 text-bad">{loadError}</div>;
  if (!ctx || !dto || !analysis) return <div className="p-8 text-muted">Loading opportunity…</div>;

  const f = analysis.base.feasibility;
  const cached = dto.lots.some((l) => l.source === "CACHED_NSW");
  const scanProv = dto.inputs.scanProvenance;
  const scanSnap = (scanProv?.scanCalculationSnapshot ?? null) as
    | {
        existingValue?: number;
        maxPayable?: number;
        headroom?: number;
        modelledEffectiveFsr?: number | null;
        grv?: number;
        achievableGfa?: number;
      }
    | null;
  const backToScanHref = (() => {
    if (!scanProv?.mapRestore) return "/map";
    const m = scanProv.mapRestore;
    const params = new URLSearchParams();
    params.set("lat", String(m.lat));
    params.set("lng", String(m.lng));
    params.set("zoom", String(m.zoom));
    const q = m.scanQuery || m.query;
    if (q) params.set("scan", q);
    return `/map?${params.toString()}`;
  })();
  const showScanDelta =
    !!scanSnap &&
    typeof scanSnap.maxPayable === "number" &&
    Math.abs((scanSnap.maxPayable ?? 0) - analysis.maxPayableToOwners) > 1;

  return (
    <Ctx.Provider value={ctx}>
      <div className="flex h-full flex-col overflow-hidden">
        <div className="shrink-0 border-b border-line bg-white px-6 pt-4">
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] text-muted">
                {scanProv?.originType === "AREA_SCAN" ? (
                  <Link href={backToScanHref} className="font-semibold text-brand hover:underline">
                    ← Back to scan results
                  </Link>
                ) : (
                  <Link href="/opportunities" className="hover:underline">
                    Opportunities
                  </Link>
                )}
                <span>/</span>
                <span>{dto.suburb ?? "NSW"}</span>
                <span className="ml-2 flex gap-1.5">
                  <LiveDataBadge cached={cached} />
                  {dto.demoFinancialData && <DemoFinancialBadge />}
                  {dto.inputs.fsrOverrideKind === "SCAN_MODELLED" && <Badge tone="warn">Modelled FSR from scan</Badge>}
                  {scanProv?.originType === "AREA_SCAN" && <Badge tone="estimate">From area scan</Badge>}
                </span>
              </div>
              {editingName ? (
                <input
                  autoFocus
                  defaultValue={dto.name}
                  onBlur={(e) => {
                    setEditingName(false);
                    if (e.target.value.trim() && e.target.value !== dto.name) void ctx.updateOpportunity({ name: e.target.value.trim() });
                  }}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  className="mt-1 w-[520px] rounded-[3px] border border-brand px-1 text-[21px] font-semibold outline-none"
                  aria-label="Opportunity name"
                />
              ) : (
                <h1 className="mt-1 cursor-text text-[21px] font-semibold leading-tight hover:text-brand" title="Click to rename" onClick={() => setEditingName(true)}>
                  {dto.name}
                </h1>
              )}
              <div className="mt-1 flex items-center gap-3 text-[12px] text-muted">
                <span>
                  {analysis.includedIds.length} lots{analysis.excludedIds.length ? ` (+${analysis.excludedIds.length} excluded)` : ""}
                </span>
                <span>·</span>
                <span className="num">{sqm(analysis.site.siteAreaSqm)}</span>
                <span>·</span>
                <span>{dto.lga ?? ""}</span>
                <Select ariaLabel="Opportunity status" value={dto.status} onChange={(status) => ctx.updateOpportunity({ status })} options={OPPORTUNITY_STATUSES.map((s) => ({ value: s, label: s[0] + s.slice(1).toLowerCase() }))} className="h-7 text-[11.5px]" />
                {(saving || autoValuing) && <span className="text-[11px]">{autoValuing ? "Valuing properties from NSW sales…" : "Saving…"}</span>}
                {error && <Badge tone="bad">{error}</Badge>}
              </div>
            </div>
            <div className="flex shrink-0 items-end gap-6 pb-1">
              <div className="text-right">
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">Score</div>
                <div className="mt-1">
                  <ScoreBadge score={analysis.score.score} />
                </div>
              </div>
              <HeaderStat
                label="Existing value"
                value={analysis.marketValueComplete ? money(analysis.combinedExistingValue, { compact: true }) : autoValuing ? "…" : "—"}
                sub={analysis.marketValueComplete ? undefined : autoValuing ? "Fetching NSW comps" : "VALUE REQUIRED"}
              />
              <HeaderStat label="Max payable to owners" value={money(analysis.maxPayableToOwners, { compact: true })} tone={analysis.maxPayableToOwners > 0 ? "brand" : "bad"} large />
              <HeaderStat
                label="Acquisition headroom"
                value={analysis.marketValueComplete ? money(analysis.acquisitionHeadroom, { compact: true }) : "—"}
                tone={analysis.marketValueComplete ? ((analysis.acquisitionHeadroom ?? 0) > 0 ? "good" : "bad") : undefined}
                sub={analysis.marketValueComplete ? pct(analysis.acquisitionHeadroomPercent, 0, true) : autoValuing ? "Waiting for values" : "Auto-value pending"}
                large
              />
              <HeaderStat label="GRV" value={money(f.grv, { compact: true })} />
            </div>
          </div>
          {scanSnap && (
            <div className="mt-3 rounded-[3px] border border-line bg-canvas px-3 py-2 text-[12px]">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">Scan estimate vs detailed analysis</div>
              <div className="mt-1 grid grid-cols-2 gap-x-6 gap-y-1 num sm:grid-cols-4">
                <div>
                  <span className="text-muted">Scan max payable </span>
                  {money(scanSnap.maxPayable, { compact: true })}
                </div>
                <div>
                  <span className="text-muted">Detailed max payable </span>
                  {money(analysis.maxPayableToOwners, { compact: true })}
                </div>
                <div>
                  <span className="text-muted">Scan headroom </span>
                  {money(scanSnap.headroom, { compact: true })}
                </div>
                <div>
                  <span className="text-muted">Detailed headroom </span>
                  {money(analysis.acquisitionHeadroom, { compact: true })}
                </div>
              </div>
              {dto.inputs.fsrOverride != null && (
                <div className="mt-1 text-[11px] text-muted">
                  Persisted scan FSR {dto.inputs.fsrOverride.toFixed(2)}:1
                  {dto.inputs.fsrOverrideCertainty ? ` · ${dto.inputs.fsrOverrideCertainty.replaceAll("_", " ")}` : ""}
                  {typeof scanSnap.modelledEffectiveFsr === "number" ? ` · scan modelled ${scanSnap.modelledEffectiveFsr.toFixed(2)}:1` : ""}
                </div>
              )}
              {showScanDelta && (
                <div className="mt-1 text-[11px] text-amber-900">
                  Detailed analysis differs from the scan estimate — changes are shown explicitly above (not silently zeroed).
                </div>
              )}
            </div>
          )}
          <nav className="mt-3 flex gap-1">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cx("border-b-2 px-3 pb-2 pt-1 text-[11.5px] font-semibold uppercase tracking-[0.1em]", tab === t ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink")}
              >
                {t === "market" ? "comparables" : t}
              </button>
            ))}
          </nav>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto bg-canvas p-6">
          {tab === "overview" && <OverviewTab />}
          {tab === "planning" && <PlanningTab />}
          {tab === "yield" && <YieldTab />}
          {tab === "feasibility" && <FeasibilityTab />}
          {tab === "market" && <MarketTab />}
          {tab === "acquisition" && <AcquisitionTab />}
          {tab !== "planning" && <p className="mt-6 text-[11px] text-muted">{DISCLAIMER}</p>}
        </div>
      </div>
    </Ctx.Provider>
  );
}

function HeaderStat({ label, value, tone, sub, large }: { label: string; value: string; tone?: "brand" | "bad" | "good"; sub?: string; large?: boolean }) {
  return (
    <div className="text-right">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">{label}</div>
      <div className={cx("num font-semibold leading-tight", large ? "text-[26px]" : "text-[20px]", tone === "brand" && "text-brand", tone === "bad" && "text-bad", tone === "good" && "text-good")}>{value}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  );
}
