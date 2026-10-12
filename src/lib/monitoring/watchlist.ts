import { prisma } from "@/lib/db";
import type { Prisma, ScanCadence, WatchItemKind } from "@/generated/prisma/client";
import { watchFiltersSchema, type WatchFilters, type BBoxJson } from "./types";
import { publishFeedItem } from "./feed";

function nextScanAt(cadence: ScanCadence, from = new Date()): Date | null {
  if (cadence === "MANUAL") return null;
  const d = new Date(from);
  if (cadence === "DAILY") d.setUTCDate(d.getUTCDate() + 1);
  if (cadence === "WEEKLY") d.setUTCDate(d.getUTCDate() + 7);
  d.setUTCHours(20, 0, 0, 0); // ~7am AEST
  return d;
}

export async function listWatchItems(userId: string) {
  return prisma.watchItem.findMany({
    where: { userId, active: true },
    orderBy: { updatedAt: "desc" },
    include: { opportunity: { select: { id: true, name: true, status: true, score: true, acquisitionHeadroom: true } } },
  });
}

export async function createWatchItem(input: {
  userId: string;
  kind: WatchItemKind;
  label: string;
  suburb?: string | null;
  bbox?: BBoxJson | null;
  precinctId?: string | null;
  externalParcelId?: string | null;
  opportunityId?: string | null;
  filters?: WatchFilters;
  notes?: string | null;
  scanCadence?: ScanCadence;
}) {
  const filters = watchFiltersSchema.parse(input.filters ?? {});
  const cadence = input.scanCadence ?? "MANUAL";
  const item = await prisma.watchItem.create({
    data: {
      userId: input.userId,
      kind: input.kind,
      label: input.label.trim(),
      suburb: input.suburb ?? null,
      bbox: (input.bbox ?? undefined) as Prisma.InputJsonValue | undefined,
      precinctId: input.precinctId ?? null,
      externalParcelId: input.externalParcelId ?? null,
      opportunityId: input.opportunityId ?? null,
      filters: filters as Prisma.InputJsonValue,
      notes: input.notes ?? null,
      scanCadence: cadence,
      nextScanAt: nextScanAt(cadence),
    },
  });
  await publishFeedItem({
    kind: "WATCHLIST_CHANGE",
    title: `Watching ${item.label}`,
    summary: `${item.kind.replaceAll("_", " ").toLowerCase()} added to watchlist`,
    watchItemId: item.id,
    opportunityId: item.opportunityId,
    href: item.opportunityId ? `/opportunities/${item.opportunityId}` : "/watching",
    importance: 1,
  });
  return item;
}

export async function updateWatchItem(
  id: string,
  userId: string,
  patch: Partial<{
    label: string;
    filters: WatchFilters;
    notes: string | null;
    scanCadence: ScanCadence;
    active: boolean;
    bbox: BBoxJson | null;
  }>,
) {
  const existing = await prisma.watchItem.findFirst({ where: { id, userId } });
  if (!existing) return null;
  const cadence = patch.scanCadence ?? existing.scanCadence;
  return prisma.watchItem.update({
    where: { id },
    data: {
      label: patch.label?.trim(),
      filters: patch.filters ? (watchFiltersSchema.parse(patch.filters) as Prisma.InputJsonValue) : undefined,
      notes: patch.notes === undefined ? undefined : patch.notes,
      scanCadence: patch.scanCadence,
      active: patch.active,
      bbox: patch.bbox === undefined ? undefined : ((patch.bbox ?? null) as Prisma.InputJsonValue),
      nextScanAt: patch.scanCadence ? nextScanAt(cadence) : undefined,
    },
  });
}

export async function deleteWatchItem(id: string, userId: string) {
  const existing = await prisma.watchItem.findFirst({ where: { id, userId } });
  if (!existing) return false;
  await prisma.watchItem.update({ where: { id }, data: { active: false } });
  return true;
}

/**
 * Fresh accounts start with an empty watchlist.
 * Do NOT seed historic test suburbs (Manly Vale / Neutral Bay / Mosman) or random opportunities —
 * those biased Today toward development history.
 */
export async function ensureDefaultWatchlist(userId: string) {
  void userId;
  // Intentionally no-op: Harry's clean start must not inherit test geography.
}
