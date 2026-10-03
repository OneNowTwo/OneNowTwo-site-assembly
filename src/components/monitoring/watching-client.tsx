"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Button, Panel, Select } from "@/components/ui";
import { fetchApiJson } from "@/lib/api-json";

type WatchItem = {
  id: string;
  kind: string;
  label: string;
  suburb?: string | null;
  scanCadence: string;
  scanStatus: string;
  lastScanAt?: string | null;
  nextScanAt?: string | null;
  opportunityId?: string | null;
  filters?: Record<string, unknown>;
  notes?: string | null;
};

export function WatchingClient() {
  const [items, setItems] = useState<WatchItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState("SUBURB");
  const [cadence, setCadence] = useState("WEEKLY");
  const [busy, setBusy] = useState(false);

  async function reload() {
    const body = await fetchApiJson<{ items: WatchItem[] }>("/api/watchlist");
    setItems(body.items);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const body = await fetchApiJson<{ items: WatchItem[] }>("/api/watchlist");
        if (!cancelled) setItems(body.items);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function add() {
    if (label.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      await fetchApiJson("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          label: label.trim(),
          suburb: kind === "SUBURB" || kind === "MAP_AREA" ? label.trim() : undefined,
          scanCadence: cadence,
        }),
      });
      setLabel("");
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await fetchApiJson(`/api/watchlist/${id}`, { method: "DELETE" });
    await reload();
  }

  async function scanNow(id: string) {
    setBusy(true);
    try {
      await fetchApiJson(`/api/watchlist/${id}/scan`, { method: "POST" });
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-4">
        <h1 className="text-[19px] font-semibold">Watching</h1>
        <p className="text-[12px] text-muted">Saved suburbs, map areas, precincts, parcels and assemblies — with optional daily/weekly re-scan.</p>
      </div>

      <Panel title="Add to watchlist" className="mb-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-40">
            <Select
              value={kind}
              onChange={setKind}
              options={[
                { value: "SUBURB", label: "Suburb" },
                { value: "MAP_AREA", label: "Map area" },
                { value: "PRECINCT", label: "Precinct" },
                { value: "PARCEL", label: "Parcel" },
                { value: "OPPORTUNITY", label: "Assembly" },
              ]}
            />
          </div>
          <div className="min-w-[220px] flex-1">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Manly Vale or 6–8 Pitt Street"
              className="h-8 w-full rounded-[3px] border border-line bg-white px-2 text-[12.5px] outline-none focus:border-brand"
            />
          </div>
          <div className="w-36">
            <Select
              value={cadence}
              onChange={setCadence}
              options={[
                { value: "MANUAL", label: "Manual scan" },
                { value: "DAILY", label: "Daily" },
                { value: "WEEKLY", label: "Weekly" },
              ]}
            />
          </div>
          <Button variant="primary" disabled={busy} onClick={add}>
            Save
          </Button>
        </div>
        {error && <p className="mt-2 text-[12px] text-bad">{error}</p>}
      </Panel>

      <Panel title={`Watching (${items.length})`}>
        <ul className="divide-y divide-line">
          {items.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold">{w.label}</span>
                  <Badge>{w.kind.replaceAll("_", " ")}</Badge>
                  <Badge tone="live">{w.scanCadence}</Badge>
                  <Badge tone={w.scanStatus === "FAILED" ? "bad" : "neutral"}>{w.scanStatus}</Badge>
                </div>
                <div className="mt-0.5 text-[11.5px] text-muted">
                  {w.suburb ?? "—"}
                  {w.lastScanAt ? ` · last scan ${new Date(w.lastScanAt).toLocaleString("en-AU")}` : " · not scanned yet"}
                  {w.nextScanAt ? ` · next ${new Date(w.nextScanAt).toLocaleString("en-AU")}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {w.opportunityId && (
                  <Link href={`/opportunities/${w.opportunityId}`} className="text-[11px] font-semibold text-brand hover:underline">
                    Open
                  </Link>
                )}
                {["SUBURB", "MAP_AREA", "PRECINCT"].includes(w.kind) && (
                  <Button size="sm" disabled={busy} onClick={() => scanNow(w.id)}>
                    Scan now
                  </Button>
                )}
                <Button size="sm" variant="danger" onClick={() => remove(w.id)}>
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
