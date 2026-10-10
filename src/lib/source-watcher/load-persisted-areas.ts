/**
 * Production source of truth for proposed planning UI:
 * Source Watcher → persisted PlanningChangeArea / KeySite → APIs.
 * Fixtures remain for unit tests and empty-DB fallback only.
 */

import { prisma } from "@/lib/db";
import type {
  BBox,
  GeometrySource,
  KeySiteCondition,
  KeySiteFact,
  PlanningChangeAreaFact,
  ProposedControls,
} from "./types";
import { loadFixturePlanningAreas } from "./key-sites";

export type ProposedAreasSource = "persisted" | "fixture_fallback";

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

function asGeometry(raw: unknown): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  if (!raw || typeof raw !== "object") return null;
  const g = raw as { type?: string };
  if (g.type === "Polygon" || g.type === "MultiPolygon") {
    return raw as GeoJSON.Polygon | GeoJSON.MultiPolygon;
  }
  return null;
}

function asStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string");
}

function parseHintsAndIds(raw: unknown): { hints: string[]; ids: string[] } {
  if (Array.isArray(raw)) return { hints: asStringArray(raw), ids: [] };
  if (raw && typeof raw === "object") {
    const o = raw as { hints?: unknown; ids?: unknown; parcelIds?: unknown };
    return {
      hints: asStringArray(o.hints),
      ids: asStringArray(o.ids ?? o.parcelIds),
    };
  }
  return { hints: [], ids: [] };
}

function parseConditions(raw: unknown): { strings: string[]; structured: KeySiteCondition[] } {
  if (!Array.isArray(raw)) return { strings: [], structured: [] };
  const strings: string[] = [];
  const structured: KeySiteCondition[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      strings.push(item);
      continue;
    }
    if (item && typeof item === "object") {
      const c = item as KeySiteCondition;
      if (typeof c.type === "string") {
        structured.push(c);
        strings.push(c.description ?? c.value ?? c.type);
      }
    }
  }
  return { strings, structured };
}

/** Load persisted proposed areas; fall back to fixtures only when DB has none. */
export async function loadProposedPlanningAreas(): Promise<{
  areas: PlanningChangeAreaFact[];
  source: ProposedAreasSource;
}> {
  try {
    const rows = await prisma.planningChangeArea.findMany({
      include: { keySites: true },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
    if (rows.length) {
      const areas: PlanningChangeAreaFact[] = rows.map((row) => {
        const proposedControls = (row.proposedControls ?? {}) as unknown as ProposedControls & {
          geometrySource?: GeometrySource;
          structuredDataStatus?: string;
          documentHash?: string;
        };
        return {
          id: row.id,
          title: row.title,
          status: row.status,
          authority: row.authority,
          lgas: row.lgas,
          suburbs: row.suburbs,
          sourceUrl: row.sourceUrl,
          exhibitionEnd: row.exhibitionEnd?.toISOString() ?? null,
          bbox: asBBox(row.bbox),
          geometry: asGeometry(row.geometry),
          proposedControls,
          keySites: row.keySites.map((site): KeySiteFact => {
            const { hints, ids } = parseHintsAndIds(site.requiredParcelHints);
            const idBag = parseHintsAndIds(site.optionalParcelHints);
            const { strings, structured } = parseConditions(site.conditions);
            const siteControls = (site.proposedControls ?? null) as
              | (ProposedControls & { geometrySource?: GeometrySource })
              | null;
            return {
              externalKeySiteId: site.externalKeySiteId,
              name: site.name,
              bbox: asBBox(site.bbox),
              geometry: asGeometry(site.geometry),
              geometrySource: siteControls?.geometrySource ?? proposedControls.geometrySource ?? null,
              requiredParcelHints: hints,
              requiredParcelIds: ids.length ? ids : idBag.ids,
              optionalParcelHints: idBag.hints,
              currentControls: (site.currentControls ?? null) as ProposedControls | null,
              proposedControls: siteControls,
              incentiveControls: (site.incentiveControls ?? null) as ProposedControls | null,
              requirements: asStringArray(site.requirements),
              conditions: strings,
              structuredConditions: structured.length ? structured : undefined,
            };
          }),
        };
      });
      return { areas, source: "persisted" };
    }
  } catch {
    // DB unavailable — fall through to fixtures.
  }
  return { areas: loadFixturePlanningAreas(), source: "fixture_fallback" };
}
