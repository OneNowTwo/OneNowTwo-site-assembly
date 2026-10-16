export interface WatchedSiteMarker {
  id: string;
  label: string;
  kind: string;
  lat: number;
  lng: number;
  status: string | null;
  href: string | null;
}
