"use client";

import { useMemo, useState } from "react";
import { useOpportunity } from "./context";
import type { ComparableSaleDTO } from "@/lib/opportunity-dto";
import { summariseExitCompsByType, suggestedMarketValueFromComps } from "@/lib/analysis/unit-mix";
import { summariseRegisteredSalesEvidence } from "@/lib/analysis/registered-sales-evidence";
import { date, money, num, sqm } from "@/lib/format";
import { Badge, Button, DemoFinancialBadge, NumberField, Panel, Select, Stat, TextInput, cx } from "@/components/ui";
import { fetchApiJson } from "@/lib/api-json";
import type { OpportunityDTO } from "@/lib/opportunity-dto";

type CompSub = "ACQUISITION" | "EXIT";

export function MarketTab() {
  const { dto, setDto, analysis } = useOpportunity();
  const [sub, setSub] = useState<CompSub>("ACQUISITION");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showExcluded, setShowExcluded] = useState(false);
  const [expandedLots, setExpandedLots] = useState<Record<string, boolean>>({});

  const acq = dto.comparableSales.filter((c) => c.type === "ACQUISITION");
  const exit = dto.comparableSales.filter((c) => c.type === "EXIT");
  const rows = sub === "ACQUISITION" ? acq : exit;
  const exitSummary = summariseExitCompsByType(exit);
  const suggested = suggestedMarketValueFromComps(acq.filter((c) => c.included).map((c) => c.salePrice));

  const registered = useMemo(
    () =>
      summariseRegisteredSalesEvidence(dto.inputs.lotValuationDetails, dto.lots, {
        demoFinancialData: dto.demoFinancialData,
        combinedExistingValue: analysis.combinedExistingValue,
      }),
    [dto.inputs.lotValuationDetails, dto.lots, dto.demoFinancialData, analysis.combinedExistingValue],
  );

  async function api(url: string, init?: RequestInit) {
    setBusy(true);
    setErr(null);
    try {
      const body = await fetchApiJson<OpportunityDTO>(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
      setDto(body);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function addBlank() {
    await api(`/api/opportunities/${dto.id}/comps`, {
      method: "POST",
      body: JSON.stringify({
        type: sub,
        address: sub === "ACQUISITION" ? "New acquisition comparable (manual)" : "New exit comparable (manual)",
        salePrice: sub === "ACQUISITION" ? 1_300_000 : 1_650_000,
        source: "MANUAL",
        included: true,
        notes: "Manual entry — not live market data.",
        ...(sub === "EXIT" ? { unitType: "2 Bed", bedrooms: 2, saleableArea: 88, newBuildStatus: "NEW" } : { propertyType: "House", bedrooms: 3, landArea: 400 }),
      }),
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-[3px] border border-line bg-canvas px-4 py-3 text-[12.5px] text-ink">
        <strong>Three separate datasets.</strong> Registered NSW sales evidence backs the existing-property estimate (read-only). Manual acquisition comps are optional user entries. Exit comps estimate what{" "}
        <em>new apartments</em> could sell for after development — never conflate them with house sales. No scraping of Domain, REA, or CoreLogic.
      </div>

      <div className="flex gap-2">
        {(["ACQUISITION", "EXIT"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setSub(k)}
            className={cx("rounded-[3px] border px-3 py-1.5 text-[11.5px] font-semibold uppercase tracking-[0.08em]", sub === k ? "border-brand bg-brand text-white" : "border-line bg-white text-muted hover:text-ink")}
          >
            {k === "ACQUISITION" ? "Acquisition (existing houses)" : "Exit comps (apartment sales)"}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {dto.demoFinancialData && <DemoFinancialBadge />}
          {busy && <span className="text-[11px] text-muted">Saving…</span>}
          {err && <Badge tone="bad">{err}</Badge>}
          <Button variant="primary" onClick={addBlank}>
            Add manual comparable
          </Button>
        </div>
      </div>

      {sub === "ACQUISITION" && (
        <>
          <div className="grid grid-cols-2 gap-4 rounded-[3px] border border-line bg-white p-4 sm:grid-cols-4">
            <Stat
              label="Existing property estimate"
              value={analysis.marketValueComplete ? money(analysis.combinedExistingValue, { compact: true }) : "—"}
              sub={analysis.marketValueComplete ? registered.estimateKind : "VALUE REQUIRED"}
            />
            <Stat
              label="Registered sales evidence"
              value={registered.hasEvidence ? num(registered.uniqueIncludedSaleCount) : "—"}
              sub={registered.hasEvidence ? "unique comps used across assembly" : "No stored NSW evidence"}
            />
            <Stat label="Source" value={registered.hasEvidence ? registered.primarySourceLabel : "—"} sub={registered.hasEvidence ? registered.dataQuality : undefined} />
            <Stat label="Valuation method" value={registered.hasEvidence ? registered.primaryMethodLabel : "—"} sub={registered.hasEvidence ? "SYSTEM CALCULATION · COMPARABLE-DERIVED" : undefined} />
          </div>

          {registered.hasEvidence ? (
            <div className="space-y-3">
              {registered.lotCards.map((card) => {
                const open = expandedLots[card.lotId] ?? true;
                const included = card.comps.filter((c) => c.included);
                const excluded = card.comps.filter((c) => !c.included);
                return (
                  <Panel
                    key={card.lotId}
                    title={card.address}
                    actions={
                      <button
                        type="button"
                        className="text-[11px] font-semibold text-muted hover:text-ink"
                        onClick={() => setExpandedLots((m) => ({ ...m, [card.lotId]: !open }))}
                      >
                        {open ? "Collapse comps" : "Show comps"}
                      </button>
                    }
                  >
                    <div className="grid grid-cols-2 gap-3 text-[12.5px] sm:grid-cols-4">
                      <div>
                        <div className="text-[10.5px] uppercase tracking-wide text-muted">Estimated value</div>
                        <div className="num font-semibold">{money(card.mid, { compact: true })}</div>
                      </div>
                      <div>
                        <div className="text-[10.5px] uppercase tracking-wide text-muted">Range</div>
                        <div className="num">
                          {money(card.low, { compact: true })} – {money(card.high, { compact: true })}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10.5px] uppercase tracking-wide text-muted">Registered sales used</div>
                        <div className="font-semibold">{card.numberOfComps ?? card.includedCompCount}</div>
                      </div>
                      <div>
                        <div className="text-[10.5px] uppercase tracking-wide text-muted">Method</div>
                        <div>{card.methodLabel}</div>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted">
                      <Badge tone="official">NSW REGISTERED SALES</Badge>
                      {card.provider && <Badge>{card.provider}</Badge>}
                      {card.checkedAt && <span>Last checked {date(card.checkedAt)}</span>}
                    </div>

                    {open && (
                      <div className="mt-4 space-y-3">
                        {card.subjectLastSale && (
                          <div className="rounded-[3px] border border-line bg-canvas px-3 py-2 text-[12px]">
                            <div className="text-[10.5px] font-semibold uppercase tracking-wide text-muted">Subject property last sale</div>
                            <div className="mt-1">
                              {money(card.subjectLastSale.salePrice, { compact: true })}
                              {card.subjectLastSale.saleDate ? ` · ${card.subjectLastSale.saleDate}` : ""}
                              {card.subjectLastSale.address ? ` · ${card.subjectLastSale.address}` : ""}
                              <span className="text-muted"> — supporting info only; not inflation-adjusted into the estimate</span>
                            </div>
                          </div>
                        )}

                        <div>
                          <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted">Registered sales used in estimate</div>
                          <RegisteredCompsTable comps={included} empty="No included registered sales stored for this lot." />
                        </div>

                        {!!excluded.length && (
                          <div>
                            <button
                              type="button"
                              className="mb-2 text-[11px] font-semibold text-muted hover:text-ink"
                              onClick={() => setShowExcluded((v) => !v)}
                            >
                              {showExcluded ? "Hide" : "Show"} excluded records ({excluded.length})
                            </button>
                            {showExcluded && <RegisteredCompsTable comps={excluded} secondary empty="" />}
                          </div>
                        )}
                      </div>
                    )}
                  </Panel>
                );
              })}
              {registered.rawCompMentions > registered.uniqueSaleCount && (
                <p className="text-[11.5px] text-muted">
                  Per-lot cards show lot-specific comps ({registered.rawCompMentions} mentions). Assembly unique registered sales:{" "}
                  <span className="font-semibold text-ink">{registered.uniqueSaleCount}</span> ({registered.uniqueIncludedSaleCount} included).
                </p>
              )}
            </div>
          ) : (
            <Panel title="Registered sales evidence">
              <p className="text-[12.5px] text-muted">
                No registered-sales evidence is stored on this opportunity yet. Existing-property estimates need NSW comps valuation (or a manual override). This view only displays already-persisted{" "}
                <span className="font-semibold">lotValuationDetails</span> — it does not invent sales or call NSW on load.
              </p>
            </Panel>
          )}

          <Panel title="Manual acquisition comps" actions={<span className="text-[11px] text-muted">Editable · separate from NSW evidence</span>} bodyClassName="p-0">
            {!!acq.length && (
              <div className="grid grid-cols-2 gap-4 border-b border-line bg-white p-4 sm:grid-cols-3">
                <Stat label="Included manual comps" value={num(acq.filter((c) => c.included).length)} />
                <Stat label="Suggested median (manual)" value={money(suggested, { compact: true })} sub="COMPARABLE-DERIVED from manual rows only" />
                <Stat label="Combined existing property value" value={money(analysis.combinedExistingValue, { compact: true })} sub="From acquisition-property estimates" />
              </div>
            )}
            <ManualCompsTable
              rows={acq}
              sub="ACQUISITION"
              empty="No manual acquisition comps added."
              onPatch={(id, patch) => api(`/api/opportunities/${dto.id}/comps/${id}`, { method: "PATCH", body: JSON.stringify(patch) })}
              onDelete={(id) => api(`/api/opportunities/${dto.id}/comps/${id}`, { method: "DELETE" })}
            />
          </Panel>
        </>
      )}

      {sub === "EXIT" && (
        <>
          <Panel title="Exit market by unit type (included comps)">
            <div className="grid grid-cols-4 gap-4">
              {Object.entries(exitSummary).map(([k, v]) => (
                <div key={k} className="rounded-[3px] border border-line p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{k}</div>
                  <div className="mt-1 num text-[18px] font-semibold">{money(v.typicalSale, { compact: true })}</div>
                  <div className="text-[11.5px] text-muted">
                    Typical size {v.typicalSize != null ? sqm(v.typicalSize) : "—"} · {v.indicativePerSqm != null ? `${money(v.indicativePerSqm)}/sqm` : "—"} · {v.count} comps
                  </div>
                </div>
              ))}
              {!Object.keys(exitSummary).length && <p className="col-span-4 text-[12.5px] text-muted">Add exit comparables to build a local view of 1 / 2 / 3 bed and penthouse pricing.</p>}
            </div>
            {analysis.base.feasibility.blendedPricePerSqm != null && (
              <p className="mt-3 text-[12px] text-muted">
                Unit-mix blended $/sqm cross-check: <span className="num font-semibold">{money(analysis.base.feasibility.blendedPricePerSqm)}/sqm</span> — compare with the indicative ranges above.
              </p>
            )}
          </Panel>

          <Panel title="Exit / apartment comparable sales" bodyClassName="p-0">
            <ManualCompsTable
              rows={exit}
              sub="EXIT"
              empty="No exit comps yet. Add a manual comparable — do not paste scraped commercial listings."
              onPatch={(id, patch) => api(`/api/opportunities/${dto.id}/comps/${id}`, { method: "PATCH", body: JSON.stringify(patch) })}
              onDelete={(id) => api(`/api/opportunities/${dto.id}/comps/${id}`, { method: "DELETE" })}
            />
          </Panel>
        </>
      )}
    </div>
  );
}

function RegisteredCompsTable({
  comps,
  empty,
  secondary,
}: {
  comps: Array<{
    id: string;
    address: string;
    salePrice: number;
    saleDate: string | null;
    landAreaSqm: number | null;
    distanceM: number;
    similarity: number;
    included: boolean;
    excludeReason?: string | null;
    source: string;
  }>;
  empty: string;
  secondary?: boolean;
}) {
  return (
    <div className={cx("overflow-x-auto rounded-[3px] border border-line", secondary && "opacity-70")}>
      <table className="num w-full text-[12px]">
        <thead className="bg-canvas text-[10.5px] uppercase tracking-wide text-muted">
          <tr>
            <th className="px-3 py-2 text-left">Address</th>
            <th className="px-2 py-2 text-right">Sale price</th>
            <th className="px-2 py-2 text-left">Sale date</th>
            <th className="px-2 py-2 text-right">Land area</th>
            <th className="px-2 py-2 text-right">Distance</th>
            <th className="px-2 py-2 text-right">Similarity</th>
            <th className="px-2 py-2 text-left">Used / excluded</th>
            <th className="px-2 py-2 text-left">Source</th>
          </tr>
        </thead>
        <tbody>
          {comps.map((c) => (
            <tr key={c.id} className={cx("border-t border-line", !c.included && "text-muted")}>
              <td className="px-3 py-1.5">
                <div className="font-medium">{c.address}</div>
                {!c.included && c.excludeReason && <div className="text-[10.5px]">{c.excludeReason}</div>}
              </td>
              <td className="px-2 py-1.5 text-right">{money(c.salePrice, { compact: true })}</td>
              <td className="px-2 py-1.5">{c.saleDate ?? "—"}</td>
              <td className="px-2 py-1.5 text-right">{c.landAreaSqm != null ? sqm(c.landAreaSqm) : "—"}</td>
              <td className="px-2 py-1.5 text-right">{Math.round(c.distanceM)}m</td>
              <td className="px-2 py-1.5 text-right">{Math.round(c.similarity * 100)}</td>
              <td className="px-2 py-1.5">{c.included ? <Badge tone="good">Used</Badge> : <Badge>Excluded</Badge>}</td>
              <td className="px-2 py-1.5">
                <Badge>{c.source || "NSW REGISTERED SALE"}</Badge>
              </td>
            </tr>
          ))}
          {!comps.length && empty && (
            <tr>
              <td colSpan={8} className="px-3 py-4 text-center text-muted">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ManualCompsTable({
  rows,
  sub,
  empty,
  onPatch,
  onDelete,
}: {
  rows: ComparableSaleDTO[];
  sub: CompSub;
  empty: string;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <table className="num w-full text-[12px]">
      <thead className="bg-canvas text-[10.5px] uppercase tracking-wide text-muted">
        <tr>
          <th className="px-3 py-2 text-left">Include</th>
          <th className="px-3 py-2 text-left">Address / development</th>
          <th className="px-2 py-2 text-right">Sale price</th>
          <th className="px-2 py-2 text-left">Date</th>
          {sub === "ACQUISITION" ? (
            <>
              <th className="px-2 py-2 text-right">Beds</th>
              <th className="px-2 py-2 text-right">Land</th>
            </>
          ) : (
            <>
              <th className="px-2 py-2 text-left">Unit type</th>
              <th className="px-2 py-2 text-right">Saleable</th>
              <th className="px-2 py-2 text-right">$/sqm</th>
              <th className="px-2 py-2 text-left">Status</th>
            </>
          )}
          <th className="px-2 py-2 text-left">Source</th>
          <th className="px-2 py-2" />
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <CompRow key={c.id} c={c} sub={sub} onPatch={(patch) => onPatch(c.id, patch)} onDelete={() => onDelete(c.id)} />
        ))}
        {!rows.length && (
          <tr>
            <td colSpan={9} className="px-3 py-6 text-center text-muted">
              {empty}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function CompRow({ c, sub, onPatch, onDelete }: { c: ComparableSaleDTO; sub: CompSub; onPatch: (p: Record<string, unknown>) => void; onDelete: () => void }) {
  return (
    <tr className={cx("border-t border-line align-middle", !c.included && "opacity-50")}>
      <td className="px-3 py-1.5">
        <input type="checkbox" checked={c.included} onChange={(e) => onPatch({ included: e.target.checked })} aria-label={`Include ${c.address}`} />
      </td>
      <td className="px-3 py-1.5">
        <TextInput value={c.address} onCommit={(address) => onPatch({ address })} className="w-full" />
        {c.notes && <div className="mt-0.5 text-[10.5px] text-muted">{c.notes}</div>}
      </td>
      <td className="px-2 py-1.5">
        <NumberField kind="money" value={c.salePrice} onCommit={(v) => onPatch({ salePrice: v ?? 0 })} className="ml-auto w-28" />
      </td>
      <td className="px-2 py-1.5 text-[11.5px] text-muted">{date(c.saleDate)}</td>
      {sub === "ACQUISITION" ? (
        <>
          <td className="px-2 py-1.5">
            <NumberField value={c.bedrooms} onCommit={(v) => onPatch({ bedrooms: v })} className="ml-auto w-14" />
          </td>
          <td className="px-2 py-1.5">
            <NumberField value={c.landArea} onCommit={(v) => onPatch({ landArea: v })} className="ml-auto w-20" />
          </td>
        </>
      ) : (
        <>
          <td className="px-2 py-1.5">
            <Select
              value={c.unitType ?? ""}
              onChange={(unitType) => onPatch({ unitType })}
              options={[
                { value: "Studio", label: "Studio" },
                { value: "1 Bed", label: "1 Bed" },
                { value: "2 Bed", label: "2 Bed" },
                { value: "3 Bed", label: "3 Bed" },
                { value: "Penthouse", label: "Penthouse" },
              ]}
              className="h-7 w-28"
            />
          </td>
          <td className="px-2 py-1.5">
            <NumberField value={c.saleableArea} onCommit={(v) => onPatch({ saleableArea: v })} className="ml-auto w-20" />
          </td>
          <td className="px-2 py-1.5 text-right">{c.pricePerSqm != null ? money(c.pricePerSqm) : "—"}</td>
          <td className="px-2 py-1.5">
            <Select
              value={c.newBuildStatus ?? "NEW"}
              onChange={(newBuildStatus) => onPatch({ newBuildStatus })}
              options={[
                { value: "NEW", label: "New" },
                { value: "RECENTLY_COMPLETED", label: "Recently completed" },
                { value: "ESTABLISHED", label: "Established" },
              ]}
              className="h-7 w-36"
            />
          </td>
        </>
      )}
      <td className="px-2 py-1.5">
        <Badge>{c.source}</Badge>
      </td>
      <td className="px-2 py-1.5 text-right">
        <Button onClick={onDelete}>Delete</Button>
      </td>
    </tr>
  );
}
