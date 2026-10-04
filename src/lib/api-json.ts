/**
 * Safe JSON parsing for browser `fetch` responses.
 * Next.js / Render often return HTML error or 404 pages; bare `res.json()` then throws
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
 */

export class ApiJsonError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "ApiJsonError";
  }
}

function looksLikeHtml(text: string): boolean {
  const head = text.slice(0, 200).trimStart().toLowerCase();
  return head.startsWith("<!doctype") || head.startsWith("<html") || head.startsWith("<head");
}

/** Parse response text as JSON, or throw a clear ApiJsonError when the body is HTML/non-JSON. */
export function parseApiJsonText<T = unknown>(text: string, status: number, contentType: string | null): T {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new ApiJsonError(status ? `Empty response (${status})` : "Empty response", status, null);
  }
  const ct = (contentType ?? "").toLowerCase();
  const html = looksLikeHtml(trimmed) || (ct.includes("text/html") && !ct.includes("json"));
  if (html) {
    const hint =
      status === 502 || status === 503 || status === 504
        ? "Server temporarily unavailable — retry in a moment."
        : status === 404
          ? "API route not found (server returned an HTML page)."
          : "Server returned an HTML page instead of JSON.";
    throw new ApiJsonError(`${hint} (HTTP ${status || "unknown"})`, status, null);
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new ApiJsonError(`Invalid JSON response (HTTP ${status || "unknown"})`, status, trimmed.slice(0, 200));
  }
}

/** Read a fetch Response as JSON with HTML-aware errors. */
export async function readApiJson<T = unknown>(res: Response): Promise<T> {
  const text = await res.text();
  return parseApiJsonText<T>(text, res.status, res.headers.get("content-type"));
}

/**
 * Fetch + parse JSON. Throws ApiJsonError with a readable message on HTML/non-OK bodies
 * that include `{ error: string }`, or a generic status message otherwise.
 */
export async function fetchApiJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await readApiJson<T & { error?: string }>(res);
  if (!res.ok) {
    const msg =
      body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `Request failed (${res.status})`;
    throw new ApiJsonError(msg, res.status, body);
  }
  return body as T;
}

/** Gateway / cold-start failures that are safe to retry or soft-fail. */
export function isTransientHttpError(err: unknown): boolean {
  if (err instanceof ApiJsonError) return err.status === 502 || err.status === 503 || err.status === 504;
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /HTTP 502|HTTP 503|HTTP 504|temporarily unavailable|Server temporarily unavailable/i.test(msg);
}

/** One delayed retry for transient gateway errors (e.g. Render 502 after a heavy scan). */
export async function fetchApiJsonWithRetry<T = unknown>(
  url: string,
  init?: RequestInit,
  opts?: { retries?: number; delayMs?: number },
): Promise<T> {
  const retries = opts?.retries ?? 1;
  const delayMs = opts?.delayMs ?? 2500;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchApiJson<T>(url, init);
    } catch (err) {
      lastErr = err;
      if (!isTransientHttpError(err) || attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}
