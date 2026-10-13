/**
 * ONE-TIME out-of-band geometry backfill for SiteCandidateIndex rows.
 *
 * Run OFF the web process (local / Render one-off job). Never via a Next.js route.
 *
 * - Exact parcel IDs only (no bbox / LMR / scan / valuation / feasibility)
 * - Concurrency 1, rate-limited, resumable/idempotent
 * - Persists Parcel geometry + SiteCandidateIndex.geometry
 *
 * IMPORTANT: default `--limit` is 1. `--all` alone still only processes 1 row unless
 * you pass an explicit `--limit`. Prefer batched runs, e.g.:
 *   --all --limit=25 --offset=0
 *   --all --limit=25 --offset=25
 *
 * Usage:
 *   npx tsx scripts/backfill-index-geometry.mts --suburb=Bexley [--limit=1]
 *   npx tsx scripts/backfill-index-geometry.mts --id=<candidateId>
 *   npx tsx scripts/backfill-index-geometry.mts --canonicalKey=<key>
 *   npx tsx scripts/backfill-index-geometry.mts --all --limit=25 [--offset=0]
 *   npx tsx scripts/backfill-index-geometry.mts --dry-run --suburb=Bexley
 */

import "dotenv/config";
import type { Prisma } from "../src/generated/prisma/client";
import { prisma } from "../src/lib/db";
import {
  capParcelIds,
  parcelsMissingDrawableGeometry,
  siteGeometryFromParcels,
} from "../src/lib/index-candidate-geometry";
import { getParcelsByExternalIds, getStoredParcelsByExternalIds } from "../src/lib/parcel-service";
import { upsertParcel } from "../src/lib/opportunity-service";

const DEFAULT_DELAY_MS = 1500;
const DEFAULT_BATCH = 10;

type Args = {
  suburb?: string;
  id?: string;
  canonicalKey?: string;
  all: boolean;
  limit: number;
  offset: number;
  delayMs: number;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    all: false,
    limit: 1,
    offset: 0,
    delayMs: DEFAULT_DELAY_MS,
    dryRun: false,
  };
  let limitExplicit = false;
  for (const a of argv) {
    if (a === "--all") args.all = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a.startsWith("--suburb=")) args.suburb = a.slice("--suburb=".length);
    else if (a.startsWith("--id=")) args.id = a.slice("--id=".length);
    else if (a.startsWith("--canonicalKey=")) args.canonicalKey = a.slice("--canonicalKey=".length);
    else if (a.startsWith("--limit=")) {
      args.limit = Math.max(1, Number(a.slice("--limit=".length)) || 1);
      limitExplicit = true;
    } else if (a.startsWith("--offset=")) args.offset = Math.max(0, Number(a.slice("--offset=".length)) || 0);
    else if (a.startsWith("--delayMs=")) args.delayMs = Math.max(0, Number(a.slice("--delayMs=".length)) || 0);
  }
  // `--all` without `--limit` used to silently process 1 row. Require an explicit batch size.
  if (args.all && !limitExplicit && !args.id && !args.canonicalKey && !args.suburb) {
    console.error(
      "Refusing --all without --limit=N. Example: --all --limit=25 --offset=0 (default limit is 1).",
    );
    process.exit(1);
  }
  return args;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function hasDrawableGeometry(geom: unknown): boolean {
  if (!geom || typeof geom !== "object") return false;
  const g = geom as { type?: string; coordinates?: unknown };
  return (g.type === "Polygon" || g.type === "MultiPolygon") && Array.isArray(g.coordinates);
}

async function backfillOne(
  row: {
    id: string;
    canonicalKey: string;
    address: string | null;
    suburb: string | null;
    parcelIds: unknown;
    geometry: unknown;
  },
  opts: { dryRun: boolean; delayMs: number },
): Promise<{
  id: string;
  suburb: string | null;
  address: string | null;
  status: "already_ok" | "success" | "partial" | "failed" | "skipped_dry";
  parcelIds: number;
  parcelsStored: number;
  hydrated: number;
  hasIndexGeometry: boolean;
  error?: string;
}> {
  const rawIds = Array.isArray(row.parcelIds)
    ? (row.parcelIds as unknown[]).map(String).filter(Boolean)
    : [];
  const parcelIds = capParcelIds(rawIds);
  const base = {
    id: row.id,
    suburb: row.suburb,
    address: row.address,
    parcelIds: parcelIds.length,
    parcelsStored: 0,
    hydrated: 0,
    hasIndexGeometry: hasDrawableGeometry(row.geometry),
  };

  if (!parcelIds.length) {
    return { ...base, status: "failed", error: "no_parcel_ids" };
  }

  // Idempotent: if index geometry + all parcels already drawable, skip NSW.
  let stored = await getStoredParcelsByExternalIds(parcelIds);
  const missing = parcelsMissingDrawableGeometry(parcelIds, stored);
  if (!missing.length && hasDrawableGeometry(row.geometry)) {
    return {
      ...base,
      status: "already_ok",
      parcelsStored: stored.filter((p) => !!p.geometry).length,
      hasIndexGeometry: true,
    };
  }
  if (!missing.length && siteGeometryFromParcels(stored)) {
    // Parcels OK but index.geometry missing — persist site geometry only.
    const siteGeom = siteGeometryFromParcels(stored);
    if (!opts.dryRun && siteGeom) {
      await prisma.siteCandidateIndex.update({
        where: { id: row.id },
        data: { geometry: siteGeom as unknown as Prisma.InputJsonValue },
      });
    }
    return {
      ...base,
      status: opts.dryRun ? "skipped_dry" : "success",
      parcelsStored: stored.filter((p) => !!p.geometry).length,
      hasIndexGeometry: true,
    };
  }

  if (opts.dryRun) {
    return {
      ...base,
      status: "skipped_dry",
      parcelsStored: stored.filter((p) => !!p.geometry).length,
      hydrated: missing.length,
      hasIndexGeometry: hasDrawableGeometry(row.geometry),
    };
  }

  let hydrated = 0;
  try {
    if (missing.length) {
      await sleep(opts.delayMs);
      const live = await getParcelsByExternalIds(missing, { skipPlanning: true });
      const withGeom = live.filter((p) => !!p.geometry);
      hydrated = withGeom.length;
      if (withGeom.length) {
        await prisma.$transaction(async (tx) => {
          for (const p of withGeom) {
            await upsertParcel(tx, p);
          }
        });
      }
      stored = await getStoredParcelsByExternalIds(parcelIds);
    }

    const drawable = stored.filter((p) => !!p.geometry);
    const siteGeom = siteGeometryFromParcels(drawable);
    if (siteGeom) {
      await prisma.siteCandidateIndex.update({
        where: { id: row.id },
        data: { geometry: siteGeom as unknown as Prisma.InputJsonValue },
      });
    }

    const stillMissing = parcelsMissingDrawableGeometry(parcelIds, stored);
    const ok = drawable.length > 0 && !!siteGeom;
    return {
      ...base,
      status: ok ? (stillMissing.length ? "partial" : "success") : "failed",
      parcelsStored: drawable.length,
      hydrated,
      hasIndexGeometry: !!siteGeom,
      error: stillMissing.length ? `missing_parcels:${stillMissing.join(",")}` : ok ? undefined : "no_geometry",
    };
  } catch (e) {
    return {
      ...base,
      status: "failed",
      parcelsStored: stored.filter((p) => !!p.geometry).length,
      hydrated,
      hasIndexGeometry: hasDrawableGeometry(row.geometry),
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.suburb && !args.id && !args.canonicalKey && !args.all) {
    console.error(
      "Specify --suburb=Bexley, --id=..., --canonicalKey=..., or --all [--limit=N]",
    );
    process.exitCode = 1;
    return;
  }

  const where = {
    lifecycleStatus: "ACTIVE" as const,
    ...(args.id ? { id: args.id } : {}),
    ...(args.canonicalKey ? { canonicalKey: args.canonicalKey } : {}),
    ...(args.suburb ? { suburb: { equals: args.suburb, mode: "insensitive" as const } } : {}),
  };

  // Prefer rows missing geometry first (resumable).
  const rows = await prisma.siteCandidateIndex.findMany({
    where,
    orderBy: [{ geometry: "asc" }, { updatedAt: "asc" }],
    skip: args.offset,
    take: args.all || args.suburb || args.id || args.canonicalKey ? args.limit : DEFAULT_BATCH,
    select: {
      id: true,
      canonicalKey: true,
      address: true,
      suburb: true,
      parcelIds: true,
      geometry: true,
    },
  });

  // When suburb=Bexley and no explicit limit override beyond default, still process Washington Street first.
  const ordered = [...rows].sort((a, b) => {
    const aWash = /washington/i.test(a.address ?? "") ? 0 : 1;
    const bWash = /washington/i.test(b.address ?? "") ? 0 : 1;
    return aWash - bWash;
  });

  const results: Awaited<ReturnType<typeof backfillOne>>[] = [];
  for (const row of ordered) {
    // Concurrency 1
    const r = await backfillOne(row, { dryRun: args.dryRun, delayMs: args.delayMs });
    results.push(r);
    console.log(JSON.stringify(r));
  }

  const summary = {
    dryRun: args.dryRun,
    considered: results.length,
    already_ok: results.filter((r) => r.status === "already_ok").length,
    success: results.filter((r) => r.status === "success").length,
    partial: results.filter((r) => r.status === "partial").length,
    failed: results.filter((r) => r.status === "failed").length,
    skipped_dry: results.filter((r) => r.status === "skipped_dry").length,
  };
  console.log(JSON.stringify({ summary, results }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
