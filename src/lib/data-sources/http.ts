export class UpstreamError extends Error {
  constructor(
    message: string,
    public readonly service: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

interface CacheEntry {
  expires: number;
  value: unknown;
}

const cache = new Map<string, CacheEntry>();
const MAX_CACHE_ENTRIES = 500;

/**
 * GET JSON with timeout, retry-once and a small in-process TTL cache.
 * Upstream ArcGIS services occasionally return 200 with an `error` body, which is treated as a failure.
 */
export async function fetchJson<T>(
  url: string,
  opts: { service: string; timeoutMs?: number; ttlMs?: number; headers?: Record<string, string> },
): Promise<T> {
  const { service, timeoutMs = 15000, ttlMs = 10 * 60 * 1000, headers } = opts;
  const hit = cache.get(url);
  if (hit && hit.expires > Date.now()) return hit.value as T;

  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "User-Agent": "SiteAssembly/0.1 (internal MVP)", Accept: "application/json", ...headers },
        cache: "no-store",
      });
      if (!res.ok) throw new UpstreamError(`${service} responded ${res.status}`, service, res.status);
      const text = await res.text();
      const head = text.slice(0, 200).trimStart().toLowerCase();
      if (head.startsWith("<!doctype") || head.startsWith("<html")) {
        throw new UpstreamError(`${service} returned HTML instead of JSON`, service, res.status);
      }
      let body: T & { error?: { message?: string } };
      try {
        body = JSON.parse(text) as T & { error?: { message?: string } };
      } catch {
        throw new UpstreamError(`${service} returned invalid JSON`, service, res.status);
      }
      if (body && typeof body === "object" && "error" in body && body.error) {
        throw new UpstreamError(`${service}: ${body.error.message ?? "service error"}`, service);
      }
      if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
      cache.set(url, { expires: Date.now() + ttlMs, value: body });
      return body;
    } catch (err) {
      lastErr = err;
      if (err instanceof UpstreamError && err.status && err.status < 500) break;
    }
  }
  if (lastErr instanceof UpstreamError) throw lastErr;
  const reason = lastErr instanceof Error && lastErr.name === "TimeoutError" ? "timed out" : "unreachable";
  throw new UpstreamError(`${service} ${reason}`, service);
}

export function buildUrl(base: string, params: Record<string, string | number | boolean>): string {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  return u.toString();
}
