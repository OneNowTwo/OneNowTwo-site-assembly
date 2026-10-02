import { OpportunityView } from "@/components/opportunity/opportunity-view";

export const metadata = { title: "Opportunity — Site Assembly" };

export default async function OpportunityPage({ params, searchParams }: PageProps<"/opportunities/[id]">) {
  const { id } = await params;
  const tab = (await searchParams).tab;
  return <OpportunityView id={id} initialTab={typeof tab === "string" ? tab : undefined} />;
}
