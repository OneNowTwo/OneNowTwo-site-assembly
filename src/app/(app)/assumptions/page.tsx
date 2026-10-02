import { AssumptionsForm } from "@/components/assumptions-form";
import { getGlobalAssumptions } from "@/lib/opportunity-service";
import { DEFAULT_ASSUMPTIONS } from "@/lib/analysis/assumptions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Assumptions — Site Assembly" };

export default async function AssumptionsPage() {
  return <AssumptionsForm initial={await getGlobalAssumptions()} defaults={DEFAULT_ASSUMPTIONS} />;
}
