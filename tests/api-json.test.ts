import { describe, expect, it, vi } from "vitest";
import { ApiJsonError, fetchApiJsonWithRetry, isTransientHttpError, parseApiJsonText } from "@/lib/api-json";

describe("parseApiJsonText", () => {
  it("parses normal JSON", () => {
    expect(parseApiJsonText<{ ok: boolean }>('{"ok":true}', 200, "application/json")).toEqual({ ok: true });
  });

  it("throws a clear error for HTML DOCTYPE bodies", () => {
    const html = "<!DOCTYPE html><html><body>Not Found</body></html>";
    expect(() => parseApiJsonText(html, 404, "text/html; charset=utf-8")).toThrow(ApiJsonError);
    try {
      parseApiJsonText(html, 404, "text/html");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiJsonError);
      expect((err as Error).message).not.toMatch(/Unexpected token/);
      expect((err as Error).message).toMatch(/HTML|not found/i);
      expect((err as ApiJsonError).status).toBe(404);
    }
  });

  it("throws a retry hint for gateway HTML statuses", () => {
    const html = "<!DOCTYPE html><html><h1>Gateway Timeout</h1></html>";
    try {
      parseApiJsonText(html, 504, "text/html");
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toMatch(/unavailable|retry/i);
      expect((err as ApiJsonError).status).toBe(504);
    }
  });

  it("rejects empty bodies", () => {
    expect(() => parseApiJsonText("   ", 200, "application/json")).toThrow(/Empty/);
  });
});

describe("transient HTTP helpers", () => {
  it("detects gateway failures", () => {
    expect(isTransientHttpError(new ApiJsonError("Server temporarily unavailable — retry in a moment. (HTTP 502)", 502, null))).toBe(true);
    expect(isTransientHttpError(new ApiJsonError("nope", 400, null))).toBe(false);
  });

  it("retries once on 502 then succeeds", async () => {
    const html = "<!DOCTYPE html><html><body>Bad Gateway</body></html>";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        headers: { get: () => "text/html" },
        text: async () => html,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        text: async () => '{"ok":true}',
      });
    vi.stubGlobal("fetch", fetchMock);
    const body = await fetchApiJsonWithRetry<{ ok: boolean }>("/api/parcels", undefined, { retries: 1, delayMs: 1 });
    expect(body).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});
