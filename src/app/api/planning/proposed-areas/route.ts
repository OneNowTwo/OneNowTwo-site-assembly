import { NextResponse } from "next/server";
import { loadProposedPlanningAreas } from "@/lib/source-watcher/load-persisted-areas";

export const dynamic = "force-dynamic";

/** Map overlay payload for PROPOSED PLANNING toggle — persisted areas + key sites. */
export async function GET() {
  const { areas, source } = await loadProposedPlanningAreas();
  const features: GeoJSON.Feature[] = [];
  for (const area of areas) {
    if (area.geometry) {
      features.push({
        type: "Feature",
        properties: {
          kind: "PlanningChangeArea",
          id: area.id,
          title: area.title,
          status: area.status,
          fsr: area.proposedControls.incentiveFsr ?? area.proposedControls.fsr ?? null,
          heightM: area.proposedControls.incentiveHeightM ?? area.proposedControls.heightM ?? null,
          sourceUrl: area.sourceUrl,
          dataSource: source,
        },
        geometry: area.geometry,
      });
    } else if (area.bbox) {
      const { west, south, east, north } = area.bbox;
      features.push({
        type: "Feature",
        properties: {
          kind: "PlanningChangeArea",
          id: area.id,
          title: area.title,
          status: area.status,
          fsr: area.proposedControls.incentiveFsr ?? area.proposedControls.fsr ?? null,
          heightM: area.proposedControls.incentiveHeightM ?? area.proposedControls.heightM ?? null,
          sourceUrl: area.sourceUrl,
          approx: true,
          dataSource: source,
        },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [west, south],
              [east, south],
              [east, north],
              [west, north],
              [west, south],
            ],
          ],
        },
      });
    }
    for (const site of area.keySites ?? []) {
      const geom =
        site.geometry ??
        (site.bbox
          ? ({
              type: "Polygon",
              coordinates: [
                [
                  [site.bbox.west, site.bbox.south],
                  [site.bbox.east, site.bbox.south],
                  [site.bbox.east, site.bbox.north],
                  [site.bbox.west, site.bbox.north],
                  [site.bbox.west, site.bbox.south],
                ],
              ],
            } as GeoJSON.Polygon)
          : null);
      if (!geom) continue;
      features.push({
        type: "Feature",
        properties: {
          kind: "KeySite",
          id: site.externalKeySiteId,
          title: site.name,
          status: area.status,
          planningChangeAreaId: area.id,
          fsr: site.incentiveControls?.incentiveFsr ?? site.proposedControls?.fsr ?? null,
          heightM: site.incentiveControls?.incentiveHeightM ?? site.proposedControls?.heightM ?? null,
          requiredParcelCount: site.requiredParcelIds?.length ?? site.requiredParcelHints?.length ?? 0,
          keySite: true,
          dataSource: source,
        },
        geometry: geom,
      });
    }
  }
  return NextResponse.json({
    type: "FeatureCollection",
    features,
    dataSource: source,
    safety: "PROPOSED PLANNING overlay — not current LEP law",
  });
}
