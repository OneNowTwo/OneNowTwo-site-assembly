import { prisma } from "@/lib/db";
import type { ChangeEventKind, Prisma } from "@/generated/prisma/client";

export interface MetricSnapshot {
  status?: string | null;
  score?: number | null;
  acquisitionHeadroom?: number | null;
  maxLandBudget?: number | null;
  grv?: number | null;
  combinedMarketValue?: number | null;
  pathway?: string | null;
}

const METRIC_KINDS: { key: keyof MetricSnapshot; kind: ChangeEventKind; title: string; fmt?: (n: number) => string }[] = [
  { key: "status", kind: "STATUS", title: "Status changed" },
  { key: "score", kind: "SCORE", title: "Score changed" },
  { key: "acquisitionHeadroom", kind: "HEADROOM", title: "Headroom changed", fmt: (n) => `$${Math.round(n).toLocaleString("en-AU")}` },
  { key: "maxLandBudget", kind: "MAX_PAYABLE", title: "Max payable changed", fmt: (n) => `$${Math.round(n).toLocaleString("en-AU")}` },
  { key: "grv", kind: "GRV", title: "GRV changed", fmt: (n) => `$${Math.round(n).toLocaleString("en-AU")}` },
  { key: "combinedMarketValue", kind: "EXISTING_VALUE", title: "Existing value changed", fmt: (n) => `$${Math.round(n).toLocaleString("en-AU")}` },
  { key: "pathway", kind: "PATHWAY", title: "Pathway changed" },
];

function meaningfulDelta(key: keyof MetricSnapshot, before: unknown, after: unknown): boolean {
  if (before == null && after == null) return false;
  if (before == null || after == null) return true;
  if (typeof before === "number" && typeof after === "number") {
    if (key === "score") return Math.round(before) !== Math.round(after);
    // Ignore sub-$1k noise on dollar metrics
    return Math.abs(before - after) >= 1000;
  }
  return String(before) !== String(after);
}

export async function recordOpportunityChange(input: {
  opportunityId: string;
  kind: ChangeEventKind;
  title: string;
  summary?: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  source?: string;
}) {
  return prisma.opportunityChangeEvent.create({
    data: {
      opportunityId: input.opportunityId,
      kind: input.kind,
      title: input.title,
      summary: input.summary,
      before: (input.before ?? undefined) as Prisma.InputJsonValue | undefined,
      after: (input.after ?? undefined) as Prisma.InputJsonValue | undefined,
      reason: input.reason,
      source: input.source,
    },
  });
}

/** Compare before/after metric snapshots and append timeline rows + return deltas for feed. */
export async function recordMetricChanges(
  opportunityId: string,
  before: MetricSnapshot,
  after: MetricSnapshot,
  meta?: { reason?: string; source?: string },
): Promise<{ kind: ChangeEventKind; title: string; before: unknown; after: unknown }[]> {
  const recorded: { kind: ChangeEventKind; title: string; before: unknown; after: unknown }[] = [];
  for (const m of METRIC_KINDS) {
    const b = before[m.key];
    const a = after[m.key];
    if (!meaningfulDelta(m.key, b, a)) continue;
    const summary =
      typeof b === "number" && typeof a === "number" && m.fmt
        ? `${m.fmt(b)} → ${m.fmt(a)}`
        : `${b ?? "—"} → ${a ?? "—"}`;
    await recordOpportunityChange({
      opportunityId,
      kind: m.kind,
      title: m.title,
      summary,
      before: { [m.key]: b },
      after: { [m.key]: a },
      reason: meta?.reason,
      source: meta?.source ?? "recompute",
    });
    recorded.push({ kind: m.kind, title: m.title, before: b, after: a });
  }
  return recorded;
}

export async function listOpportunityHistory(opportunityId: string, limit = 50) {
  return prisma.opportunityChangeEvent.findMany({
    where: { opportunityId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
