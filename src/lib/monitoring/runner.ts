import { prisma } from "@/lib/db";
import { ensureDefaultWatchlist } from "./watchlist";
import { monitorSalesForUser } from "./sales-monitor";
import { monitorPlanningForUser } from "./planning-monitor";
import { generateMorningReport } from "./morning-report";
import { queueDueScans, processQueuedScans } from "./scan-schedule";
import { publishFeedItem } from "./feed";

/** Resolve the primary workspace user (single-tenant MVP). */
export async function resolveWorkspaceUserId(preferredUserId?: string | null): Promise<string | null> {
  if (preferredUserId) {
    const u = await prisma.user.findUnique({ where: { id: preferredUserId } });
    if (u) return u.id;
  }
  const email = process.env.AUTH_EMAIL?.trim().toLowerCase();
  if (email) {
    const u = await prisma.user.findUnique({ where: { email } });
    if (u) return u.id;
  }
  const any = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  return any?.id ?? null;
}

/**
 * Daily monitoring pass:
 * watchlist defaults → sales → planning → queue/run limited scans → morning report.
 * Designed for Render cron; caches upstream via fetchJson TTLs.
 */
export async function runDailyMonitoring(opts?: { userId?: string | null; runScans?: boolean }) {
  const userId = await resolveWorkspaceUserId(opts?.userId);
  if (!userId) {
    return { ok: false, error: "No workspace user" };
  }

  await ensureDefaultWatchlist(userId);

  const sales = await monitorSalesForUser(userId);
  const planning = await monitorPlanningForUser(userId);

  let scanJobs: string[] = [];
  let scanResults: unknown[] = [];
  if (opts?.runScans !== false) {
    scanJobs = await queueDueScans(3);
    scanResults = await processQueuedScans(userId, 2);
  }

  const report = await generateMorningReport(userId);
  await publishFeedItem({
    kind: "REPORT",
    title: report.title,
    summary: report.summaryLine ?? undefined,
    href: "/morning-report",
    importance: 4,
    payload: { reportId: report.id },
  });

  return {
    ok: true,
    userId,
    sales,
    planning,
    scanJobsQueued: scanJobs.length,
    scanResults,
    morningReportId: report.id,
    note: "Proposed planning controls remain separate from current-law feasibility. Upstream NSW calls use TTL cache.",
  };
}
