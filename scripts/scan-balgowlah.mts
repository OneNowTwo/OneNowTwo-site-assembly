import { fetchNominatedCentres, bboxAround } from "../src/lib/data-sources/housing-sepp-lmr";
import { nswCadastreProvider } from "../src/lib/data-sources/nsw-cadastre";
import { nswPlanningProvider } from "../src/lib/data-sources/nsw-planning";
import { runAreaScan } from "../src/lib/analysis/area-scan";
import { DEFAULT_ASSUMPTIONS } from "../src/lib/analysis/assumptions";
import { clampBBox, MAX_BBOX_SPAN_DEG } from "../src/lib/data-sources/nsw-cadastre";
import type { BBox, ParcelData } from "../src/lib/types";

function tileBBox(b: BBox, maxSpan = MAX_BBOX_SPAN_DEG): BBox[] {
  const width = b.east - b.west;
  const height = b.north - b.south;
  if (width <= maxSpan && height <= maxSpan) return [clampBBox(b)];
  const tiles: BBox[] = [];
  for (let west = b.west; west < b.east; west += maxSpan * 0.92) {
    for (let south = b.south; south < b.north; south += maxSpan * 0.92) {
      tiles.push(clampBBox({ west, south, east: Math.min(b.east, west + maxSpan), north: Math.min(b.north, south + maxSpan) }));
    }
  }
  return tiles.slice(0, 9);
}

async function main() {
  const centres = await fetchNominatedCentres({ west: 151.24, south: -33.81, east: 151.29, north: -33.77 });
  const bal = centres.find((c) => c.label.includes("Balgowlah Stockland"));
  console.log("centre", bal?.label, bal?.lng, bal?.lat);
  if (!bal) throw new Error("centre missing");
  const bbox = bboxAround(bal.lng, bal.lat, 800);
  const byId = new Map<string, ParcelData>();
  for (const tile of tileBBox(bbox)) {
    const base = await nswCadastreProvider.getParcelsInBBox(tile);
    const controls = await nswPlanningProvider.getControlsForParcels(
      tile,
      base.map((p) => ({ id: p.externalParcelId, geometry: p.geometry })),
    );
    for (const p of base) {
      const planning = controls.get(p.externalParcelId) ?? null;
      byId.set(p.externalParcelId, {
        ...p,
        planning,
        planningStatus: planning ? "ok" : "unavailable",
        retrievedAt: new Date().toISOString(),
      });
    }
    console.log("tile", base.length);
  }
  const parcels = [...byId.values()];
  console.log("total unique", parcels.length);
  const result = runAreaScan({ parcels, centres: [bal], assumptions: DEFAULT_ASSUMPTIONS, maxResults: 10 });
  console.log(
    JSON.stringify(
      {
        considered: result.parcelsConsidered,
        eligible: result.parcelsEligible,
        generated: result.assembliesGenerated,
        families: result.families.length,
        rejections: result.rejections,
        top: result.candidates.slice(0, 8).map((c) => ({
          rank: c.rank,
          loc: c.locationLabel,
          lots: c.lotCount,
          area: Math.round(c.siteAreaSqm),
          lep: c.lepFsr,
          eff: c.effectiveFsr,
          certainty: c.effectiveCertainty,
          units: c.indicativeUnits,
          headroom: Math.round(c.headroom ?? 0),
          score: c.score.score,
          band: c.lmrBand,
          constraints: c.constraints,
        })),
        messages: result.messages,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
