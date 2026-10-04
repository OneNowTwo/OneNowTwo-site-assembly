/** Persist map/scan client state across navigation (localStorage + URL helpers). */

export const MAP_STATE_KEY = "site-assembly:map-state:v1";
export const SCAN_SESSION_KEY = "site-assembly:scan-session:v1";

export interface PersistedMapState {
  lat: number;
  lng: number;
  zoom: number;
  query: string;
  zoneFill: boolean;
  zoningWms: boolean;
  updatedAt: string;
}

export interface PersistedScanSession {
  sessionId: string;
  query: string;
  bbox: { west: number; south: number; east: number; north: number } | null;
  lat: number;
  lng: number;
  zoom: number;
  candidates: unknown[];
  families: unknown[];
  messages: string[];
  progress: string[];
  parcelsConsidered: number;
  parcelsEligible: number;
  assembliesGenerated: number;
  funnel?: {
    parcelsLoaded: number;
    parcelsConsidered: number;
    parcelsEligible: number;
    assembliesGenerated: number;
    candidatesReturned: number;
    generatedByLotCount?: Record<string, number>;
    partialScan?: boolean;
  } | null;
  valuationStatus?: { valued: number; attempted: number } | null;
  centres: unknown[];
  activeKey: string | null;
  hiddenKeys: string[];
  showAllAssemblies: boolean;
  updatedAt: string;
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadMapState(): PersistedMapState | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(MAP_STATE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedMapState;
  } catch {
    return null;
  }
}

export function saveMapState(state: PersistedMapState): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(MAP_STATE_KEY, JSON.stringify(state));
  } catch {
    // quota / private mode
  }
}

export function loadScanSession(): PersistedScanSession | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(SCAN_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedScanSession;
  } catch {
    return null;
  }
}

export function saveScanSession(session: PersistedScanSession): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(SCAN_SESSION_KEY, JSON.stringify(session));
  } catch {
    // ignore
  }
}

export function clearScanSession(): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.removeItem(SCAN_SESSION_KEY);
  } catch {
    // ignore
  }
}

export function newScanSessionId(): string {
  return `scan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
