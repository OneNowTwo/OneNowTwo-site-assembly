import { MapWorkspace } from "@/components/map/map-workspace";
import { getGlobalAssumptions } from "@/lib/opportunity-service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Map — Site Assembly" };

export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<{ scan?: string; lat?: string; lng?: string; zoom?: string }>;
}) {
  const sp = await searchParams;
  return <MapWorkspace assumptions={await getGlobalAssumptions()} initialScanQuery={sp.scan ?? null} />;
}
