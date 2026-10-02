import { MapWorkspace } from "@/components/map/map-workspace";
import { getGlobalAssumptions } from "@/lib/opportunity-service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Map — Site Assembly" };

export default async function MapPage() {
  return <MapWorkspace assumptions={await getGlobalAssumptions()} />;
}
