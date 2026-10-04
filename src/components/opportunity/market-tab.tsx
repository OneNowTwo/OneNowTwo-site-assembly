"use client";

import { useState } from "react";
import { useOpportunity } from "./context";
import type { ComparableSaleDTO } from "@/lib/opportunity-dto";
import { summariseExitCompsByType, suggestedMarketValueFromComps } from "@/lib/analysis/unit-mix";
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

  const acq = dto.comparableSales.filter((c) => c.type === "ACQUISITION");
  const exit = dto.comparableSales.filter((c) => c.type === "EXIT");
  const rows = sub === "ACQUISITION" ? acq : exit;
  const exitSummary = summariseExitCompsByType(exit);
  const suggested = suggestedMarketValueFromComps(acq.filter((c) => c.included).map((c) => c.salePrice));

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
      <div className="rounded-[3px] border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-950">
        <strong>Two completely different markets.</strong> Acquisition comps estimate what the <em>existing houses</em> are worth today. Exit comps estimate what <em>new apartments</em> could sell for after development. Never conflate them. V1 is{" "}
        <strong>manual entry only</strong> — no scraping of Domain, REA, CoreLogic or similar. Labels: USER ESTIMATE · COMPARABLE-DERIVED · DEMO DATA.
      </div>

      <div className="flex gap-2">
        {(["ACQUISITION", "EXIT"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setSub(k)}
            className={cx("rounded-[3px] border px-3 py-1.5 text-[11.5px] font-semibold uppercase tracking-[0.08em]", sub === k ? "border-brand bg-brand text-white" : "border-line bg-white text-muted hover:text-ink")}
          >
            {k === "ACQUISITION" ? "Acquisition comps (existing houses)" : "Exit comps (apartment sales)"}
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
        <div className="grid grid-cols-4 gap-4 rounded-[3px] border border-line bg-white p-4">
          <Stat label="Included acquisition comps" value={num(acq.filter((c) => c.included).length)} />
          <Stat label="Suggested market value (median)" value={money(suggested, { compact: true })} sub="COMPARABLE-DERIVED — not a valuation" />
          <Stat
            label="Combined existing property value"
            value={money(analysis.combinedExistingValue, { compact: true })}
            sub="Acquisition-property estimates counted once"
          />
          <Stat label="Data quality" value="Manual / demo" sub="Ready for licensed provider later" />
        </div>
      )}

      {sub === "EXIT" && (
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
      )}

      <Panel title={sub === "ACQUISITION" ? "Acquisition comparable sales" : "Exit / apartment comparable sales"} bodyClassName="p-0">
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
              <CompRow key={c.id} c={c} sub={sub} onPatch={(patch) => api(`/api/opportunities/${dto.id}/comps/${c.id}`, { method: "PATCH", body: JSON.stringify(patch) })} onDelete={() => api(`/api/opportunities/${dto.id}/comps/${c.id}`, { method: "DELETE" })} />
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-muted">
                  No {sub.toLowerCase()} comps yet. Add a manual comparable — do not paste scraped commercial listings.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Panel>
    </div>
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
