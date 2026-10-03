"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { OPPORTUNITY_STATUSES } from "@/lib/constants";
import { date, money, pct, sqm } from "@/lib/format";
import { Badge, Button, DemoFinancialBadge, ProgressBar, ScoreBadge, Select, cx } from "@/components/ui";

interface Row {
  id: string;
  name: string;
  status: (typeof OPPORTUNITY_STATUSES)[number];
  suburb: string | null;
  lga: string | null;
  demoFinancialData: boolean;
  lotCount: number;
  totalSiteArea: number | null;
  score: number | null;
  grv: number | null;
  maxLandBudget: number | null;
  profit: number | null;
  marginOnCost: number | null;
  combinedMarketValue: number | null;
  acquisitionHeadroom: number | null;
  acquisitionHeadroomPercent: number | null;
  unitCount: number | null;
  acquisitionProgress: number;
  controlledCount: number;
  updatedAt: string;
}

type SortKey = "name" | "suburb" | "lotCount" | "totalSiteArea" | "score" | "grv" | "maxLandBudget" | "acquisitionHeadroom" | "profit" | "acquisitionProgress" | "status" | "updatedAt";

const COLUMNS: { key: SortKey; label: string; right?: boolean }[] = [
  { key: "name", label: "Opportunity" },
  { key: "suburb", label: "Location" },
  { key: "lotCount", label: "Lots", right: true },
  { key: "totalSiteArea", label: "Site area", right: true },
  { key: "score", label: "Score", right: true },
  { key: "grv", label: "GRV", right: true },
  { key: "maxLandBudget", label: "Max payable", right: true },
  { key: "acquisitionHeadroom", label: "Headroom", right: true },
  { key: "profit", label: "Potential profit", right: true },
  { key: "acquisitionProgress", label: "Acquisition progress" },
  { key: "status", label: "Status" },
  { key: "updatedAt", label: "Updated" },
];

export function OpportunitiesTable() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [status, setStatus] = useState<string>("ALL");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "updatedAt", dir: -1 });

  useEffect(() => {
    import("@/lib/api-json")
      .then(({ fetchApiJson }) => fetchApiJson<Row[]>("/api/opportunities"))
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

  const shown = useMemo(() => {
    if (!rows) return [];
    const ql = q.trim().toLowerCase();
    return rows
      .filter((r) => (status === "ALL" || r.status === status) && (!ql || `${r.name} ${r.suburb} ${r.lga}`.toLowerCase().includes(ql)))
      .sort((a, b) => {
        const x = a[sort.key] ?? -Infinity;
        const y = b[sort.key] ?? -Infinity;
        return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
      });
  }, [rows, status, q, sort]);

  async function remove(id: string) {
    if (!confirm("Delete this opportunity? Saved parcels remain in the database.")) return;
    await fetch(`/api/opportunities/${id}`, { method: "DELETE" });
    setRows((r) => r?.filter((x) => x.id !== id) ?? null);
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-[19px] font-semibold">Opportunities</h1>
          <p className="text-[12px] text-muted">Saved assemblies with their latest base-case feasibility.</p>
        </div>
        <div className="flex items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name or suburb" className="h-8 w-56 rounded-[3px] border border-line bg-white px-2" />
          <Select value={status} onChange={setStatus} options={[{ value: "ALL", label: "All statuses" }, ...OPPORTUNITY_STATUSES.map((s) => ({ value: s, label: s[0] + s.slice(1).toLowerCase() }))]} />
          <Link href="/map">
            <Button variant="primary">Find on map</Button>
          </Link>
        </div>
      </div>
      <div className="overflow-x-auto rounded-[3px] border border-line bg-white">
        <table className="num w-full text-[12.5px]">
          <thead className="bg-canvas text-[10.5px] uppercase tracking-wide text-muted">
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} className={cx("cursor-pointer select-none whitespace-nowrap px-3 py-2", c.right ? "text-right" : "text-left")} onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) : -1 }))}>
                  {c.label}
                  {sort.key === c.key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows === null && (
              <tr>
                <td colSpan={12} className="px-3 py-6 text-center text-muted">
                  Loading…
                </td>
              </tr>
            )}
            {rows && shown.length === 0 && (
              <tr>
                <td colSpan={12} className="px-3 py-6 text-center text-muted">
                  No opportunities yet. Use Find assemblies on the map.
                </td>
              </tr>
            )}
            {shown.map((r) => (
              <tr key={r.id} className="border-t border-line hover:bg-canvas/60">
                <td className="px-3 py-2">
                  <Link href={`/opportunities/${r.id}`} className="font-semibold text-brand hover:underline">
                    {r.name}
                  </Link>
                  {r.demoFinancialData && (
                    <span className="ml-2">
                      <DemoFinancialBadge />
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {r.suburb ?? "—"}
                  <div className="text-[11px] text-muted">{r.lga}</div>
                </td>
                <td className="px-3 py-2 text-right">{r.lotCount}</td>
                <td className="px-3 py-2 text-right">{sqm(r.totalSiteArea)}</td>
                <td className="px-3 py-2 text-right">
                  <ScoreBadge score={r.score} />
                </td>
                <td className="px-3 py-2 text-right">{money(r.grv, { compact: true })}</td>
                <td className="px-3 py-2 text-right font-semibold text-brand">{money(r.maxLandBudget, { compact: true })}</td>
                <td className="px-3 py-2 text-right font-semibold text-good">
                  {money(r.acquisitionHeadroom, { compact: true })}
                  <div className="text-[11px] text-muted">{pct(r.acquisitionHeadroomPercent, 0)}</div>
                </td>
                <td className="px-3 py-2 text-right">
                  {money(r.profit, { compact: true })}
                  <div className="text-[11px] text-muted">{pct(r.marginOnCost)} MoC</div>
                </td>
                <td className="w-40 px-3 py-2">
                  <ProgressBar value={r.acquisitionProgress} />
                  <div className="mt-0.5 text-[11px] text-muted">
                    {r.controlledCount}/{r.lotCount} controlled
                  </div>
                </td>
                <td className="px-3 py-2">
                  <Badge tone={r.status === "REJECTED" ? "bad" : r.status === "CONTROLLED" || r.status === "FEASIBLE" ? "good" : r.status === "ACQUIRING" ? "brand" : "neutral"}>{r.status}</Badge>
                </td>
                <td className="px-3 py-2 text-[11.5px] text-muted">{date(r.updatedAt)}</td>
                <td className="px-3 py-2 text-right">
                  <button className="text-[11px] text-muted hover:text-bad" onClick={() => remove(r.id)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
