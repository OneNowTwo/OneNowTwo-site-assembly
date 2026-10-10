"use client";

import { useEffect, useMemo, useState } from "react";
import { useOpportunity } from "./context";
import { Badge, Button, Panel } from "@/components/ui";
import { fsr as fmtFsr, money } from "@/lib/format";
import { buildAdjacency } from "@/lib/analysis/geometry";
import { dtoToLots } from "@/lib/opportunity-dto";
import { modelProposedScenario, type ProposedScenarioResult } from "@/lib/source-watcher/proposed-scenario";

interface ProposedApi {
  legalDisclaimer: string;
  dataSource?: "persisted" | "fixture_fallback";
  structuredDataStatus?: string | null;
  planningChangeAreas: Array<{
    id: string;
    title: string;
    status: string;
    sourceUrl?: string | null;
    exhibitionEnd?: string | null;
    proposedControls: {
      zone?: string | null;
      fsr?: number | null;
      incentiveFsr?: number | null;
      heightM?: number | null;
      incentiveHeightM?: number | null;
      affordableHousingContributionPct?: number | null;
      activeStreetFrontage?: boolean | null;
      legalStatus?: string;
      structuredDataStatus?: string;
    };
  }>;
  keySites: Array<{
    planningChangeAreaId: string;
    planningChangeAreaTitle: string;
    status: string;
    legalStatus: string;
    requiredCount: number;
    yourPropertyIndex: number | null;
    requiredParcelIds?: string[];
    requiredAddresses?: string[];
    keySite: {
      externalKeySiteId: string;
      name: string;
      requiredParcelHints?: string[];
      requiredParcelIds?: string[];
      proposedControls?: {
        zone?: string | null;
        fsr?: number | null;
        heightM?: number | null;
        nonResidentialFsr?: number | null;
        activeStreetFrontage?: boolean | null;
      } | null;
      incentiveControls?: {
        incentiveFsr?: number | null;
        incentiveHeightM?: number | null;
        affordableHousingContributionPct?: number | null;
      } | null;
      structuredConditions?: Array<{ type: string; value?: string | null; description?: string | null }>;
      conditions?: string[];
    };
  }>;
  liveInnerWest?: {
    zone: string | null;
    fsr: number | null;
    heightM: number | null;
    incentiveFsr: number | null;
    incentiveHeightM: number | null;
    affordableHousingLabel: string | null;
    keySiteId: string | null;
    source: string;
  } | null;
}

function siteCentroid(dto: { lots: Array<{ centroid: [number, number] }> }) {
  const c = dto.lots[0]?.centroid;
  if (!c) return null;
  return { lng: c[0], lat: c[1] };
}

/** PROPOSED / PENDING planning — separate from CURRENT PlanningSnapshot. */
export function ProposedPlanningPanel() {
  const { dto, analysis, a } = useOpportunity();
  const [data, setData] = useState<ProposedApi | null>(null);
  const [loading, setLoading] = useState(false);
  const [scenario, setScenario] = useState<ProposedScenarioResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assemblyBusy, setAssemblyBusy] = useState(false);
  const [assemblyMsg, setAssemblyMsg] = useState<string | null>(null);

  const centroid = useMemo(() => siteCentroid(dto), [dto]);

  useEffect(() => {
    if (!centroid) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetch(`/api/planning/proposed?lng=${centroid.lng}&lat=${centroid.lat}`)
      .then(async (r) => {
        if (!r.ok) throw new Error("Proposed planning lookup failed");
        return r.json() as Promise<ProposedApi>;
      })
      .then((j) => {
        if (!cancelled) setData(j);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [centroid?.lng, centroid?.lat]);

  const area = data?.planningChangeAreas[0];
  const ks = data?.keySites[0];
  const live = data?.liveInnerWest;
  const hasProposed = Boolean(area || ks || (live && (live.fsr != null || live.zone || live.incentiveFsr != null)));

  const proposedFsr =
    ks?.keySite.incentiveControls?.incentiveFsr ??
    ks?.keySite.proposedControls?.fsr ??
    live?.incentiveFsr ??
    live?.fsr ??
    area?.proposedControls.incentiveFsr ??
    area?.proposedControls.fsr ??
    null;
  const proposedHeight =
    ks?.keySite.incentiveControls?.incentiveHeightM ??
    ks?.keySite.proposedControls?.heightM ??
    live?.incentiveHeightM ??
    live?.heightM ??
    area?.proposedControls.incentiveHeightM ??
    area?.proposedControls.heightM ??
    null;
  const proposedZone =
    ks?.keySite.proposedControls?.zone ?? live?.zone ?? area?.proposedControls.zone ?? null;

  const runScenario = () => {
    if (proposedFsr == null) return;
    const lots = dtoToLots(dto);
    const adjacency = buildAdjacency(lots);
    const result = modelProposedScenario({
      lots,
      assumptions: a,
      opportunityInputs: dto.inputs,
      adjacency,
      currentAnalysis: analysis,
      proposed: {
        proposedFsr,
        proposedHeightM: proposedHeight,
        label: area?.title ?? "Proposed planning scenario",
        source: area?.sourceUrl ?? live?.source ?? "Source Watcher",
      },
    });
    setScenario(result);
  };

  if (!centroid) return null;
  if (loading) {
    return (
      <Panel title="Proposed / pending planning">
        <p className="text-[12px] text-muted">Checking Source Watcher proposed layers…</p>
      </Panel>
    );
  }
  if (error) {
    return (
      <Panel title="Proposed / pending planning">
        <p className="text-[12px] text-amber-900">{error}</p>
      </Panel>
    );
  }
  if (!hasProposed) {
    return (
      <Panel title="Proposed / pending planning">
        <p className="text-[12px] text-muted">No proposed planning change area or key site at this location.</p>
      </Panel>
    );
  }

  const ah =
    ks?.keySite.incentiveControls?.affordableHousingContributionPct ??
    area?.proposedControls.affordableHousingContributionPct ??
    null;

  return (
    <Panel
      title="Proposed / pending planning"
      actions={<Badge tone="warn">{ks?.legalStatus ?? area?.status ?? "PROPOSED"}</Badge>}
    >
      <p className="mb-3 text-[11px] text-amber-900">
        {data?.legalDisclaimer ?? "PROPOSED only — not current LEP law. CURRENT PlanningSnapshot unchanged."}
        {data?.dataSource === "fixture_fallback" && " · Showing fixture fallback (no persisted Source Watcher rows yet)."}
        {data?.structuredDataStatus === "NEEDS_RE_EXTRACTION" &&
          " · Structured map-pack data NEEDS RE-EXTRACTION after official document change."}
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <dl className="space-y-1.5 text-[12px]">
          <div className="font-semibold text-[13px]">{area?.title ?? "Inner West draft controls"}</div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted">Proposed zone</dt>
            <dd className="font-medium">{proposedZone ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted">Proposed incentive FSR</dt>
            <dd className="num font-medium">{proposedFsr != null ? fmtFsr(proposedFsr) : "—"}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted">Proposed height</dt>
            <dd className="num font-medium">{proposedHeight != null ? `${proposedHeight} m` : "—"}</dd>
          </div>
          {ah != null && (
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Affordable housing</dt>
              <dd className="num font-medium">{`${Math.round(ah * 100)}%`}</dd>
            </div>
          )}
          {live?.affordableHousingLabel && (
            <div className="flex justify-between gap-2">
              <dt className="text-muted">AH contribution area</dt>
              <dd className="font-medium">{live.affordableHousingLabel}</dd>
            </div>
          )}
          {(ks?.keySite.proposedControls?.activeStreetFrontage || area?.proposedControls.activeStreetFrontage) && (
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Active street frontage</dt>
              <dd className="font-medium">Yes</dd>
            </div>
          )}
          <div className="flex justify-between gap-2">
            <dt className="text-muted">Source</dt>
            <dd className="font-medium">{area?.sourceUrl ? "NSW Planning Portal / council ArcGIS" : "Source Watcher"}</dd>
          </div>
        </dl>

        {ks && (
          <div className="space-y-2 text-[12px]">
            <div className="font-semibold text-[13px]">Key site {ks.keySite.externalKeySiteId}</div>
            <p className="text-muted">{ks.keySite.name}</p>
            <p>
              Your parcel: {ks.yourPropertyIndex != null ? `${ks.yourPropertyIndex} of ${ks.requiredCount}` : "—"} required
              parcels
            </p>
            <div>
              <div className="mb-1 text-[10.5px] uppercase tracking-wide text-muted">Required assembly</div>
              <ul className="list-inside list-disc space-y-0.5">
                {(ks.requiredAddresses?.length
                  ? ks.requiredAddresses
                  : ks.keySite.requiredParcelHints ?? []
                ).map((h, i) => (
                  <li key={`${h}-${i}`}>
                    {h}
                    {ks.requiredParcelIds?.[i] ? (
                      <span className="ml-1 text-[10.5px] text-muted">({ks.requiredParcelIds[i]})</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
            {(ks.keySite.structuredConditions?.length || ks.keySite.conditions?.length) && (
              <div>
                <div className="mb-1 text-[10.5px] uppercase tracking-wide text-muted">Other conditions</div>
                <ul className="list-inside list-disc space-y-0.5">
                  {(ks.keySite.structuredConditions ?? []).map((c, i) => (
                    <li key={`${c.type}-${i}`}>
                      {c.type}
                      {c.value ? `: ${c.value}` : ""}
                      {c.description ? ` — ${c.description}` : ""}
                    </li>
                  ))}
                  {!ks.keySite.structuredConditions?.length &&
                    (ks.keySite.conditions ?? []).map((c) => <li key={c}>{c}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {area?.sourceUrl && (
          <Button size="sm" variant="ghost" onClick={() => window.open(area.sourceUrl!, "_blank", "noopener")}>
            View source
          </Button>
        )}
        {proposedFsr != null && (
          <Button size="sm" variant="primary" onClick={runScenario}>
            Model proposed scenario
          </Button>
        )}
        {ks && (
          <Button
            size="sm"
            variant="ghost"
            disabled={assemblyBusy}
            onClick={async () => {
              setAssemblyBusy(true);
              setAssemblyMsg(null);
              try {
                const parcelIds =
                  ks.requiredParcelIds?.filter((id) => /^nsw-cadid:\d+$/.test(id)) ??
                  ks.keySite.requiredParcelIds?.filter((id) => /^nsw-cadid:\d+$/.test(id)) ??
                  [];
                const res = await fetch("/api/planning/analyse-assembly", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    planningChangeAreaId: ks.planningChangeAreaId,
                    keySiteId: ks.keySite.externalKeySiteId,
                    parcelIds: parcelIds.length ? parcelIds : undefined,
                    name: `Key site ${ks.keySite.externalKeySiteId} — required assembly`,
                  }),
                });
                const j = (await res.json()) as { id?: string; href?: string; error?: string; parcelCount?: number };
                if (!res.ok) throw new Error(j.error ?? "Analyse assembly failed");
                setAssemblyMsg(`Created assembly opportunity (${j.parcelCount ?? "?"} lots).`);
                if (j.href) window.open(j.href, "_blank", "noopener");
              } catch (e) {
                setAssemblyMsg(e instanceof Error ? e.message : String(e));
              } finally {
                setAssemblyBusy(false);
              }
            }}
          >
            {assemblyBusy ? "Creating…" : "Analyse required assembly"}
          </Button>
        )}
      </div>
      {assemblyMsg && <p className="mt-2 text-[11px] text-muted">{assemblyMsg}</p>}

      {scenario && (
        <div className="mt-4 grid gap-3 border-t border-line pt-3 md:grid-cols-3 text-[12px]">
          <div>
            <div className="text-[10.5px] uppercase tracking-wide text-muted">Current</div>
            <div className="font-medium">FSR {scenario.current.effectiveFsr != null ? fmtFsr(scenario.current.effectiveFsr) : "—"}</div>
            <div className="num">GFA {Math.round(scenario.currentOutputs.theoreticalGfa)} m² · {scenario.currentOutputs.dwellings} dw</div>
            <div className="num">GRV {money(scenario.currentOutputs.grv)}</div>
            <div className="num">Cost {money(scenario.currentOutputs.totalCost)}</div>
            <div className="num">Max payable {money(scenario.current.maxPayable)}</div>
            <div className="num">Score {scenario.currentOutputs.score}</div>
          </div>
          <div>
            <div className="text-[10.5px] uppercase tracking-wide text-muted">Proposed scenario</div>
            <div className="font-medium">FSR {fmtFsr(scenario.proposedFsr)}</div>
            <div className="num">GFA {Math.round(scenario.proposedOutputs.theoreticalGfa)} m² · {scenario.proposedOutputs.dwellings} dw</div>
            <div className="num">GRV {money(scenario.proposedOutputs.grv)}</div>
            <div className="num">Cost {money(scenario.proposedOutputs.totalCost)}</div>
            <div className="num">Max payable {money(scenario.proposed.maxPayable)}</div>
            <div className="num">Score {scenario.proposedOutputs.score}</div>
          </div>
          <div>
            <div className="text-[10.5px] uppercase tracking-wide text-muted">Uplift</div>
            <div className="font-medium num text-good">
              {scenario.uplift.maxPayable >= 0 ? "+" : ""}
              {money(scenario.uplift.maxPayable)}
            </div>
            <div className="text-[11px] text-muted">
              FSR Δ {scenario.uplift.fsr.toFixed(2)} · GRV Δ {money(scenario.uplift.grv)} · GFA Δ{" "}
              {Math.round(scenario.uplift.theoreticalGfa)} m²
            </div>
          </div>
          <p className="md:col-span-3 text-[11px] text-amber-900">{scenario.disclaimer}</p>
        </div>
      )}
    </Panel>
  );
}
