import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { clearScanSession, loadScanSession, saveScanSession, SCAN_SESSION_KEY } from "@/lib/map-state";

describe("map shell scan persistence contract", () => {
  const store = new Map<string, string>();
  const ls = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  } as Storage;

  beforeEach(() => {
    store.clear();
    Object.defineProperty(globalThis, "localStorage", { value: ls, configurable: true });
    Object.defineProperty(globalThis, "window", { value: { localStorage: ls }, configurable: true });
  });

  afterEach(() => {
    store.clear();
  });

  it("keeps scan session readable after navigate-away style remounts", () => {
    saveScanSession({
      sessionId: "scan_test",
      query: "Manly Vale",
      bbox: { west: 151.2, south: -33.8, east: 151.3, north: -33.7 },
      lat: -33.75,
      lng: 151.25,
      zoom: 16,
      candidates: [{ key: "a" }],
      families: [],
      messages: ["Scan funnel: 10 considered"],
      progress: ["Done"],
      parcelsConsidered: 10,
      parcelsEligible: 4,
      assembliesGenerated: 2,
      centres: [],
      activeKey: "a",
      hiddenKeys: [],
      showAllAssemblies: true,
      updatedAt: new Date().toISOString(),
    });

    const restored = loadScanSession();
    expect(restored?.sessionId).toBe("scan_test");
    expect(restored?.query).toBe("Manly Vale");
    expect(restored?.candidates).toHaveLength(1);
    expect(store.has(SCAN_SESSION_KEY)).toBe(true);

    clearScanSession();
    expect(loadScanSession()).toBeNull();
  });
});
