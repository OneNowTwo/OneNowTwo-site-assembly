/** Map UI is kept mounted by AppShell so nav tabs do not remount Leaflet / abort scans. */
export const dynamic = "force-dynamic";
export const metadata = { title: "Map — Site Assembly" };

export default function MapPage() {
  return <div className="h-full" aria-label="Map workspace" />;
}
