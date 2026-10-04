"use client";

import { useMemo, useState } from "react";
import { useOpportunity } from "./context";
import { LotsMap } from "./lots-map";
import { SCORE_WEIGHTS } from "@/lib/analysis/assembly";
import { STAGE_LABELS } from "@/lib/constants";
import { resolveValuationStatus, valuationSourceBadge, viabilityLabel } from "@/lib/analysis/valuation";
import { fsr, lotDp, money, num, pct, sqm } from "@/lib/format";
import { Badge, Button, DemoFinancialBadge, NumberField, Panel, Stat, TextArea, cx } from "@/components/ui";
import type { OpportunityInputs } from "@/lib/analysis/assumptions";
import { HistoryPanel } from "./history-panel";
import { ConceptVisualsPanel } from "./concept-visuals-panel";
import { WatchOpportunityButton } from "./watch-opportunity-button";

const COMPONENT_LABELS: Record<keyof typeof SCORE_WEIGHTS, string> = {
  acquisitionHeadroom: "Acquisition headroom",
  developmentUplift: "Development uplift",
  planningCapacity: "Planning capacity",
  simplicity: "Assembly simplicity",
  geometry: "Site geometry / connectivity",
  planningRisk: "Planning risk",
};

export function OverviewTab() {
  const { dto, analysis, updateLot, updateOpportunity, updateInputs, refresh, saving } = useOpportunity();
  const [selected, setSelected] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [revaluing, setRevaluing] = useState(false);
  const [autoValuing, setAutoValuing] = useState(false);
  const f = analysis.base.feasibility;
  const y = analysis.base.yield;
  const mv = analysis.combinedExistingValue;
  const maxPay = analysis.maxPayableToOwners;
  const headroom = analysis.acquisitionHeadroom;
  const val = analysis.valuation;
  const maxBar = Math.max(mv ?? 0, maxPay, 1);
  const crit = new Map(analysis.critical.map((c) => [c.id, c]));
  const alloc = new Map(analysis.allocation.lots.map((l) => [l.id, l]));
  const marginal = new Map(analysis.marginal.map((m) => [m.id, m]));
  const acquisitionPropertyByLot = new Map(
    analysis.economicConfidence.acquisitionProperties.flatMap((property) =>
      property.lotIds.map((lotId) => [lotId, property] as const),
    ),
  );
  const detailLot = detailId ? dto.lots.find((l) => l.id === detailId) ?? null : null;
  const detailVal = useMemo(() => {
    if (!detailLot) return null;
    return dto.inputs.lotValuationDetails?.[detailLot.externalParcelId] ?? null;
  }, [detailLot, dto.inputs.lotValuationDetails]);

  async function revalueWithExcluded(excludedIds: string[]) {
    if (!detailLot) return;
    setRevaluing(true);
    try {
      const { fetchApiJson } = await import("@/lib/api-json");
      // Same loose typing as the previous `res.json()` path — valuation payload is validated at use sites.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = await fetchApiJson<any>("/api/valuations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prefer: "nsw",
          parcels: [
            {
              externalParcelId: detailLot.externalParcelId,
              address: detailLot.address,
              suburb: detailLot.suburb,
              areaSqm: detailLot.areaSqm,
              lng: detailLot.centroid[0],
              lat: detailLot.centroid[1],
              isStrata: detailLot.isStrata,
              zone: detailLot.zone,
              excludedIds,
            },
          ],
        }),
      });
      const v = body.results?.[0]?.valuation;
      if (!v) throw new Error("No valuation returned");
      await updateLot(detailLot.id, {
        marketValue: v.mid,
        marketValueLow: v.low,
        marketValueHigh: v.high,
        marketValueSource: v.source === "COMPARABLE_DERIVED" ? "COMPARABLE_DERIVED" : v.mid != null ? "USER_ESTIMATE" : "NO_VALUE",
        marketValueConfidence: v.confidence,
        marketValueProvider: v.provider,
        marketValueMethod: v.method,
        marketValueCheckedAt: v.checkedAt,
        marketValueNote: v.note,
      });
      const nextDetails: OpportunityInputs["lotValuationDetails"] = {
        ...(dto.inputs.lotValuationDetails ?? {}),
        [detailLot.externalParcelId]: {
          mid: v.mid,
          low: v.low,
          high: v.high,
          confidence: v.confidence,
          source: v.source,
          provider: v.provider,
          numberOfComps: v.numberOfComps ?? null,
          valuationLabel: v.valuationLabel ?? null,
          subjectLastSale: v.subjectLastSale ?? null,
          comps: v.comps ?? [],
        },
      };
      updateInputs({ lotValuationDetails: nextDetails });
    } catch {
      // keep prior values; error surface is soft
    } finally {
      setRevaluing(false);
    }
  }

  function toggleCompExcluded(compId: string, currentlyIncluded: boolean) {
    if (!detailLot) return;
    const comps = dto.inputs.lotValuationDetails?.[detailLot.externalParcelId]?.comps ?? [];
    const excludedIds = comps.filter((c) => (c.id === compId ? currentlyIncluded : !c.included)).map((c) => c.id);
    void revalueWithExcluded(excludedIds);
  }

  return (
    <div className="grid grid-cols-12 gap-4">
      <div className="col-span-7 space-y-4">
        <Panel title="Opportunity summary" actions={dto.demoFinancialData ? <DemoFinancialBadge /> : null}>
          <div className="grid grid-cols-4 gap-5">
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">Site</div>
              <div className="mt-1 text-[13px] leading-relaxed">
                <div className="font-semibold">
                  {analysis.includedIds.length} lots · {sqm(analysis.site.siteAreaSqm)}
                </div>
                <div className="text-muted">FSR {fsr(analysis.site.fsr)}</div>
              </div>
            </div>
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">Acquisition</div>
              <div className="mt-1 space-y-0.5 text-[13px]">
                <div>
                  Combined mid value: <span className="num font-semibold">{analysis.marketValueComplete ? money(mv, { compact: true }) : "—"}</span>
                </div>
                <div>
                  Max payable to owners: <span className="num font-semibold text-brand">{money(maxPay, { compact: true })}</span>
                </div>
                <div>
                  Acquisition headroom:{" "}
                  <span className={cx("num font-semibold", analysis.marketValueComplete ? (headroom != null && headroom > 0 ? "text-good" : "text-bad") : "text-muted")}>
                    {analysis.marketValueComplete ? money(headroom, { compact: true }) : "VALUE REQUIRED"}
                  </span>
                </div>
                <div className="text-muted">
                  {analysis.marketValueComplete ? `Indicative owner premium capacity: ${pct(analysis.acquisitionHeadroomPercent, 0, true)}` : "Enter Est. Current Value per lot"}
                </div>
              </div>
            </div>
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">Development</div>
              <div className="mt-1 space-y-0.5 text-[13px]">
                <div className="font-semibold">{num(y.dwellings)} dwellings</div>
                <div className="text-muted">{sqm(y.saleableArea)} saleable</div>
                <div>
                  GRV <span className="num font-semibold">{money(f.grv, { compact: true })}</span>
                </div>
              </div>
            </div>
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">Financial</div>
              <div className="mt-1 space-y-0.5 text-[13px]">
                <div>
                  Costs before land: <span className="num font-semibold">{money(f.nonLandCosts, { compact: true })}</span>
                </div>
                <div>
                  Target profit: <span className="num font-semibold">{money(f.profit, { compact: true })}</span>
                </div>
                <div className="text-muted">{pct(f.marginOnCost)} MOC</div>
              </div>
            </div>
          </div>
        </Panel>

        <Panel
          title="Why this assembly creates value"
          actions={
            <Badge
              tone={
                analysis.viability === "LIKELY_VIABLE"
                  ? "good"
                  : analysis.viability === "MARGINAL" || analysis.viability === "REQUIRES_PLANNING_INPUT"
                    ? "warn"
                    : analysis.viability === "UNLIKELY"
                      ? "bad"
                      : "estimate"
              }
            >
              {viabilityLabel(analysis.viability)}
            </Badge>
          }
        >
          {!analysis.marketValueComplete ? (
            <div className="rounded-[3px] border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-950">
              <div className="font-semibold">INSUFFICIENT VALUATION DATA</div>
              <p className="mt-1">
                Automatic NSW registered comparable sales have not populated every lot yet. Click Auto-value to fetch them now. Manual entry is a last-resort override only. Maximum payable ({money(maxPay, { compact: true })}) still comes from development feasibility.
              </p>
              <div className="mt-2">
                <Button
                  size="sm"
                  disabled={autoValuing || saving}
                  onClick={async () => {
                    setAutoValuing(true);
                    try {
                      const { fetchApiJson } = await import("@/lib/api-json");
                      await fetchApiJson(`/api/opportunities/${dto.id}/valuate`, { method: "POST" });
                      await refresh();
                    } catch {
                      // soft fail
                    } finally {
                      setAutoValuing(false);
                    }
                  }}
                >
                  {autoValuing ? "Valuing from NSW sales…" : "Auto-value from NSW registered sales"}
                </Button>
              </div>
              {analysis.screeningExistingValue != null && (
                <p className="mt-1 text-[11px] text-muted">Rough screening total (not trusted): {money(analysis.screeningExistingValue, { compact: true })}</p>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-4">
                <Stat label="Combined mid existing value" value={money(val.mid, { compact: true })} sub={`Low ${money(val.low, { compact: true })} · High ${money(val.high, { compact: true })}`} />
                <Stat label="Maximum payable to owners" value={money(maxPay, { compact: true })} tone="brand" sub="Development-supported — independent of house values" />
                <Stat
                  label="Acquisition headroom (mid)"
                  value={money(val.headroomMid, { compact: true })}
                  tone={(val.headroomMid ?? 0) > 0 ? "good" : "bad"}
                  sub={`Low case ${money(val.headroomHigh, { compact: true })} · High case ${money(val.headroomLow, { compact: true })}`}
                />
                <Stat label="Assembly uplift" value={money(analysis.assemblyUplift, { compact: true })} sub="Max payable − mid existing value" />
              </div>
              <div className="mt-5 space-y-2">
                <Bar label="Existing homes — combined mid value" value={mv ?? 0} max={maxBar} className="bg-stone-400" />
                <Bar label="Maximum payable to owners" value={maxPay} max={maxBar} className="bg-brand" />
              </div>
              <p className="mt-4 text-[12px] leading-relaxed text-muted">
                Max payable ({money(maxPay, { compact: true })}) is what the development can support. Existing value ({money(mv, { compact: true })}) is what the owners&apos; properties are worth now. Headroom = max payable − existing value.
              </p>
            </>
          )}
        </Panel>

        {analysis.economicConfidence.acquisitionProperties
          .filter((property) => property.lotIds.length > 1)
          .map((property) => (
            <Panel key={property.id} title="Acquisition property">
              <div className="grid grid-cols-4 gap-4">
                <div className="col-span-2">
                  <div className="font-semibold">{property.address ?? property.label}</div>
                  <div className="mt-1 text-[11px] text-muted">
                    {property.lotIds.length} cadastral lots · {sqm(property.areaSqm)}
                  </div>
                  <div className="mt-1 text-[10px] text-muted">{property.sourceLabel}</div>
                </div>
                <Stat label="Estimated current property value" value={money(property.marketValue, { compact: true })} />
                <Stat
                  label="Acquisition headroom"
                  value={money(analysis.acquisitionHeadroom, { compact: true })}
                  sub={`Max payable ${money(analysis.maxPayableToOwners, { compact: true })}`}
                  tone={(analysis.acquisitionHeadroom ?? 0) >= 0 ? "good" : "bad"}
                />
              </div>
            </Panel>
          ))}

        <Panel title="Cadastral lots in assembly" bodyClassName="p-0">
          <table className="w-full text-[12px]">
            <thead className="bg-canvas text-[10.5px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2 text-left">Include</th>
                <th className="px-3 py-2 text-left">Property</th>
                <th className="px-3 py-2 text-right">Area</th>
                <th className="px-3 py-2 text-right">Est. current value</th>
                <th className="px-3 py-2 text-left">Source</th>
                <th className="px-3 py-2 text-right">Max offer</th>
                <th className="px-3 py-2 text-right">Neg. headroom</th>
                <th className="px-3 py-2 text-left">Marginal</th>
                <th className="px-3 py-2 text-left">Role</th>
                <th className="px-3 py-2 text-left">Stage</th>
              </tr>
            </thead>
            <tbody>
              {dto.lots.map((l) => {
                const c = crit.get(l.id);
                const m = marginal.get(l.id);
                const al = alloc.get(l.id);
                const status = resolveValuationStatus(l.marketValueSource, l.marketValue);
                const acquisitionProperty = acquisitionPropertyByLot.get(l.id);
                const sharedProperty = acquisitionProperty && acquisitionProperty.lotIds.length > 1;
                return (
                  <tr key={l.id} className={cx("border-t border-line", selected === l.id && "bg-brand-soft/50", !l.included && "text-muted")} onClick={() => setSelected(l.id)}>
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={l.included} onChange={(e) => updateLot(l.id, { included: e.target.checked })} aria-label={`Include ${l.label}`} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{l.label}</div>
                      <div className="text-[11px] text-muted">{lotDp(l)}</div>
                    </td>
                    <td className="num px-3 py-2 text-right">{sqm(l.areaSqm)}</td>
                    <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                      {sharedProperty ? (
                        <div className="text-[11px] text-muted">
                          Shared property value
                          <div className="text-[10px]">Included once above</div>
                        </div>
                      ) : (
                        <NumberField
                          kind="money"
                          value={l.marketValue}
                          placeholder="VALUE REQUIRED"
                          ariaLabel={`Est. current value ${l.label}`}
                          className="h-7 w-[110px] text-right"
                          onCommit={(v) =>
                            updateLot(l.id, {
                              marketValue: v,
                              marketValueSource: v != null ? "USER_ESTIMATE" : "NO_VALUE",
                              marketValueConfidence: l.marketValueConfidence ?? "UNKNOWN",
                              marketValueNote: v != null ? "USER ENTERED EXTERNAL ESTIMATE" : null,
                            })
                          }
                        />
                      )}
                      {!sharedProperty && (l.marketValueLow != null || l.marketValueHigh != null) && (
                        <button type="button" className="mt-0.5 block w-full text-[10px] text-muted hover:underline" onClick={() => setDetailId(l.id)}>
                          {money(l.marketValueLow, { compact: true })}–{money(l.marketValueHigh, { compact: true })}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      {sharedProperty ? (
                        <Badge>Shared property</Badge>
                      ) : (
                        <button type="button" onClick={() => setDetailId(l.id)}>
                          <Badge tone={status === "NO_VALUE" || status === "SUBURB_FALLBACK" ? "warn" : status === "LIVE_AVM" ? "live" : "neutral"}>
                            {valuationSourceBadge(status, l.marketValueProvider)}
                          </Badge>
                        </button>
                      )}
                    </td>
                    <td className="num px-3 py-2 text-right">{l.included ? money(al?.maximumOffer, { compact: true }) : "—"}</td>
                    <td className="num px-3 py-2 text-right">{l.included && l.marketValue != null ? money(al?.negotiationHeadroom, { compact: true }) : "—"}</td>
                    <td className="px-3 py-2">
                      {!l.included ? (
                        <Badge>Excluded</Badge>
                      ) : m?.verdict === "DESTROYS_VALUE" ? (
                        <Badge tone="bad">Destroys value</Badge>
                      ) : m?.verdict === "HIGH_VALUE" ? (
                        <Badge tone="good">High value</Badge>
                      ) : (
                        <Badge>Neutral</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">{!l.included ? <Badge>Excluded</Badge> : c?.status === "CRITICAL" ? <Badge tone="bad">Critical</Badge> : <Badge tone="good">Optional</Badge>}</td>
                    <td className="px-3 py-2 text-[11.5px]">{STAGE_LABELS[l.acquisitionStage]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="border-t border-line px-3 py-2 text-[11px] text-muted">
            Values populate automatically from Domain Price Estimate (then PropTrack / comps when available). Manual edit is an override — combined value, headroom, offers and score recalculate immediately. Missing values show VALUE REQUIRED (never a silent suburb fallback).
          </p>
        </Panel>

        {detailLot && (
          <Panel title={`Valuation · ${detailLot.label}`} actions={<button className="text-[11px] text-muted hover:text-ink" onClick={() => setDetailId(null)}>Close</button>}>
            <div className="grid grid-cols-2 gap-3 text-[12px]">
              <div>
                <div className="text-[10.5px] uppercase text-muted">Estimated current value</div>
                <div className="num font-semibold">{money(detailLot.marketValue, { compact: true })}</div>
              </div>
              <div>
                <div className="text-[10.5px] uppercase text-muted">Indicative range</div>
                <div className="num">
                  {money(detailLot.marketValueLow, { compact: true })}–{money(detailLot.marketValueHigh, { compact: true })}
                </div>
              </div>
              <div>
                <div className="text-[10.5px] uppercase text-muted">Confidence</div>
                <div>{detailLot.marketValueConfidence ?? "—"}</div>
              </div>
              <div>
                <div className="text-[10.5px] uppercase text-muted">Source</div>
                <div>{valuationSourceBadge(resolveValuationStatus(detailLot.marketValueSource, detailLot.marketValue), detailLot.marketValueProvider)}</div>
              </div>
              <div>
                <div className="text-[10.5px] uppercase text-muted">Checked</div>
                <div>{detailLot.marketValueCheckedAt ? new Date(detailLot.marketValueCheckedAt).toLocaleDateString("en-AU") : "—"}</div>
              </div>
              <div>
                <div className="text-[10.5px] uppercase text-muted">Based on</div>
                <div>{detailVal?.numberOfComps != null ? `${detailVal.numberOfComps} registered sales` : "—"}</div>
              </div>
              <div className="col-span-2">
                <div className="text-[10.5px] uppercase text-muted">Label</div>
                <div>{detailVal?.valuationLabel ?? detailLot.marketValueNote ?? "—"}</div>
              </div>
            </div>

            {detailVal?.subjectLastSale && (
              <div className="mt-3 rounded-[3px] border border-line bg-canvas px-3 py-2 text-[12px]">
                <div className="text-[10.5px] font-semibold uppercase text-muted">Last registered sale (subject)</div>
                <div className="mt-1">
                  {money(detailVal.subjectLastSale.salePrice, { compact: true })}
                  {detailVal.subjectLastSale.saleDate ? ` · ${detailVal.subjectLastSale.saleDate}` : ""}
                  <span className="text-muted"> — supporting info only; not inflation-adjusted into the estimate</span>
                </div>
              </div>
            )}

            {!!detailVal?.comps?.length && (
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-[10.5px] font-semibold uppercase tracking-wide text-muted">Comparable registered sales</div>
                  {revaluing && <span className="text-[11px] text-muted">Recalculating…</span>}
                </div>
                <table className="w-full text-[11.5px]">
                  <thead className="bg-canvas text-[10px] uppercase text-muted">
                    <tr>
                      <th className="px-2 py-1.5 text-left">Include</th>
                      <th className="px-2 py-1.5 text-left">Comparable</th>
                      <th className="px-2 py-1.5 text-right">Price</th>
                      <th className="px-2 py-1.5 text-right">Date</th>
                      <th className="px-2 py-1.5 text-right">Area</th>
                      <th className="px-2 py-1.5 text-right">Dist</th>
                      <th className="px-2 py-1.5 text-right">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailVal.comps.map((c) => (
                      <tr key={c.id} className={cx("border-t border-line", !c.included && "text-muted")}>
                        <td className="px-2 py-1.5">
                          <input
                            type="checkbox"
                            checked={c.included}
                            disabled={revaluing}
                            onChange={() => void toggleCompExcluded(c.id, c.included)}
                            aria-label={`Include ${c.address}`}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="font-medium">{c.address}</div>
                          {!c.included && c.excludeReason && <div className="text-[10px]">{c.excludeReason}</div>}
                        </td>
                        <td className="num px-2 py-1.5 text-right">{money(c.salePrice, { compact: true })}</td>
                        <td className="num px-2 py-1.5 text-right">{c.saleDate ?? "—"}</td>
                        <td className="num px-2 py-1.5 text-right">{c.landAreaSqm != null ? sqm(c.landAreaSqm) : "—"}</td>
                        <td className="num px-2 py-1.5 text-right">{Math.round(c.distanceM)}m</td>
                        <td className="num px-2 py-1.5 text-right">{Math.round(c.similarity * 100)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-[11px] text-muted">
                  NSW registered sales · exclude a bad comparable to recalculate immediately. Screening estimate only — not a certified valuation.
                </p>
              </div>
            )}

            <div className="mt-3 grid grid-cols-2 gap-2" onClick={(e) => e.stopPropagation()}>
              <div>
                <div className="mb-1 text-[10.5px] uppercase text-muted">Low override</div>
                <NumberField kind="money" value={detailLot.marketValueLow} onCommit={(v) => updateLot(detailLot.id, { marketValueLow: v })} ariaLabel="Low estimate" />
              </div>
              <div>
                <div className="mb-1 text-[10.5px] uppercase text-muted">High override</div>
                <NumberField kind="money" value={detailLot.marketValueHigh} onCommit={(v) => updateLot(detailLot.id, { marketValueHigh: v })} ariaLabel="High estimate" />
              </div>
            </div>
            <div className="mt-2">
              <Button size="sm" variant="ghost" disabled={revaluing} onClick={() => void revalueWithExcluded([])}>
                Refresh NSW comps
              </Button>
            </div>
          </Panel>
        )}

        <Panel title="Notes">
          <TextArea rows={4} value={dto.notes ?? ""} onCommit={(notes) => updateOpportunity({ notes })} placeholder="Opportunity notes" />
        </Panel>
      </div>

      <div className="col-span-5 space-y-4">
        <div className="h-[340px] overflow-hidden rounded-[3px] border border-line">
          <LotsMap lots={dto.lots} selectedId={selected} onSelect={setSelected} />
        </div>
        <Panel title="Assumptions & sources">
          <p className="mb-2 text-[11px] text-muted">
            MVP screening uses factual defaults with sources. Override any input — opportunity score is unchanged by this panel.
          </p>
          <div className="space-y-1.5 text-[12px]">
            {(analysis.economicConfidence.inputSources ?? []).slice(0, 10).map((line) => (
              <div key={line.key} className="grid grid-cols-[1fr_auto] gap-2 border-b border-line/70 py-1 last:border-0">
                <div>
                  <div className="font-medium text-ink">{line.label}</div>
                  <div className="text-[10px] text-muted">{line.sourceLabel}</div>
                </div>
                <div className="num text-right text-[12px]">{line.value}</div>
              </div>
            ))}
          </div>
          {analysis.economicConfidence.acquisitionProperties.some(
            (p) => p.valueBasis === "PROPERTY_LEVEL_COMPS" || p.valueBasis === "PROPERTY_LEVEL_AVM",
          ) && (
            <p className="mt-2 text-[11px] text-muted">
              Shared-address lots valued as one property
              {analysis.economicConfidence.acquisitionValueMid != null &&
                ` · ${money(analysis.economicConfidence.acquisitionValueMid)}`}
              {analysis.economicConfidence.cadastralLotSumMid != null &&
                analysis.economicConfidence.acquisitionValueMid != null &&
                analysis.economicConfidence.cadastralLotSumMid !== analysis.economicConfidence.acquisitionValueMid &&
                ` (lot-AVM sum was ${money(analysis.economicConfidence.cadastralLotSumMid)} — not used)`}
              .
            </p>
          )}
          {!!analysis.economicConfidence.notes.length && (
            <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px] text-muted">
              {analysis.economicConfidence.notes.slice(0, 3).map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title={`Opportunity score · ${analysis.score.score}/100`}>
          <div className="space-y-1.5">
            {(Object.keys(SCORE_WEIGHTS) as (keyof typeof SCORE_WEIGHTS)[]).map((k) => (
              <div key={k} className="grid grid-cols-[170px_1fr_70px] items-center gap-2 text-[11.5px]">
                <span className="text-muted">
                  {COMPONENT_LABELS[k]} <span className="text-[10px]">({SCORE_WEIGHTS[k] * 100}%)</span>
                </span>
                <div className="h-1.5 rounded-full bg-canvas">
                  <div className="h-full rounded-full bg-brand" style={{ width: `${analysis.score.components[k]}%` }} />
                </div>
                <span className="num text-right">{Math.round(analysis.score.components[k])}/100</span>
              </div>
            ))}
          </div>
          <ul className="mt-3 space-y-0.5 text-[12px]">
            {analysis.score.factors.map((x) => (
              <li key={x.text} className={x.sign === "+" ? "text-good" : "text-bad"}>
                {x.sign === "+" ? "+" : "−"} {x.text}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel
          title="Development summary (base case)"
          actions={<WatchOpportunityButton />}
        >
          <div className="grid grid-cols-3 gap-4">
            <Stat
              size="md"
              label="FSR used"
              value={analysis.calculation.effectiveFsr != null ? fsr(analysis.calculation.effectiveFsr) : "—"}
              sub={
                analysis.planningSnapshot.effectiveControls.fsrSource === "STATE_PATHWAY"
                  ? `STATE LMR ${analysis.planningSnapshot.effectiveControls.stateFsr != null ? fsr(analysis.planningSnapshot.effectiveControls.stateFsr) : "—"} · LEP ${analysis.planningSnapshot.effectiveControls.baseFsr != null ? fsr(analysis.planningSnapshot.effectiveControls.baseFsr) : "not mapped"} · ${analysis.planningSnapshot.effectiveControls.proximityBandLabel}`
                  : analysis.planningSnapshot.effectiveControls.fsrSource === "OVERRIDE"
                    ? "USER ASSUMPTION"
                    : analysis.planningSnapshot.effectiveControls.fsrSource === "OFFICIAL"
                      ? "OFFICIAL MAPPED FSR"
                      : "NO MAPPED FSR ≠ 0:1"
              }
            />
            <Stat
              size="md"
              label="Theoretical GFA"
              value={analysis.calculation.calculable ? sqm(analysis.calculation.theoreticalGfa) : "—"}
              sub={analysis.calculation.calculable ? "Site × PlanningSnapshot effective FSR" : "Needs planning pathway"}
            />
            <Stat
              size="md"
              label="Achievable GFA"
              value={analysis.calculation.calculable ? sqm(analysis.calculation.achievableGfa) : "—"}
              sub={
                !analysis.calculation.calculable
                  ? "FEASIBILITY NOT YET CALCULABLE"
                  : y.gfaSource === "OVERRIDE"
                    ? "Manual override"
                    : `${Math.round(y.planningAdjustment * 100)}% planning adj.`
              }
            />
          </div>
          <p className="mt-3 text-[12px] text-ink">{analysis.conclusion.summary}</p>
          <div className="mt-2 flex flex-wrap gap-2 text-[10.5px] uppercase tracking-wide">
            <Badge tone={analysis.conclusion.planning === "LEP_CONTROLS" || analysis.conclusion.planning === "MODELLED_PATHWAY" ? "good" : "warn"}>
              Planning: {analysis.conclusion.planning.replaceAll("_", " ")}
            </Badge>
            <Badge tone={analysis.conclusion.economics === "VIABLE" ? "good" : analysis.conclusion.economics === "NOT_CALCULABLE" ? "warn" : "bad"}>
              Economics: {analysis.conclusion.economics.replaceAll("_", " ")}
            </Badge>
          </div>
        </Panel>
        <HistoryPanel />
        <ConceptVisualsPanel />
      </div>
    </div>
  );
}

function Bar({ label, value, max, className }: { label: string; value: number; max: number; className: string }) {
  return (
    <div>
      <div className="mb-0.5 flex justify-between text-[11.5px]">
        <span className="text-muted">{label}</span>
        <span className="num font-semibold">{money(value, { compact: true })}</span>
      </div>
      <div className="h-4 rounded-[2px] bg-canvas">
        <div className={cx("h-full rounded-[2px]", className)} style={{ width: `${Math.max(0, (value / max) * 100)}%` }} />
      </div>
    </div>
  );
}
