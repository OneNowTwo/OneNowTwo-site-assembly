import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, requireSession } from "@/lib/session";
import { createOpportunity } from "@/lib/opportunity-service";
import { getParcelsByExternalIds } from "@/lib/parcel-service";
import { loadProposedPlanningAreas } from "@/lib/source-watcher/load-persisted-areas";
import { resolveParcelsForKeySite } from "@/lib/source-watcher/parcel-link";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  planningChangeAreaId: z.string().optional(),
  keySiteId: z.string().optional(),
  /** Prefer explicit cadastral ids from KeySite linking. */
  parcelIds: z.array(z.string().regex(/^nsw-cadid:\d+$/)).optional(),
  name: z.string().trim().min(1).max(160).optional(),
});

/**
 * ANALYSE REQUIRED ASSEMBLY — build an opportunity from KeySite cadastral parcel IDs
 * via the existing createOpportunity / PlanningSnapshot / CalculationSnapshot path.
 */
export async function POST(req: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid body: " + parsed.error.issues[0]?.message);

  let parcelIds = parsed.data.parcelIds ?? [];
  let keySiteLabel = parsed.data.keySiteId ?? "key-site";

  if (!parcelIds.length && parsed.data.keySiteId) {
    const { areas } = await loadProposedPlanningAreas();
    const area = parsed.data.planningChangeAreaId
      ? areas.find((a) => a.id === parsed.data.planningChangeAreaId)
      : areas.find((a) => a.keySites?.some((k) => k.externalKeySiteId === parsed.data.keySiteId));
    const site = area?.keySites?.find((k) => k.externalKeySiteId === parsed.data.keySiteId);
    if (!site) return jsonError("Key site not found in persisted/fixture proposed planning data", 404);
    keySiteLabel = site.externalKeySiteId;
    const linked = await resolveParcelsForKeySite(site);
    parcelIds = linked.filter((p) => p.externalParcelId.startsWith("nsw-cadid:")).map((p) => p.externalParcelId);
    if (!parcelIds.length && site.requiredParcelIds?.length) {
      parcelIds = site.requiredParcelIds.filter((id) => /^nsw-cadid:\d+$/.test(id));
    }
  }

  if (!parcelIds.length) {
    return jsonError(
      "No cadastral parcel IDs available for this key site. Resolve KeySite↔parcel links first (nsw-cadid:…).",
      422,
    );
  }

  const parcels = await getParcelsByExternalIds(parcelIds);
  if (!parcels.length) {
    return jsonError("Could not load cadastral parcels for the linked ids", 503);
  }
  if (parcels.length < parcelIds.length) {
    // Proceed with resolved subset but surface the gap.
  }

  const name =
    parsed.data.name ??
    `Key site ${keySiteLabel} assembly (${parcels.length} lots)`;

  try {
    const opp = await createOpportunity({
      name,
      parcels,
      userId: session.userId,
      notes: [
        "KEY_SITE_REQUIRED_ASSEMBLY",
        parsed.data.keySiteId ? `keySite=${parsed.data.keySiteId}` : null,
        parsed.data.planningChangeAreaId ? `area=${parsed.data.planningChangeAreaId}` : null,
        `parcels=${parcels.map((p) => p.externalParcelId).join(",")}`,
      ]
        .filter(Boolean)
        .join(" · "),
    });
    return NextResponse.json(
      {
        id: opp.id,
        parcelIds: parcels.map((p) => p.externalParcelId),
        parcelCount: parcels.length,
        requestedCount: parcelIds.length,
        href: `/opportunities/${opp.id}`,
      },
      { status: 201 },
    );
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Could not create assembly opportunity", 503);
  }
}
