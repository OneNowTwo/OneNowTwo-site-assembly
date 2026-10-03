"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Panel, Select } from "@/components/ui";
import { money } from "@/lib/format";
import { fetchApiJson } from "@/lib/api-json";

type FeedItem = {
  id: string;
  kind: string;
  title: string;
  summary?: string | null;
  href?: string | null;
  score?: number | null;
  headroom?: number | null;
  maxPayable?: number | null;
  scoreDelta?: number | null;
  headroomDelta?: number | null;
  createdAt: string;
  opportunity?: { name: string; suburb?: string | null } | null;
};

export function FeedClient() {
  const [sort, setSort] = useState("importance");
  const [kind, setKind] = useState("ALL");
  const [items, setItems] = useState<FeedItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const q = new URLSearchParams({ sort, limit: "60" });
    if (kind !== "ALL") q.set("kind", kind);
    void (async () => {
      try {
        const body = await fetchApiJson<{ items: FeedItem[] }>(`/api/feed?${q}`);
        if (!cancelled) setItems(body.items);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sort, kind]);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[19px] font-semibold">Opportunity feed</h1>
          <p className="text-[12px] text-muted">New · improved · declined · planning · sales · watchlist.</p>
        </div>
        <div className="flex gap-2">
          <Select
            value={kind}
            onChange={setKind}
            options={[
              { value: "ALL", label: "All kinds" },
              { value: "NEW", label: "New" },
              { value: "IMPROVED", label: "Improved" },
              { value: "DECLINED", label: "Declined" },
              { value: "PLANNING_CHANGE", label: "Planning" },
              { value: "NEW_SALE", label: "Sales" },
              { value: "WATCHLIST_CHANGE", label: "Watchlist" },
              { value: "ALERT", label: "Alerts" },
            ]}
          />
          <Select
            value={sort}
            onChange={setSort}
            options={[
              { value: "importance", label: "Most meaningful" },
              { value: "headroom", label: "Biggest headroom move" },
              { value: "score_delta", label: "Largest score improvement" },
              { value: "newest", label: "Newest" },
              { value: "score", label: "Highest score" },
              { value: "max_payable", label: "Largest max payable" },
            ]}
          />
        </div>
      </div>

      {error && <p className="mb-3 text-[12px] text-bad">{error}</p>}

      <Panel>
        <ul className="divide-y divide-line">
          {items.map((f) => (
            <li key={f.id} className="flex items-start justify-between gap-4 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{f.kind.replaceAll("_", " ")}</Badge>
                  {f.href ? (
                    <Link href={f.href} className="text-[13px] font-semibold hover:text-brand">
                      {f.title}
                    </Link>
                  ) : (
                    <span className="text-[13px] font-semibold">{f.title}</span>
                  )}
                </div>
                {f.summary && <p className="mt-1 text-[12px] text-muted">{f.summary}</p>}
                <div className="mt-1 text-[11px] text-muted">{new Date(f.createdAt).toLocaleString("en-AU")}</div>
              </div>
              <div className="shrink-0 text-right text-[11.5px] num">
                {f.score != null && <div>Score {f.score}{f.scoreDelta != null ? ` (${f.scoreDelta >= 0 ? "+" : ""}${f.scoreDelta})` : ""}</div>}
                {f.headroom != null && <div>{money(f.headroom, { compact: true })}{f.headroomDelta != null ? ` (${f.headroomDelta >= 0 ? "+" : ""}${money(f.headroomDelta, { compact: true })})` : ""}</div>}
                {f.maxPayable != null && <div className="text-muted">Max {money(f.maxPayable, { compact: true })}</div>}
              </div>
            </li>
          ))}
          {!items.length && <li className="py-6 text-[12px] text-muted">Feed is empty — save watch areas or run monitoring.</li>}
        </ul>
      </Panel>
    </div>
  );
}
