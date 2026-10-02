"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button, Panel, ScoreBadge, cx } from "@/components/ui";
import { fsr } from "@/lib/format";
import { RADAR_WEIGHTS, type PrecinctRadarRowDTO } from "@/lib/analysis/radar-shared";

export function RadarClient() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [precincts, setPrecincts] = useState<PrecinctRadarRowDTO[]>([]);
  const [messages, setMessages] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/radar?limit=5");
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Radar failed");
        if (!cancelled) {
          setPrecincts(body.precincts ?? []);
          setMessages(body.messages ?? []);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">Opportunity Radar</h1>
        <p className="mt-1 max-w-2xl text-[13px] text-muted">
          Where should you search next? Precincts are ranked from official nominated centres (Housing SEPP Town Centres Map) and live EPI parcel samples — not vague “untapped suburb” guesses.
        </p>
      </div>

      <Panel title="Score weights (V1 — planning-led)">
        <div className="flex flex-wrap gap-2 text-[11.5px]">
          {Object.entries(RADAR_WEIGHTS).map(([k, v]) => (
            <Badge key={k} tone={k === "developmentActivity" ? "warn" : "neutral"}>
              {k}: {Math.round(v * 100)}%{k === "developmentActivity" ? " (reserved)" : ""}
            </Badge>
          ))}
        </div>
      </Panel>

      {messages.map((m) => (
        <div key={m} className="rounded-[3px] border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-950">
          {m}
        </div>
      ))}

      {loading && <div className="text-[13px] text-muted">Sampling precincts and planning controls…</div>}
      {error && <div className="rounded-[3px] border border-red-200 bg-red-50 p-3 text-[13px] text-bad">{error}</div>}

      <div className="space-y-3">
        {precincts.map((p, i) => (
          <div key={p.precinctId} className={cx("rounded-[3px] border border-line bg-white p-4")}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Precinct {String.fromCharCode(65 + i)}</div>
                <h2 className="text-[16px] font-semibold">{p.name}</h2>
                <p className="mt-1 text-[12px] text-muted">
                  Sample {p.sampleParcels} parcels · {p.eligibleResidential} residential · mean LEP FSR {p.meanLepFsr != null ? fsr(p.meanLepFsr) : "—"} → modelled{" "}
                  {p.meanModelledFsr != null ? fsr(p.meanModelledFsr) : "—"} (uplift {p.meanFsrUplift.toFixed(2)})
                </p>
              </div>
              <ScoreBadge score={p.score} />
            </div>
            <ul className="mt-2 space-y-0.5 text-[12px]">
              {p.summary.map((s) => (
                <li key={s} className="text-muted">
                  · {s}
                </li>
              ))}
            </ul>
            <div className="num mt-3 grid grid-cols-3 gap-2 text-[11px] sm:grid-cols-6">
              {(
                [
                  ["Uplift", p.components.planningUplift],
                  ["Underdev", p.components.underdevelopment],
                  ["Assembly", p.components.assemblyFriendly],
                  ["Constraints", p.components.constraintBurden],
                  ["Centre", p.components.centreProximity],
                  ["Activity", p.components.developmentActivity],
                ] as const
              ).map(([label, val]) => (
                <div key={label}>
                  <div className="text-[10px] uppercase text-muted">{label}</div>
                  <div className="font-semibold">{val == null ? "n/a" : val}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  const q = encodeURIComponent(p.centre.label.replace(/ shopping centre| town centre/i, "").trim() || p.centre.label);
                  router.push(`/map?scan=${q}`);
                }}
              >
                Scan precinct
              </Button>
              <Link href="/map" className="inline-flex h-8 items-center rounded-[3px] border border-line px-2.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted hover:text-ink">
                Open map
              </Link>
            </div>
          </div>
        ))}
      </div>

      {!loading && !precincts.length && !error && <p className="text-[13px] text-muted">No precinct samples available right now.</p>}
    </div>
  );
}
