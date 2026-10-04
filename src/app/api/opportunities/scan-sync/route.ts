import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseOpportunityInputs } from "@/lib/analysis/assumptions";
import { canonicalFromOpportunity, type CanonicalScanOverlay } from "@/lib/analysis/sync-scan-canonical";
import type { ScanCalculationSnapshot } from "@/lib/analysis/assembly-feasibility";
import { jsonError } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Return canonical CalculationSnapshot overlays for scan candidates.
 * Query: ?keys=key1,key2 or ?sessionId=scan_xxx
 * Map cards merge these — no suburb rescan, no new calculator.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const keys = (url.searchParams.get("keys") ?? "")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    const sessionId = url.searchParams.get("sessionId")?.trim() || null;

    const rows = await prisma.opportunity.findMany({
      orderBy: { updatedAt: "desc" },
      take: 200,
      select: {
        id: true,
        inputs: true,
        score: true,
        maxLandBudget: true,
        acquisitionHeadroom: true,
        grv: true,
        theoreticalGfa: true,
        achievableGfa: true,
        updatedAt: true,
      },
    });

    const overlays: CanonicalScanOverlay[] = [];
    for (const row of rows) {
      const inputs = parseOpportunityInputs(row.inputs);
      const prov = inputs.scanProvenance;
      if (!prov?.assemblyKey) continue;
      if (keys.length && !keys.includes(prov.assemblyKey)) continue;
      // Session id is optional hint only — assembly keys are the primary match so
      // Analyse → Map sync works after session restore / new tab.
      if (!keys.length && sessionId && prov.scanSessionId !== sessionId) continue;

      const canonical = prov.canonicalCalculation;
      const orig = prov.scanCalculationSnapshot as Partial<ScanCalculationSnapshot> | undefined;
      // Prefer persisted canonicalCalculation; fall back to opportunity cached summary + FSR override.
      const effectiveFsr =
        canonical?.effectiveFsr ??
        (inputs.fsrOverrideKind === "SCAN_MODELLED" || inputs.fsrOverrideKind === "USER" ? inputs.fsrOverride : null) ??
        inputs.pathwaySnapshot?.modelledFsr ??
        null;
      if (canonical == null && row.maxLandBudget == null && effectiveFsr == null) continue;

      overlays.push(
        canonicalFromOpportunity({
          opportunityId: row.id,
          assemblyKey: prov.assemblyKey,
          scanSessionId: prov.scanSessionId,
          calculation: {
            effectiveFsr,
            effectiveHeightM: canonical?.effectiveHeightM ?? inputs.heightOverrideM ?? inputs.pathwaySnapshot?.modelledHeightM ?? null,
            maxPayable: canonical?.maxPayable ?? row.maxLandBudget,
            headroom: canonical?.headroom ?? row.acquisitionHeadroom,
            score: canonical?.score ?? row.score,
            grv: canonical?.grv ?? row.grv,
            theoreticalGfa: canonical?.theoreticalGfa ?? row.theoreticalGfa,
            achievableGfa: canonical?.achievableGfa ?? row.achievableGfa,
          },
          originalScan: orig ?? null,
          analysedAt: canonical?.analysedAt ?? row.updatedAt.toISOString(),
        }),
      );
    }

    // One overlay per assembly key — newest opportunity wins (rows are desc).
    const byKey = new Map<string, CanonicalScanOverlay>();
    for (const o of overlays) {
      if (!byKey.has(o.assemblyKey)) byKey.set(o.assemblyKey, o);
    }

    return NextResponse.json({ overlays: [...byKey.values()] });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Failed to load scan sync overlays", 503);
  }
}
