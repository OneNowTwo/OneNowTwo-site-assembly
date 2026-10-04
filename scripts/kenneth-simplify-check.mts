import { haversineM, queryNswUrbanSalesNear } from "../src/lib/data-sources/nsw-property-sales";
import { applyExitBenchmarksToUnitMix, buildLocalExitBenchmarks } from "../src/lib/analysis/exit-benchmarks";
import { computeFeasibility } from "../src/lib/analysis/feasibility";
import { DEFAULT_ASSUMPTIONS, defaultUnitMix } from "../src/lib/analysis/assumptions";
import { autoGenerateUnitMix, computeUnitMix, DEFAULT_MIX_SHARES } from "../src/lib/analysis/unit-mix";
import { estimatePropertyLevelValue } from "../src/lib/analysis/property-level-valuation";

async function main() {
  const lng = 151.2686;
  const lat = -33.7865;
  const sales = await queryNswUrbanSalesNear({ lng, lat, radiusM: 1200, suburb: "MANLY VALE" });
  const comps = sales.map((s) => ({
    id: s.dealing ?? `propid:${s.propid ?? `${s.lng},${s.lat}`}`,
    address: s.address,
    salePrice: s.salePrice,
    saleDate: s.saleDate,
    saleDateMs: s.saleDateMs,
    landAreaSqm: s.landAreaSqm,
    distanceM: Math.round(haversineM(lng, lat, s.lng, s.lat)),
    strata: s.strata,
    suburb: s.suburb,
    source: s.source,
    dealing: s.dealing,
    propid: s.propid,
  }));
  const prop = estimatePropertyLevelValue({
    areaSqm: 1382,
    suburb: "Manly Vale",
    zone: "R3",
    isStrata: false,
    sales: comps,
  });
  console.log(
    "PROPERTY_LEVEL",
    JSON.stringify({
      mid: prop.mid,
      low: prop.low,
      high: prop.high,
      comps: prop.numberOfComps,
      method: prop.methodDetail,
      rate: prop.landRatePerSqm,
      note: prop.note,
    }),
  );

  const strata = sales
    .filter((s) => s.strata)
    .map((s) => ({
      salePrice: s.salePrice,
      bedrooms: null as number | null,
      unitAreaSqm: s.landAreaSqm != null && s.landAreaSqm <= 280 ? s.landAreaSqm : null,
      strata: true as const,
    }));
  console.log("STRATA_SAMPLE", strata.length, "of", sales.length);
  const bench = buildLocalExitBenchmarks(strata);
  console.log(
    "EXIT",
    JSON.stringify({
      overall: bench.overallMedian,
      sample: bench.overallSampleSize,
      label: bench.sourceLabel,
      byType: Object.fromEntries(
        Object.entries(bench.byUnitType).map(([k, v]) => [k, { p: v.pricePerUnit, s: v.source, n: v.sampleSize }]),
      ),
    }),
  );

  const siteArea = 1382;
  const fsr = 2.2;
  const theoretical = siteArea * fsr;
  const achievable = theoretical * 0.9;
  const saleable = achievable * 0.82;
  const mix0 = autoGenerateUnitMix(saleable, defaultUnitMix(), DEFAULT_MIX_SHARES);
  const applied = applyExitBenchmarksToUnitMix(mix0, bench);
  const totals = computeUnitMix(applied.rows);
  const f = computeFeasibility({
    gfa: achievable,
    saleableArea: saleable,
    dwellings: totals.totalUnits,
    lotCount: 2,
    unitMix: applied.rows,
    a: { ...DEFAULT_ASSUMPTIONS, revenueMode: "UNIT_MIX" },
  });
  const existing = prop.mid ?? 0;
  console.log(
    "FEAS",
    JSON.stringify({
      theoretical: Math.round(theoretical),
      achievable: Math.round(achievable),
      saleable: Math.round(saleable),
      dwellings: totals.totalUnits,
      grv: f.grv,
      constructionPerSqm: DEFAULT_ASSUMPTIONS.constructionCostPerSqm,
      maxPayable: Math.round(f.maxAcquisitionBudget),
      existing,
      headroom: Math.round(f.maxAcquisitionBudget - existing),
      moc: f.marginOnCost,
      gaps: f.costInputGaps.map((g) => g.key),
      mix: applied.rows.filter((r) => r.count > 0).map((r) => ({ name: r.name, count: r.count, price: r.salePricePerUnit })),
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
