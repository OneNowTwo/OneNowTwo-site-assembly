import type { DiffEvent, NormalisedSourcePayload, PlanningChangeAreaFact, KeySiteFact } from "./types";

/**
 * Diff two normalised payloads into intelligence change events.
 * Unchanged content → empty array (caller must not emit duplicates).
 */
export function diffNormalisedPayloads(
  sourceId: string,
  previous: NormalisedSourcePayload | null,
  next: NormalisedSourcePayload,
): DiffEvent[] {
  if (!previous) {
    return bootstrapEvents(sourceId, next);
  }

  const events: DiffEvent[] = [];
  events.push(...diffSourceDocuments(sourceId, previous, next));

  const prevAreas = indexById(previous.planningChangeAreas ?? []);
  const nextAreas = indexById(next.planningChangeAreas ?? []);

  for (const [id, area] of nextAreas) {
    const before = prevAreas.get(id);
    if (!before) {
      events.push({
        kind: "PLANNING_PROPOSAL_CREATED",
        title: `${area.title} — proposed planning area added`,
        summary: `Status ${area.status}. Proposed controls remain PROPOSED / not current law.`,
        changeKey: `${sourceId}:area-created:${id}:${hashLite(area)}`,
        newValue: area,
        geometry: area.bbox ?? area.geometry ?? null,
        importance: 6,
        href: area.sourceUrl ?? undefined,
      });
      continue;
    }
    events.push(...diffArea(sourceId, before, area));
  }

  const prevSites = indexKeySites(previous);
  const nextSites = indexKeySites(next);
  for (const [key, site] of nextSites) {
    const before = prevSites.get(key);
    if (!before) {
      events.push({
        kind: "KEY_SITE_CREATED",
        title: `Key site ${site.externalKeySiteId} created`,
        summary: site.name,
        changeKey: `${sourceId}:key-site-created:${key}`,
        newValue: site,
        geometry: site.bbox ?? site.geometry ?? null,
        affectedParcelHints: site.requiredParcelHints,
        importance: 7,
      });
      continue;
    }
    if (JSON.stringify(before) !== JSON.stringify(site)) {
      const fsrBefore = before.incentiveControls?.incentiveFsr ?? before.proposedControls?.fsr;
      const fsrAfter = site.incentiveControls?.incentiveFsr ?? site.proposedControls?.fsr;
      if (fsrBefore !== fsrAfter) {
        events.push({
          kind: "FSR_PROPOSED_CHANGE",
          title: `Key site ${site.externalKeySiteId}: proposed FSR ${fsrBefore ?? "—"} → ${fsrAfter ?? "—"}`,
          summary: `${site.name}. PROPOSED only — not current law.`,
          changeKey: `${sourceId}:fsr:${key}:${fsrBefore}->${fsrAfter}`,
          oldValue: { fsr: fsrBefore },
          newValue: { fsr: fsrAfter },
          geometry: site.bbox ?? site.geometry ?? null,
          affectedParcelHints: site.requiredParcelHints,
          importance: 8,
        });
      }
      const reqBefore = JSON.stringify(before.requirements ?? []);
      const reqAfter = JSON.stringify(site.requirements ?? []);
      if (reqBefore !== reqAfter) {
        events.push({
          kind: "ASSEMBLY_REQUIREMENT_CHANGED",
          title: `Key site ${site.externalKeySiteId}: assembly requirements changed`,
          summary: site.name,
          changeKey: `${sourceId}:assembly:${key}:${hashLite(site.requirements)}`,
          oldValue: before.requirements,
          newValue: site.requirements,
          affectedParcelHints: site.requiredParcelHints,
          importance: 7,
        });
      }
      if (!events.some((e) => e.changeKey.includes(`:${key}:`) || e.changeKey.includes(`:${key}`))) {
        events.push({
          kind: "KEY_SITE_CHANGED",
          title: `Key site ${site.externalKeySiteId} updated`,
          summary: site.name,
          changeKey: `${sourceId}:key-site-changed:${key}:${hashLite(site)}`,
          oldValue: before,
          newValue: site,
          importance: 5,
        });
      }
    }
  }

  return events;
}

/** Portal / map-pack document hash changes for manually structured sources. */
function diffSourceDocuments(
  sourceId: string,
  previous: NormalisedSourcePayload,
  next: NormalisedSourcePayload,
): DiffEvent[] {
  const prevMeta = (previous.meta ?? {}) as Record<string, unknown>;
  const nextMeta = (next.meta ?? {}) as Record<string, unknown>;
  const prevDoc = typeof prevMeta.documentHash === "string" ? prevMeta.documentHash : null;
  const nextDoc = typeof nextMeta.documentHash === "string" ? nextMeta.documentHash : null;
  const prevPortal =
    prevMeta.livePortal && typeof prevMeta.livePortal === "object"
      ? ((prevMeta.livePortal as { bodyHash?: string | null }).bodyHash ?? null)
      : null;
  const nextPortal =
    nextMeta.livePortal && typeof nextMeta.livePortal === "object"
      ? ((nextMeta.livePortal as { bodyHash?: string | null }).bodyHash ?? null)
      : null;

  const events: DiffEvent[] = [];
  if (prevDoc && nextDoc && prevDoc !== nextDoc) {
    events.push({
      kind: "SOURCE_DOCUMENT_CHANGED",
      title: `SOURCE_DOCUMENT_CHANGED — structured map pack updated`,
      summary: `Document hash ${prevDoc.slice(0, 8)}… → ${nextDoc.slice(0, 8)}…. Structured controls refreshed.`,
      changeKey: `${sourceId}:document-hash:${prevDoc}->${nextDoc}`,
      oldValue: { documentHash: prevDoc },
      newValue: { documentHash: nextDoc, structuredDataStatus: nextMeta.structuredDataStatus },
      importance: 8,
    });
  } else if (prevPortal && nextPortal && prevPortal !== nextPortal) {
    const stale = nextMeta.needsReExtraction === true || nextMeta.structuredDataStatus === "NEEDS_RE_EXTRACTION";
    events.push({
      kind: "SOURCE_DOCUMENT_CHANGED",
      title: `SOURCE_DOCUMENT_CHANGED — official portal document changed`,
      summary: stale
        ? "Portal page changed while structured map-pack hash is unchanged. Structured proposed controls marked NEEDS_RE_EXTRACTION — do not treat as freshly extracted."
        : "Official source document / portal page changed.",
      changeKey: `${sourceId}:portal-body:${prevPortal}->${nextPortal}`,
      oldValue: { portalBodyHash: prevPortal, documentHash: prevDoc },
      newValue: {
        portalBodyHash: nextPortal,
        documentHash: nextDoc,
        structuredDataStatus: nextMeta.structuredDataStatus ?? null,
        needsReExtraction: stale,
      },
      importance: 9,
    });
  }
  return events;
}

function bootstrapEvents(sourceId: string, next: NormalisedSourcePayload): DiffEvent[] {
  const events: DiffEvent[] = [];
  for (const area of next.planningChangeAreas ?? []) {
    events.push({
      kind: "SOURCE_REFRESHED",
      title: `${area.title} — ingested (${area.status})`,
      summary: `Proposed planning intelligence loaded. Legal status remains PROPOSED / UNDER EXHIBITION — not current law.`,
      changeKey: `${sourceId}:bootstrap:${area.id}:${hashLite(area)}`,
      newValue: { status: area.status, proposedControls: area.proposedControls },
      geometry: area.bbox ?? null,
      importance: 4,
      href: area.sourceUrl ?? undefined,
    });
    for (const site of area.keySites ?? []) {
      events.push({
        kind: "KEY_SITE_CREATED",
        title: `Key site ${site.externalKeySiteId} — ${site.name}`,
        summary: `Linked to ${area.title}.`,
        changeKey: `${sourceId}:bootstrap-key:${area.id}:${site.externalKeySiteId}`,
        newValue: site,
        geometry: site.bbox ?? site.geometry ?? null,
        affectedParcelHints: site.requiredParcelHints,
        importance: 5,
      });
    }
  }
  if (!events.length) {
    events.push({
      kind: "SOURCE_REFRESHED",
      title: `Source ${sourceId} refreshed`,
      summary: "Initial snapshot stored.",
      changeKey: `${sourceId}:bootstrap:${hashLite(next)}`,
      newValue: next.meta ?? { kind: next.kind },
      importance: 2,
    });
  }
  return events;
}

function diffArea(sourceId: string, before: PlanningChangeAreaFact, after: PlanningChangeAreaFact): DiffEvent[] {
  const events: DiffEvent[] = [];
  if (before.status !== after.status) {
    events.push({
      kind: "PLANNING_STATUS_CHANGED",
      title: `${after.title}: ${before.status} → ${after.status}`,
      summary: "Planning proposal / rezoning status changed.",
      changeKey: `${sourceId}:status:${after.id}:${before.status}->${after.status}`,
      oldValue: { status: before.status },
      newValue: { status: after.status },
      geometry: after.bbox ?? null,
      importance: 7,
    });
  }
  const bf = before.proposedControls?.incentiveFsr ?? before.proposedControls?.fsr;
  const af = after.proposedControls?.incentiveFsr ?? after.proposedControls?.fsr;
  if (bf !== af) {
    events.push({
      kind: "FSR_PROPOSED_CHANGE",
      title: `${after.title}: proposed FSR ${bf ?? "—"} → ${af ?? "—"}`,
      summary: "PROPOSED FSR change — not current law.",
      changeKey: `${sourceId}:area-fsr:${after.id}:${bf}->${af}`,
      oldValue: { fsr: bf },
      newValue: { fsr: af },
      geometry: after.bbox ?? null,
      importance: 8,
    });
  }
  const bh = before.proposedControls?.incentiveHeightM ?? before.proposedControls?.heightM;
  const ah = after.proposedControls?.incentiveHeightM ?? after.proposedControls?.heightM;
  if (bh !== ah) {
    events.push({
      kind: "HEIGHT_PROPOSED_CHANGE",
      title: `${after.title}: proposed height ${bh ?? "—"} → ${ah ?? "—"} m`,
      summary: "PROPOSED height change — not current law.",
      changeKey: `${sourceId}:area-height:${after.id}:${bh}->${ah}`,
      oldValue: { heightM: bh },
      newValue: { heightM: ah },
      importance: 7,
    });
  }
  const ba = before.proposedControls?.affordableHousingContributionPct;
  const aa = after.proposedControls?.affordableHousingContributionPct;
  if (ba !== aa) {
    events.push({
      kind: "AFFORDABLE_HOUSING_RATE_CHANGED",
      title: `${after.title}: affordable housing ${pct(ba)} → ${pct(aa)}`,
      summary: "PROPOSED contribution rate change.",
      changeKey: `${sourceId}:ah:${after.id}:${ba}->${aa}`,
      oldValue: { affordableHousingContributionPct: ba },
      newValue: { affordableHousingContributionPct: aa },
      importance: 6,
    });
  }
  return events;
}

function pct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${Math.round(v * 1000) / 10}%`;
}

function indexById(areas: PlanningChangeAreaFact[]): Map<string, PlanningChangeAreaFact> {
  return new Map(areas.map((a) => [a.id, a]));
}

function indexKeySites(payload: NormalisedSourcePayload): Map<string, KeySiteFact> {
  const map = new Map<string, KeySiteFact>();
  for (const area of payload.planningChangeAreas ?? []) {
    for (const site of area.keySites ?? []) {
      map.set(`${area.id}:${site.externalKeySiteId}`, site);
    }
  }
  for (const site of payload.keySites ?? []) {
    map.set(`global:${site.externalKeySiteId}`, site);
  }
  return map;
}

function hashLite(value: unknown): string {
  const s = JSON.stringify(value) ?? "";
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}
