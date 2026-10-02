import { nswPlanningProvider } from "../src/lib/data-sources/nsw-planning";
import { nswCadastreProvider } from "../src/lib/data-sources/nsw-cadastre";

const bbox = { west: 151.2595, south: -33.7942, east: 151.2610, north: -33.7932 };
const parcels = await nswCadastreProvider.getParcelsInBBox(bbox);
console.log("cadastre lots", parcels.length);
const sample = parcels.filter((p) => p.address?.includes("SYDNEY ROAD") || p.address?.includes("RICKARD") || p.address?.includes("Sydney")).slice(0, 5);
const targets = sample.length ? sample : parcels.slice(0, 5);
const controls = await nswPlanningProvider.getControlsForParcels(
  bbox,
  targets.map((p) => ({ id: p.externalParcelId, geometry: p.geometry })),
);
for (const p of targets) {
  const c = controls.get(p.externalParcelId);
  console.log(
    JSON.stringify(
      {
        address: p.address,
        lot: p.lotIdString,
        areaSqm: Math.round(p.areaSqm),
        fsr: c?.fsr ?? null,
        fsrStatus: c?.fsrStatus,
        fsrControls: c?.fsrControls?.map((x) => ({ fsr: x.fsr, sharePct: Math.round(x.intersectionShare * 100), epi: x.epiName })),
        zone: c?.zone,
        instrument: c?.planningInstrument,
        heightM: c?.heightM,
        source: c?.sources.fsr?.source,
        checked: c?.sources.fsr?.retrievedAt?.slice(0, 10),
      },
      null,
      2,
    ),
  );
}
