import "dotenv/config";
import { prisma } from "@/lib/db";
import { recomputeOpportunity } from "@/lib/opportunity-service";

async function main() {
  const opportunities = await prisma.opportunity.findMany({
    select: { id: true, name: true },
    orderBy: { updatedAt: "asc" },
  });
  for (const opportunity of opportunities) {
    await recomputeOpportunity(opportunity.id, {
      reason: "financial single-source reconciliation",
      source: "maintenance",
    });
    console.log(`recomputed ${opportunity.id} ${opportunity.name}`);
  }
  console.log(`recomputed ${opportunities.length} opportunity/opportunities`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
