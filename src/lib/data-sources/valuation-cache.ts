import type { PropertyValuationResult } from "./providers";

/** In-memory cache for AVM responses (process-local). Persist to DB later for multi-instance. */
const store = new Map<string, { result: PropertyValuationResult; expiresAt: number }>();

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function getCachedValuation(cacheKey: string): PropertyValuationResult | null {
  const hit = store.get(cacheKey);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    store.delete(cacheKey);
    return null;
  }
  return hit.result;
}

export function setCachedValuation(cacheKey: string, result: PropertyValuationResult, ttlMs = DEFAULT_TTL_MS): void {
  if (!result.cacheable || !cacheKey) return;
  store.set(cacheKey, { result, expiresAt: Date.now() + ttlMs });
}

export function clearValuationCache(): void {
  store.clear();
}
