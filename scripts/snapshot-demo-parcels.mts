/**
 * Retrieves the five real Neutral Bay demo lots from the live NSW services and writes them to
 * prisma/seed-data/neutral-bay-demo-parcels.json, so `npm run db:seed` works when the services are down.
 * Run: npm run demo:snapshot
 */
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { nswCadastreProvider } from "@/lib/data-sources/nsw-cadastre";
import { nswPlanningProvider } from "@/lib/data-sources/nsw-planning";
import { DEMO_BBOX, DEMO_LOTS } from "@/lib/demo";
import pointOnFeature from "@turf/point-on-feature";

const lots = await nswCadastreProvider.getParcelsInBBox(DEMO_BBOX);
const picked = DEMO_LOTS.map((d) => {
  const p = lots.find((l) => l.lotIdString === d.lotIdString);
  if (!p) throw new Error(`Demo lot ${d.lotIdString} not found in NSW cadastre response`);
  return p;
});
const controls = await nswPlanningProvider.getControlsForPoints(
  DEMO_BBOX,
  picked.map((p) => ({ id: p.externalParcelId, point: pointOnFeature({ type: "Feature", properties: {}, geometry: p.geometry }).geometry })),
);
const out = picked.map((p) => ({ ...p, planning: controls.get(p.externalParcelId) ?? null, planningStatus: controls.has(p.externalParcelId) ? "ok" : "unavailable" }));
mkdirSync("prisma/seed-data", { recursive: true });
writeFileSync(
  "prisma/seed-data/neutral-bay-demo-parcels.json",
  JSON.stringify({ note: "Real NSW cadastral and planning data snapshot (NSW Spatial Services; NSW Planning Portal).", retrievedAt: new Date().toISOString(), parcels: out }, null, 2),
);
for (const p of out) console.log(p.lotIdString, p.address, p.areaSqm, p.planning?.zone, p.planning?.heightM, p.planning?.fsr);
