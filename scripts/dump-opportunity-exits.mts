import "dotenv/config";
import { prisma } from "../src/lib/db";
import { parseOpportunityInputs } from "../src/lib/analysis/assumptions";

async function main() {
  const q = (process.argv[2] ?? "Kenneth").toLowerCase();
  const rows = await prisma.opportunity.findMany({
    select: {
      id: true,
      name: true,
      suburb: true,
      score: true,
      grv: true,
      maxLandBudget: true,
      acquisitionHeadroom: true,
      inputs: true,
    },
    orderBy: { updatedAt: "desc" },
  });
  const matched = rows.filter((r) => r.name.toLowerCase().includes(q) || (r.suburb ?? "").toLowerCase().includes(q));
  for (const r of matched.length ? matched : rows.slice(0, 5)) {
    const inputs = parseOpportunityInputs(r.inputs);
    const mix = (inputs.unitMix ?? []).map((u) => ({
      name: u.name,
      count: u.count,
      salePricePerUnit: u.salePricePerUnit,
      avgInternalArea: u.avgInternalArea,
      avgSaleableArea: u.avgSaleableArea,
      source: inputs.exitPriceSources?.[u.name] ?? null,
    }));
    console.log(
      JSON.stringify(
        {
          id: r.id,
          name: r.name,
          suburb: r.suburb,
          score: r.score,
          grv: r.grv,
          maxPayable: r.maxLandBudget,
          headroom: r.acquisitionHeadroom,
          exitPriceSources: inputs.exitPriceSources,
          mix,
        },
        null,
        2,
      ),
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
