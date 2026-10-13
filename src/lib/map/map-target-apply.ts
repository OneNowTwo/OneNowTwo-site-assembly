/**
 * MapTarget apply lifecycle — pure helpers so INDEX_CANDIDATE / entity deep-links
 * cannot be marked applied before client state is ready, and so stale Leaflet
 * viewport persistence cannot replaceState over a pending target URL.
 */

/** True while a target exists but has not finished applying to client state. */
export function isMapTargetPending(opts: {
  targetKey: string | null | undefined;
  appliedTargetKey: string | null | undefined;
}): boolean {
  return !!opts.targetKey && opts.appliedTargetKey !== opts.targetKey;
}

/**
 * Whether persistClientState may rewrite /map lat/lng/zoom via history.replaceState.
 * localStorage may still update while pending; the URL view belongs to the target
 * until apply completes.
 */
export function shouldRewriteMapUrlView(opts: {
  pathname: string;
  targetKey: string | null | undefined;
  appliedTargetKey: string | null | undefined;
}): boolean {
  if (opts.pathname !== "/map") return false;
  if (isMapTargetPending(opts)) return false;
  return true;
}

/**
 * Start a new async/sync apply only when this key is not already applied and
 * not already in flight (same-key re-renders must not duplicate/cancel).
 */
export function shouldStartMapTargetApply(opts: {
  targetKey: string;
  appliedTargetKey: string | null | undefined;
  applyingTargetKey: string | null | undefined;
}): boolean {
  if (opts.appliedTargetKey === opts.targetKey) return false;
  if (opts.applyingTargetKey === opts.targetKey) return false;
  return true;
}

/** Build /map search params for viewport persistence — preserves entity ids. */
export function buildPersistedMapSearchParams(opts: {
  currentSearch: string;
  lat: number;
  lng: number;
  zoom: number;
  query?: string;
}): URLSearchParams {
  const params = new URLSearchParams(opts.currentSearch);
  params.set("lat", opts.lat.toFixed(5));
  params.set("lng", opts.lng.toFixed(5));
  params.set("zoom", String(Math.round(opts.zoom * 10) / 10));
  const q = opts.query?.trim();
  if (q) params.set("scan", q);
  else params.delete("scan");
  return params;
}
