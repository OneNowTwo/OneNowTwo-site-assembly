/**
 * Link Source Watcher change events to watched sites that intersect
 * PlanningChangeArea / KeySite envelopes.
 */

import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { pointInBBox } from "./geometry";
import type { BBox, DiffEvent, NormalisedSourcePayload } from "./types";

function asBBox(raw: unknown): BBox | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  if (
    typeof b.west === "number" &&
    typeof b.south === "number" &&
    typeof b.east === "number" &&
    typeof b.north === "number"
  ) {
    return { west: b.west, south: b.south, east: b.east, north: b.north };
  }
  return null;
}

function eventBBox(event: DiffEvent): BBox | null {
  const g = event.geometry;
  if (!g) return null;
  if (typeof g === "object" && g !== null && "west" in (g as object)) return asBBox(g);
  return null;
}

function payloadBBoxes(normalised: NormalisedSourcePayload | null | undefined): BBox[] {
  const out: BBox[] = [];
  for (const area of normalised?.planningChangeAreas ?? []) {
    if (area.bbox) out.push(area.bbox);
    for (const site of area.keySites ?? []) {
      if (site.bbox) out.push(site.bbox);
    }
  }
  return out;
}

/** Attach matching watchItemIds onto events (mutates copies) and return enriched events. */
export async function linkEventsToWatches(
  events: DiffEvent[],
  normalised?: NormalisedSourcePayload | null,
): Promise<DiffEvent[]> {
  if (!events.length) return events;
  const watches = await prisma.watchItem.findMany({
    where: { active: true },
    select: { id: true, label: true, bbox: true, externalParcelId: true, opportunityId: true },
    take: 500,
  });
  if (!watches.length) return events;

  const areaBoxes = payloadBBoxes(normalised);

  return events.map((event) => {
    const box = eventBBox(event) ?? areaBoxes[0] ?? null;
    if (!box) return event;
    const matched: string[] = [];
    for (const w of watches) {
      const wb = asBBox(w.bbox);
      if (!wb) continue;
      const cx = (wb.west + wb.east) / 2;
      const cy = (wb.south + wb.north) / 2;
      if (pointInBBox(cx, cy, box)) matched.push(w.id);
    }
    if (!matched.length) return event;
    return {
      ...event,
      payload: {
        ...(typeof event.payload === "object" && event.payload ? event.payload : {}),
        watchItemIds: matched,
        watchedSites: watches.filter((w) => matched.includes(w.id)).map((w) => ({
          id: w.id,
          label: w.label,
          opportunityId: w.opportunityId,
        })),
      },
      summary: `${event.summary} · ${matched.length} watched site(s) affected`,
    };
  });
}

/** Persist watchItemIds JSON on IntelChangeEvent after create. */
export async function attachWatchIdsToEvent(eventId: string, watchItemIds: string[]) {
  if (!watchItemIds.length) return;
  await prisma.intelChangeEvent.update({
    where: { id: eventId },
    data: { watchItemIds: watchItemIds as unknown as Prisma.InputJsonValue },
  });
}
