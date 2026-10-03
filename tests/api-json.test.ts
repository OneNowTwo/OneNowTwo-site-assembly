import { describe, expect, it } from "vitest";
import { ApiJsonError, parseApiJsonText } from "@/lib/api-json";

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
