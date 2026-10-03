"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Panel } from "@/components/ui";
import { fetchApiJson } from "@/lib/api-json";

type Rule = {
  id: string;
  name: string;
  active: boolean;
  criteria: Record<string, unknown>;
  events?: { id: string; title: string; summary?: string | null; createdAt: string; href?: string | null }[];
};

export function AlertsClient() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [name, setName] = useState("Manly Vale score > 75");
  const [suburb, setSuburb] = useState("Manly Vale");
  const [minScore, setMinScore] = useState("75");
  const [minHeadroom, setMinHeadroom] = useState("1000000");
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const body = await fetchApiJson<{ rules: Rule[] }>("/api/alerts");
    setRules(body.rules);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const body = await fetchApiJson<{ rules: Rule[] }>("/api/alerts");
        if (!cancelled) setRules(body.rules);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function create() {
    setError(null);
    try {
      await fetchApiJson("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          criteria: {
            suburb: suburb || undefined,
            minScore: minScore ? Number(minScore) : undefined,
            minHeadroom: minHeadroom ? Number(minHeadroom) : undefined,
            newAssembly: true,
          },
        }),
      });
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function toggle(id: string, active: boolean) {
    await fetchApiJson(`/api/alerts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !active }),
    });
    await reload();
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-4">
        <h1 className="text-[19px] font-semibold">Alert rules</h1>
        <p className="text-[12px] text-muted">In-app first. Structure supports email/push later without changing criteria storage.</p>
      </div>

      <Panel title="Create alert" className="mb-4">
        <div className="grid gap-2 md:grid-cols-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Alert name" className="h-8 w-full rounded-[3px] border border-line bg-white px-2 text-[12.5px]" />
          <input value={suburb} onChange={(e) => setSuburb(e.target.value)} placeholder="Suburb (optional)" className="h-8 w-full rounded-[3px] border border-line bg-white px-2 text-[12.5px]" />
          <input value={minScore} onChange={(e) => setMinScore(e.target.value)} placeholder="Min score" className="h-8 w-full rounded-[3px] border border-line bg-white px-2 text-[12.5px]" />
          <input value={minHeadroom} onChange={(e) => setMinHeadroom(e.target.value)} placeholder="Min headroom $" className="h-8 w-full rounded-[3px] border border-line bg-white px-2 text-[12.5px]" />
        </div>
        <div className="mt-3">
          <Button variant="primary" onClick={create}>
            Save rule
          </Button>
        </div>
        {error && <p className="mt-2 text-[12px] text-bad">{error}</p>}
      </Panel>

      <Panel title={`Rules (${rules.length})`}>
        <ul className="divide-y divide-line">
          {rules.map((r) => (
            <li key={r.id} className="py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold">{r.name}</span>
                    <Badge tone={r.active ? "good" : "neutral"}>{r.active ? "Active" : "Paused"}</Badge>
                    <Badge>IN APP</Badge>
                  </div>
                  <pre className="mt-1 overflow-x-auto text-[11px] text-muted">{JSON.stringify(r.criteria, null, 0)}</pre>
                </div>
                <Button size="sm" onClick={() => toggle(r.id, r.active)}>
                  {r.active ? "Pause" : "Resume"}
                </Button>
              </div>
              {!!r.events?.length && (
                <ul className="mt-2 space-y-1 border-t border-line pt-2 text-[12px]">
                  {r.events.map((e) => (
                    <li key={e.id} className="text-muted">
                      {new Date(e.createdAt).toLocaleString("en-AU")} — {e.summary ?? e.title}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
          {!rules.length && <li className="py-4 text-[12px] text-muted">No alert rules yet.</li>}
        </ul>
      </Panel>
    </div>
  );
}
