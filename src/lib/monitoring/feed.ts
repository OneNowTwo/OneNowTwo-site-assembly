import { prisma } from "@/lib/db";
import type { FeedKind, Prisma } from "@/generated/prisma/client";

export type FeedSort =
  | "newest"
  | "headroom"
  | "score_delta"
  | "score"
  | "max_payable"
  | "importance";

export async function publishFeedItem(input: {
  kind: FeedKind;
  title: string;
  summary?: string;
  opportunityId?: string | null;
  watchItemId?: string | null;
  href?: string | null;
  score?: number | null;
  headroom?: number | null;
  maxPayable?: number | null;
  scoreDelta?: number | null;
  headroomDelta?: number | null;
  importance?: number;
  payload?: unknown;
}) {
  const importance =
    input.importance ??
    Math.abs(input.headroomDelta ?? 0) / 1_000_000 +
      Math.abs(input.scoreDelta ?? 0) +
      (input.kind === "NEW" ? 5 : 0) +
      (input.kind === "PLANNING_CHANGE" ? 3 : 0) +
      (input.kind === "NEW_SALE" ? 2 : 0);

  return prisma.feedItem.create({
    data: {
      kind: input.kind,
      title: input.title,
      summary: input.summary,
      opportunityId: input.opportunityId ?? undefined,
      watchItemId: input.watchItemId ?? undefined,
      href: input.href ?? (input.opportunityId ? `/opportunities/${input.opportunityId}` : undefined),
      score: input.score ?? undefined,
      headroom: input.headroom ?? undefined,
      maxPayable: input.maxPayable ?? undefined,
      scoreDelta: input.scoreDelta ?? undefined,
      headroomDelta: input.headroomDelta ?? undefined,
      importance,
      payload: (input.payload ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

export async function listFeed(opts?: { sort?: FeedSort; kind?: FeedKind; limit?: number }) {
  const limit = opts?.limit ?? 40;
  const sort = opts?.sort ?? "importance";
  const orderBy: Prisma.FeedItemOrderByWithRelationInput[] =
    sort === "newest"
      ? [{ createdAt: "desc" }]
      : sort === "headroom"
        ? [{ headroomDelta: "desc" }, { createdAt: "desc" }]
        : sort === "score_delta"
          ? [{ scoreDelta: "desc" }, { createdAt: "desc" }]
          : sort === "score"
            ? [{ score: "desc" }, { createdAt: "desc" }]
            : sort === "max_payable"
              ? [{ maxPayable: "desc" }, { createdAt: "desc" }]
              : [{ importance: "desc" }, { createdAt: "desc" }];

  return prisma.feedItem.findMany({
    where: opts?.kind ? { kind: opts.kind } : undefined,
    orderBy,
    take: limit,
    include: { opportunity: { select: { id: true, name: true, suburb: true, status: true } } },
  });
}
