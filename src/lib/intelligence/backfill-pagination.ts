/**
 * Stable pagination for out-of-band geometry backfill.
 *
 * NEVER order --all batches by geometry / updatedAt — those fields change when
 * a row is backfilled, which makes offset pages skip untouched candidates.
 * Prefer immutable `id` ascending.
 */

export type BackfillPageRow = {
  id: string;
  /** Mutating these must not affect id-ordered pages. */
  geometry?: unknown;
  updatedAt?: Date | string | null;
  address?: string | null;
};

/** Prisma orderBy for --all (and any offset batch that must be resume-safe). */
export const STABLE_BACKFILL_ORDER_BY = [{ id: "asc" as const }];

/** Pure page slice under immutable id ordering. */
export function stableBackfillPageIds(
  rows: BackfillPageRow[],
  limit: number,
  offset: number,
): string[] {
  return [...rows]
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(offset, offset + limit)
    .map((r) => r.id);
}

/**
 * Simulate sequential offset batches. After each page, optionally "write"
 * geometry/updatedAt on those rows — sequence must stay identical.
 */
export function stableBackfillPageSequence(
  rows: BackfillPageRow[],
  limit: number,
  mutateWritten = true,
): string[][] {
  const working = rows.map((r) => ({ ...r }));
  const pages: string[][] = [];
  let offset = 0;
  for (;;) {
    const page = stableBackfillPageIds(working, limit, offset);
    if (!page.length) break;
    pages.push(page);
    if (mutateWritten) {
      const written = new Set(page);
      for (const row of working) {
        if (!written.has(row.id)) continue;
        row.geometry = { type: "Polygon", coordinates: [] };
        row.updatedAt = new Date().toISOString();
      }
    }
    offset += limit;
    if (page.length < limit) break;
  }
  return pages;
}
