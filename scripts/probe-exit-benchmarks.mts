import "dotenv/config";
import { domainSuburbExitBenchmarkProvider } from "../src/lib/data-sources/domain-suburb-exit-benchmarks";
import { resolveAreaExitBenchmarks } from "../src/lib/analysis/exit-benchmark-provider";
import { queryNswUrbanSalesNear } from "../src/lib/data-sources/nsw-property-sales";

async function main() {
  const suburb = process.argv[2] ?? "Manly Vale";
  const lng = Number(process.argv[3] ?? 151.265);
  const lat = Number(process.argv[4] ?? -33.785);
  const sales = await queryNswUrbanSalesNear({ lng, lat, radiusM: 1500, suburb, maxRecords: 200 });
  const domain = await domainSuburbExitBenchmarkProvider.getSuburbUnitBenchmarks({ suburb, state: "NSW" });
  const merged = await resolveAreaExitBenchmarks({
    suburb,
    lng,
    lat,
    nswSales: sales,
    bedroomProviders: [domainSuburbExitBenchmarkProvider],
  });
  console.log(
    JSON.stringify(
      {
        suburb,
        nswSales: sales.length,
        domainConfigured: !!domain,
        domainBeds: domain?.byBedroom ?? null,
        oneBed: merged.byUnitType["1 Bed"] ?? null,
        twoBed: merged.byUnitType["2 Bed"] ?? null,
        threeBed: merged.byUnitType["3 Bed"] ?? null,
        sourceLabel: merged.sourceLabel,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
