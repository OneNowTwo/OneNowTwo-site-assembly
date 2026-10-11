import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { bboxFromGeometry } from "@/lib/map/map-target";

export const dynamic = "force-dynamic";

/**
 * Resolve PCA / KeySite MapTarget geography for the always-mounted MapWorkspace.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const pca = url.searchParams.get("pca") ?? url.searchParams.get("planningChangeAreaId");
  const keySite = url.searchParams.get("keySite") ?? url.searchParams.get("keySiteId");

  if (keySite) {
    const site = await prisma.keySite.findFirst({
      where: {
        OR: [{ externalKeySiteId: keySite }, { id: keySite }, { id: { endsWith: `:${keySite}` } }],
      },
      include: {
        planningChangeArea: { select: { id: true, title: true, status: true, sourceUrl: true, bbox: true } },
      },
    });
    if (!site) {
      return NextResponse.json({ error: "Key site not found" }, { status: 404 });
    }
    const bbox =
      bboxFromGeometry(site.bbox) ??
      bboxFromGeometry(site.geometry) ??
      bboxFromGeometry(site.planningChangeArea.bbox);
    const hints = site.requiredParcelHints as { ids?: string[]; hints?: string[] } | string[] | null;
    const requiredParcelIds = Array.isArray(hints)
      ? hints.map(String)
      : Array.isArray(hints?.ids)
        ? hints.ids.map(String)
        : [];
    const centroid =
      bbox != null
        ? { lat: (bbox.south + bbox.north) / 2, lng: (bbox.west + bbox.east) / 2 }
        : null;
    return NextResponse.json({
      kind: "KEY_SITE",
      title: site.name,
      summary: `${site.planningChangeArea.title} · ${site.planningChangeArea.status}`,
      sourceUrl: site.sourceUrl ?? site.planningChangeArea.sourceUrl,
      bbox,
      geometry: site.geometry,
      requiredParcelIds,
      centroid,
      planningChangeAreaId: site.planningChangeArea.id,
      keySiteId: site.externalKeySiteId,
    });
  }

  if (pca) {
    const area = await prisma.planningChangeArea.findUnique({ where: { id: pca } });
    if (!area) {
      return NextResponse.json({ error: "Planning change area not found" }, { status: 404 });
    }
    const bbox = bboxFromGeometry(area.bbox) ?? bboxFromGeometry(area.geometry);
    const centroid =
      bbox != null
        ? { lat: (bbox.south + bbox.north) / 2, lng: (bbox.west + bbox.east) / 2 }
        : null;
    return NextResponse.json({
      kind: "PLANNING_AREA",
      title: area.title,
      summary: area.status,
      sourceUrl: area.sourceUrl,
      bbox,
      geometry: area.geometry,
      centroid,
      planningChangeAreaId: area.id,
    });
  }

  return NextResponse.json({ error: "pca or keySite required" }, { status: 400 });
}
