"use client";

import { useEffect, useState } from "react";
import { useOpportunity } from "./context";
import { Badge, Panel } from "@/components/ui";
import { fetchApiJson } from "@/lib/api-json";

type Event = {
  id: string;
  kind: string;
  title: string;
  summary?: string | null;
  createdAt: string;
};

export function HistoryPanel() {
  const { dto } = useOpportunity();
  const [events, setEvents] = useState<Event[]>([]);

  useEffect(() => {
    fetchApiJson<{ events: Event[] }>(`/api/opportunities/${dto.id}/history`)
      .then((b) => setEvents(b.events))
      .catch(() => setEvents([]));
  }, [dto.id, dto.updatedAt]);

  return (
    <Panel title="Change history">
      {!events.length ? (
        <p className="text-[12px] text-muted">No recorded changes yet. Recalculations, sales and planning updates appear here.</p>
      ) : (
        <ol className="space-y-2">
          {events.map((e) => (
            <li key={e.id} className="border-l-2 border-line pl-3 text-[12.5px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-muted">{new Date(e.createdAt).toLocaleString("en-AU")}</span>
                <Badge>{e.kind.replaceAll("_", " ")}</Badge>
              </div>
              <div className="font-semibold">{e.title}</div>
              {e.summary && <div className="text-muted">{e.summary}</div>}
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
