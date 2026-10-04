import "dotenv/config";
import { domainCredentialStatus, domainValuationConfigured, getDomainAccessToken } from "../src/lib/data-sources/domain-valuation";
import { domainSuburbExitBenchmarkProvider } from "../src/lib/data-sources/domain-suburb-exit-benchmarks";

async function main() {
  const cfg = domainCredentialStatus();
  const auth = await getDomainAccessToken();
  const suburb = process.argv[2] ?? "Manly Vale";
  const domain = await domainSuburbExitBenchmarkProvider.getSuburbUnitBenchmarks({ suburb, state: "NSW" });
  console.log(
    JSON.stringify(
      {
        configured: domainValuationConfigured(),
        missing: cfg.missing,
        scopes: cfg.scopes,
        tokenOk: !!auth.token,
        authError: auth.error ?? null,
        suburb,
        bedroomTypes: domain ? Object.keys(domain.byBedroom) : [],
        byBedroom: domain?.byBedroom ?? null,
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
