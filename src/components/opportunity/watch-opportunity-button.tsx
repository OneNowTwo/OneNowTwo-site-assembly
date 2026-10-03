"use client";

import { useState } from "react";
import { useOpportunity } from "./context";
import { Button } from "@/components/ui";
import { fetchApiJson } from "@/lib/api-json";

export function WatchOpportunityButton() {
  const { dto } = useOpportunity();
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function watch() {
    setBusy(true);
    try {
      await fetchApiJson("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "OPPORTUNITY",
          label: dto.name,
          suburb: dto.suburb,
          opportunityId: dto.id,
          scanCadence: "DAILY",
        }),
      });
      setDone(true);
    } catch {
      // soft fail
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" disabled={busy || done} onClick={watch}>
      {done ? "Watching" : "Watch assembly"}
    </Button>
  );
}
