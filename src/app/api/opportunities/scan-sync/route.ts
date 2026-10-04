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
        combinedMarketValue: true,
        acquisitionHeadroomPercent: true,
        saleableArea: true,
        unitCount: true,
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

      const orig = prov.scanCalculationSnapshot as Partial<ScanCalculationSnapshot> | undefined;
      // Current financial values come directly from the latest persisted opportunity row.
      // scanProvenance.canonicalCalculation is retained for backwards-compatible history only.
      const effectiveFsr =
        (inputs.fsrOverrideKind === "SCAN_MODELLED" || inputs.fsrOverrideKind === "USER" ? inputs.fsrOverride : null) ??
        inputs.pathwaySnapshot?.modelledFsr ??
        prov.canonicalCalculation?.effectiveFsr ??
        null;
      if (row.maxLandBudget == null && effectiveFsr == null) continue;

      overlays.push(
        canonicalFromOpportunity({
          opportunityId: row.id,
          assemblyKey: prov.assemblyKey,
          scanSessionId: prov.scanSessionId,
          calculation: {
            effectiveFsr,
            effectiveHeightM: inputs.heightOverrideM ?? inputs.pathwaySnapshot?.modelledHeightM ?? prov.canonicalCalculation?.effectiveHeightM ?? null,
            maxPayable: row.maxLandBudget ?? null,
            headroom: row.acquisitionHeadroom ?? null,
            score: row.score ?? null,
            grv: row.grv ?? null,
            theoreticalGfa: row.theoreticalGfa ?? null,
            achievableGfa: row.achievableGfa ?? null,
            existingValue: row.combinedMarketValue ?? null,
            headroomPercent: row.acquisitionHeadroomPercent ?? null,
            dwellings: row.unitCount ?? null,
            saleableArea: row.saleableArea ?? null,
          },
          originalScan: orig ?? null,
          analysedAt: row.updatedAt.toISOString(),
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
