"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOpportunity } from "./context";
import { LotsMap } from "./lots-map";
import { Badge, Button, Panel, cx } from "@/components/ui";
import { fsr, money, num, pct, sqm } from "@/lib/format";
import { modelProposedScenario, type ProposedScenarioResult } from "@/lib/source-watcher/proposed-scenario";
import { buildAdjacency } from "@/lib/analysis/geometry";
import { dtoToLots } from "@/lib/opportunity-dto";
import { summariseRegisteredSalesEvidence } from "@/lib/analysis/registered-sales-evidence";
import { whyFinancialHeadroom, whyKeySite, whyNearbyActivity, whyProposedFsrUplift } from "@/lib/source-watcher/why-it-matters";
import type { DevelopmentActivity } from "@/lib/source-watcher/development-activity";
import { WatchOpportunityButton } from "./watch-opportunity-button";

interface ProposedApi {
  applies: boolean;
  planningChangeAreas: Array<{
    id: string;
    title: string;
    status: string;
    sourceUrl?: string | null;
    proposedControls: {
      zone?: string | null;
      fsr?: number | null;
      incentiveFsr?: number | null;
      heightM?: number | null;
      incentiveHeightM?: number | null;
      affordableHousingContributionPct?: number | null;
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
      proposedControls?: { zone?: string | null; fsr?: number | null; heightM?: number | null } | null;
      incentiveControls?: {
        incentiveFsr?: number | null;
        incentiveHeightM?: number | null;
        affordableHousingContributionPct?: number | null;
      } | null;
      structuredConditions?: Array<{ type: string; value?: string | null; description?: string | null }>;
      conditions?: string[];
    };
  }>;
}

interface IntelEvent {
  id: string;
  kind: string;
  title: string;
  summary: string | null;
  createdAt: string;
  href: string | null;
}

export function SiteIntelligence() {
  const { dto, analysis, a, setTab } = useOpportunity();
  const router = useRouter();
  const [proposed, setProposed] = useState<ProposedApi | null>(null);
  const [scenarioMode, setScenarioMode] = useState<"CURRENT" | "PROPOSED">("CURRENT");
  const [scenario, setScenario] = useState<ProposedScenarioResult | null>(null);
  const [activity, setActivity] = useState<DevelopmentActivity[]>([]);
  const [daStatus, setDaStatus] = useState<string | null>(null);
  const [daConnected, setDaConnected] = useState<boolean | null>(null);
  const [intel, setIntel] = useState<IntelEvent[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [assemblyBusy, setAssemblyBusy] = useState(false);
  const [assemblyError, setAssemblyError] = useState<string | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  const centroid = useMemo(() => {
    const c = dto.lots[0]?.centroid;
    return c ? { lng: c[0], lat: c[1] } : null;
  }, [dto.lots]);

  useEffect(() => {
    if (!centroid) return;
    let cancelled = false;
    void fetch(`/api/planning/proposed?lng=${centroid.lng}&lat=${centroid.lat}`)
      .then((r) => r.json())
      .then((j: ProposedApi) => {
        if (!cancelled) setProposed(j);
      })
      .catch(() => {
        if (!cancelled) setProposed(null);
      });
    void fetch(`/api/development-activity?lng=${centroid.lng}&lat=${centroid.lat}&radiusM=500`)
      .then((r) => r.json())
      .then(
        (j: {
          activities?: DevelopmentActivity[];
          daStatus?: string;
          daConnected?: boolean;
        }) => {
          if (cancelled) return;
          setActivity(j.activities ?? []);
          setDaStatus(j.daStatus ?? null);
          setDaConnected(j.daConnected ?? null);
        },
      )
      .catch(() => {
        if (!cancelled) {
          setActivity([]);
          setDaStatus(null);
          setDaConnected(null);
        }
      });
    void fetch(`/api/intel/site?lng=${centroid.lng}&lat=${centroid.lat}`)
      .then((r) => r.json())
      .then((j: { events?: IntelEvent[] }) => {
        if (!cancelled) setIntel(j.events ?? []);
      })
      .catch(() => {
        if (!cancelled) setIntel([]);
      });
    return () => {
      cancelled = true;
    };
  }, [centroid]);

  const area = proposed?.planningChangeAreas[0] ?? null;
  const keyHit = proposed?.keySites[0] ?? null;
  const currentFsr = analysis.site.fsr;
  const currentZone =
    analysis.planningSnapshot.currentStatutoryControls.zone ??
    analysis.planningSnapshot.effectiveControls.baseZone ??
    dto.lots.find((l) => l.included)?.zone ??
    null;
  const proposedFsr =
    keyHit?.keySite.incentiveControls?.incentiveFsr ??
    keyHit?.keySite.proposedControls?.fsr ??
    area?.proposedControls.incentiveFsr ??
    area?.proposedControls.fsr ??
    null;
  const currentHeight = analysis.site.heightLimitM;
  const proposedHeight =
    keyHit?.keySite.incentiveControls?.incentiveHeightM ??
    keyHit?.keySite.proposedControls?.heightM ??
    area?.proposedControls.incentiveHeightM ??
    area?.proposedControls.heightM ??
    null;

  useEffect(() => {
    if (scenarioMode !== "PROPOSED" || proposedFsr == null) {
      setScenario(null);
      return;
    }
    try {
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
          label: area?.title ?? "Proposed scenario",
          source: area?.sourceUrl ?? "Source Watcher",
        },
      });
      setScenario(result);
    } catch {
      setScenario(null);
    }
  }, [scenarioMode, proposedFsr, proposedHeight, dto, a, analysis, area?.title, area?.sourceUrl]);

  const planningOk = analysis.feasibilityCalculable || scenarioMode === "PROPOSED";
  const dwellings =
    scenarioMode === "PROPOSED" && scenario ? scenario.proposedOutputs.dwellings : analysis.base.yield.dwellings;
  const grv = scenarioMode === "PROPOSED" && scenario ? scenario.proposedOutputs.grv : analysis.base.feasibility.grv;
  const nonLand =
    scenarioMode === "PROPOSED" && scenario
      ? scenario.proposed.totalCost - (scenario.proposed.maxPayable ?? 0)
      : analysis.base.feasibility.nonLandCosts;
  const moc = analysis.base.feasibility.marginOnCost;
  const headroom =
    scenarioMode === "PROPOSED" && scenario ? scenario.proposedOutputs.headroom : analysis.acquisitionHeadroom;
  const maxPay =
    scenarioMode === "PROPOSED" && scenario ? scenario.proposedOutputs.maxPayable : analysis.maxPayableToOwners;
  const existing = analysis.combinedExistingValue;

  const registered = useMemo(
    () =>
      summariseRegisteredSalesEvidence(dto.inputs.lotValuationDetails, dto.lots, {
        demoFinancialData: dto.demoFinancialData,
        combinedExistingValue: analysis.combinedExistingValue,
      }),
    [dto.inputs.lotValuationDetails, dto.lots, dto.demoFinancialData, analysis.combinedExistingValue],
  );

  const officialLepFsr = analysis.planningSnapshot.effectiveControls.baseFsr;
  // One Effective FSR truth — never fall back to site.fsr (0 when planning missing).
  const effectiveFsr = analysis.planningSnapshot.effectiveControls.effectiveFsr ?? analysis.calculation.effectiveFsr;

  const whyItems = [
    whyProposedFsrUplift({ currentFsr, proposedFsr, siteAreaSqm: analysis.site.siteAreaSqm }),
    keyHit
      ? whyKeySite({
          planningChangeAreaId: keyHit.planningChangeAreaId,
          planningChangeAreaTitle: keyHit.planningChangeAreaTitle,
          status: keyHit.status,
          legalStatus: keyHit.legalStatus,
          keySite: keyHit.keySite as never,
          yourPropertyIndex: keyHit.yourPropertyIndex,
          requiredCount: keyHit.requiredCount,
          requiredParcelIds: keyHit.requiredParcelIds,
          requiredAddresses: keyHit.requiredAddresses,
        })
      : null,
    whyFinancialHeadroom(analysis.acquisitionHeadroom),
    ...activity.slice(0, 2).map(whyNearbyActivity),
  ].filter(Boolean);

  const dash = (value: React.ReactNode, reason: string): React.ReactNode =>
    value === "—" || value == null || value === "" ? (
      <span title={reason}>
        —<span className="sr-only"> ({reason})</span>
      </span>
    ) : (
      value
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Decision overview</div>
          <h2 className="text-[18px] font-semibold tracking-tight">What is the site worth pursuing?</h2>
        </div>
        <WatchOpportunityButton />
      </div>

      <div className="grid grid-cols-3 gap-3 rounded-[3px] border border-line bg-white p-3 sm:grid-cols-5 lg:grid-cols-9">
        <MiniStat label="Score" value={`${analysis.score.score}`} />
        <MiniStat label="Site area" value={sqm(analysis.site.siteAreaSqm)} />
        <MiniStat
          label="Effective FSR"
          value={dash(
            planningOk && effectiveFsr != null && effectiveFsr > 0 ? fsr(effectiveFsr) : "—",
            "Planning required",
          )}
        />
        <MiniStat
          label="Indicative dwellings"
          value={dash(planningOk ? num(dwellings) : "—", "Planning required")}
        />
        <MiniStat label="GRV" value={dash(planningOk ? money(grv, { compact: true }) : "—", "Planning required")} />
        <MiniStat
          label="Existing value"
          value={dash(analysis.marketValueComplete ? money(existing, { compact: true }) : "—", "VALUE REQUIRED")}
        />
        <MiniStat
          label="Max payable"
          value={dash(planningOk ? money(maxPay, { compact: true }) : "—", "Planning required")}
        />
        <MiniStat
          label="Headroom"
          value={dash(
            planningOk && (analysis.marketValueComplete || scenarioMode === "PROPOSED")
              ? money(headroom, { compact: true })
              : "—",
            !planningOk ? "Planning required" : "VALUE REQUIRED",
          )}
        />
        <MiniStat label="MOC" value={planningOk && moc != null ? pct(moc, 0) : "—"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <Panel title="A · Site" className="lg:col-span-5" bodyClassName="space-y-2">
          <div className="text-[14px] font-semibold">{dto.name}</div>
          <div className="text-[12px] text-muted">
            {dto.suburb ?? "NSW"}
            {dto.lga ? ` · ${dto.lga}` : ""}
          </div>
          <dl className="grid grid-cols-2 gap-2 text-[12.5px]">
            <div>
              <dt className="text-[10.5px] uppercase text-muted">Lots</dt>
              <dd className="font-semibold">{analysis.includedIds.length}</dd>
            </div>
            <div>
              <dt className="text-[10.5px] uppercase text-muted">Site area</dt>
              <dd className="num font-semibold">{sqm(analysis.site.siteAreaSqm)}</dd>
            </div>
          </dl>
          <div className="h-[180px] overflow-hidden rounded-[3px] border border-line">
            <LotsMap lots={dto.lots} selectedId={selected} onSelect={setSelected} />
          </div>
        </Panel>

        <div className="space-y-4 lg:col-span-7">
          <Panel title="B · Planning" actions={<Badge tone="live">CURRENT</Badge>}>
            <div className="grid grid-cols-2 gap-3 text-[12.5px] sm:grid-cols-4">
              <MiniStat label="Current zone" value={currentZone ?? "—"} />
              <MiniStat
                label="Official LEP FSR"
                value={dash(officialLepFsr != null ? fsr(officialLepFsr) : "—", "No mapped LEP FSR")}
              />
              <MiniStat
                label="Effective / modelled FSR"
                value={dash(effectiveFsr != null ? fsr(effectiveFsr) : "—", "No effective FSR")}
              />
              <MiniStat label="Height" value={currentHeight != null ? `${currentHeight} m` : "—"} />
            </div>
            <p className="mt-2 text-[11px] text-muted">Source · PlanningSnapshot / NSW EPI (current law)</p>
            {(area || keyHit) && (
              <div className="mt-3 border-t border-line pt-3">
                <div className="mb-2 flex items-center gap-2">
                  <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">Proposed / pending</div>
                  <Badge tone="warn">NOT CURRENT LAW</Badge>
                </div>
                {area && (
                  <div className="mb-2">
                    <div className="text-[13px] font-semibold">{area.title}</div>
                    <div className="text-[12px] text-muted">{area.status}</div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <Compare label="FSR" from={currentFsr != null ? fsr(currentFsr) : "—"} to={proposedFsr != null ? fsr(proposedFsr) : "—"} />
                  <Compare
                    label="Height"
                    from={currentHeight != null ? `${currentHeight} m` : "—"}
                    to={proposedHeight != null ? `${proposedHeight} m` : "—"}
                  />
                </div>
              </div>
            )}
            {!area && !keyHit && (
              <p className="mt-2 text-[12px] text-muted">No monitored proposed planning change currently intersects this site.</p>
            )}
          </Panel>
        </div>
      </div>

      {keyHit && (
        <Panel
          title="Assembly"
          actions={
            <Link
              href={`/map?opportunityId=${encodeURIComponent(dto.id)}&pca=${encodeURIComponent(keyHit.planningChangeAreaId)}&keySite=${encodeURIComponent(keyHit.keySite.externalKeySiteId)}`}
              className="text-[11px] font-semibold text-brand hover:underline"
            >
              View on map
            </Link>
          }
        >
          <div className="grid gap-3 text-[12.5px] sm:grid-cols-3">
            <MiniStat
              label="Your parcel"
              value={
                keyHit.yourPropertyIndex != null
                  ? `${keyHit.yourPropertyIndex} of ${keyHit.requiredCount}`
                  : `1 of ${keyHit.requiredCount}`
              }
            />
            <MiniStat label="Required properties" value={String(keyHit.requiredCount)} />
            <MiniStat label="Key site" value={keyHit.keySite.name} />
          </div>
          {!!keyHit.requiredAddresses?.length && (
            <ul className="mt-3 space-y-1 text-[12.5px]">
              {keyHit.requiredAddresses.map((addr) => (
                <li key={addr}>· {addr}</li>
              ))}
            </ul>
          )}
          {(keyHit.keySite.structuredConditions?.length || keyHit.keySite.conditions?.length) && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {(keyHit.keySite.structuredConditions ?? []).map((c) => (
                <Badge key={c.type + (c.value ?? "")} tone="neutral">
                  {c.type.replaceAll("_", " ")}
                  {c.value ? `: ${c.value}` : ""}
                </Badge>
              ))}
              {(keyHit.keySite.conditions ?? []).map((c) => (
                <Badge key={c} tone="neutral">
                  {c}
                </Badge>
              ))}
            </div>
          )}
          <div className="mt-3">
            <Button
              size="sm"
              variant="accent"
              disabled={assemblyBusy}
              onClick={() => {
                setAssemblyBusy(true);
                setAssemblyError(null);
                void fetch("/api/planning/analyse-assembly", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    keySiteId: keyHit.keySite.externalKeySiteId,
                    planningChangeAreaId: keyHit.planningChangeAreaId,
                    parcelIds: keyHit.requiredParcelIds?.filter((id) => /^nsw-cadid:\d+$/.test(id)),
                    name: `Key site ${keyHit.keySite.externalKeySiteId} — required assembly`,
                  }),
                })
                  .then(async (res) => {
                    const j = (await res.json()) as { href?: string; error?: string };
                    if (!res.ok) throw new Error(j.error ?? "Analyse assembly failed");
                    if (!j.href) throw new Error("Assembly created but no navigation href returned");
                    router.push(j.href);
                  })
                  .catch((e: unknown) => {
                    setAssemblyError(e instanceof Error ? e.message : String(e));
                  })
                  .finally(() => setAssemblyBusy(false));
              }}
            >
              {assemblyBusy ? "Creating assembly…" : "Analyse required assembly"}
            </Button>
            {assemblyError && <p className="mt-2 text-[12px] text-bad">{assemblyError}</p>}
          </div>
        </Panel>
      )}

      <Panel title="Nearby development" actions={<span className="text-[11px] text-muted">Default 500 m</span>}>
        {daConnected === false || daStatus === "AUTH_REQUIRED" ? (
          <p className="mb-2 text-[12.5px] text-muted">
            DA feed not connected — set <span className="font-semibold">NSW_ONLINE_DA_SUBSCRIPTION_KEY</span> on
            Render to enable Online DA. HDA / SSD records below still load when available.
          </p>
        ) : null}
        {!activity.length ? (
          <p className="text-[12.5px] text-muted">
            {daStatus === "AUTH_REQUIRED"
              ? "No geocoded HDA / SSD records within 500 m yet. Nearby DA omitted while the feed is not connected."
              : "No geocoded DA / HDA / SSD records within 500 m from connected statewide feeds yet."}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {activity.map((act) => (
              <li key={act.id} className="flex items-start justify-between gap-3 py-2.5">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={act.type === "HDA" ? "brand" : act.status === "APPROVED" ? "good" : "neutral"}>{act.type}</Badge>
                    <Badge tone="warn">{act.status}</Badge>
                    {act.distanceM != null && <span className="text-[11px] text-muted">{act.distanceM}m away</span>}
                  </div>
                  <div className="mt-1 text-[13px] font-semibold">{act.address ?? act.description ?? act.externalId}</div>
                  <p className="text-[12px] text-muted">
                    {[
                      act.developmentType,
                      act.storeys != null ? `${act.storeys} storeys` : null,
                      act.dwellings != null ? `${act.dwellings} dwellings` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {act.sourceUrl && (
                  <a href={act.sourceUrl} target="_blank" rel="noreferrer" className="shrink-0 text-[11px] font-semibold text-brand hover:underline">
                    Source
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="C · Quick feasibility"
        actions={
          proposedFsr != null ? (
            <div className="flex gap-1">
              {(["CURRENT", "PROPOSED"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setScenarioMode(m)}
                  className={cx(
                    "rounded-[3px] px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wide",
                    scenarioMode === m ? "bg-brand text-white" : "border border-line text-muted hover:bg-canvas",
                  )}
                >
                  {m === "PROPOSED" ? "Proposed scenario" : "Current"}
                </button>
              ))}
            </div>
          ) : null
        }
      >
        {scenarioMode === "PROPOSED" && (
          <p className="mb-2 text-[11.5px] text-amber-900">
            Proposed scenario is illustrative only — does not overwrite current-law feasibility.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3 text-[12.5px] sm:grid-cols-3 lg:grid-cols-6">
          <MiniStat label="Indicative dwellings" value={num(dwellings)} />
          <MiniStat label="GRV" value={money(grv, { compact: true })} />
          <MiniStat label="Development cost" value={money(nonLand, { compact: true })} />
          <MiniStat label="Target MOC" value={moc != null ? pct(moc, 0) : "—"} />
          <MiniStat
            label="Existing value"
            value={dash(analysis.marketValueComplete ? money(existing, { compact: true }) : "—", "VALUE REQUIRED")}
          />
          <MiniStat label="Max payable" value={money(maxPay, { compact: true })} />
        </div>
        <div className="mt-3 text-[13px]">
          Acquisition headroom:{" "}
          <span className={cx("num font-semibold", (headroom ?? 0) > 0 ? "text-good" : "text-bad")}>
            {analysis.marketValueComplete || scenarioMode === "PROPOSED" ? money(headroom, { compact: true }) : "—"}
          </span>
        </div>
      </Panel>

      <Panel
        title="D · Market evidence"
        actions={
          <button type="button" onClick={() => setTab("market")} className="text-[11px] font-semibold text-brand hover:underline">
            Open Comparables →
          </button>
        }
      >
        <p className="text-[13px]">
          {registered.hasEvidence
            ? registered.summaryLine
            : analysis.marketValueComplete
              ? `Existing value ${money(existing, { compact: true })} — registered-sales evidence not stored on this opportunity.`
              : "No existing-value estimate yet — Comparables will show registered evidence once valued."}
        </p>
        {registered.hasEvidence && (
          <p className="mt-1 text-[12px] text-muted">
            {registered.primarySourceLabel} · {registered.estimateKind}
            {registered.dataQuality ? ` · ${registered.dataQuality}` : null}
            {registered.summaryDetail ? ` · ${registered.summaryDetail}` : null}
            {registered.hasDetailedSaleRows && registered.uniqueIncludedSaleCount !== registered.uniqueSaleCount
              ? ` · ${registered.uniqueIncludedSaleCount} included of ${registered.uniqueSaleCount} unique`
              : null}
          </p>
        )}
      </Panel>

      <Panel title="E · Next action">
        <div className="flex flex-wrap gap-2">
          <WatchOpportunityButton />
          <button
            type="button"
            onClick={() => setTab("feasibility")}
            className="inline-flex h-8 items-center rounded-[3px] border border-line bg-white px-3 text-[12px] font-semibold hover:border-brand hover:text-brand"
          >
            Analyse / edit assumptions
          </button>
          <button
            type="button"
            onClick={() => setTab("acquisition")}
            className="inline-flex h-8 items-center rounded-[3px] border border-brand bg-brand px-3 text-[12px] font-semibold text-white hover:opacity-90"
          >
            Acquisition
          </button>
          <button
            type="button"
            onClick={() => setTab("market")}
            className="inline-flex h-8 items-center rounded-[3px] border border-line bg-white px-3 text-[12px] font-semibold hover:border-brand hover:text-brand"
          >
            Comparables evidence
          </button>
        </div>
      </Panel>

      <div className="rounded-[3px] border border-line bg-white">
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-muted hover:text-ink"
          onClick={() => setSourcesOpen((v) => !v)}
        >
          <span>Sources &amp; history</span>
          <span>{sourcesOpen ? "Hide" : "Show"}</span>
        </button>
        {sourcesOpen && (
          <div className="space-y-4 border-t border-line px-4 py-3">
            {!intel.length && !whyItems.length ? (
              <p className="text-[12.5px] text-muted">No recent Source Watcher events spatially linked to this site.</p>
            ) : (
              <ul className="space-y-2">
                {whyItems.map((w) =>
                  w ? (
                    <li key={w.kind + w.title} className="border-l-2 border-brand/30 pl-2">
                      <div className="text-[12px] font-semibold">{w.title}</div>
                      <p className="text-[12px] text-muted">{w.body}</p>
                    </li>
                  ) : null,
                )}
                {intel.map((e) => (
                  <li key={e.id} className="text-[12.5px]">
                    <span className="text-muted">{e.createdAt.slice(0, 10)}</span> ·{" "}
                    {e.href ? (
                      <Link href={e.href} className="font-semibold hover:text-brand">
                        {e.title}
                      </Link>
                    ) : (
                      <span className="font-semibold">{e.title}</span>
                    )}
                    {e.summary && <p className="text-muted">{e.summary}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">{label}</div>
      <div className="mt-0.5 font-semibold">{value}</div>
    </div>
  );
}

function Compare({ label, from, to }: { label: string; from: string; to: string }) {
  return (
    <div className="rounded-[3px] border border-line bg-canvas/50 px-3 py-2">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">{label}</div>
      <div className="mt-1 text-[15px] font-semibold">
        <span className="text-muted">{from}</span>
        <span className="mx-1.5 text-muted">→</span>
        <span className="text-brand">{to}</span>
      </div>
    </div>
  );
}
