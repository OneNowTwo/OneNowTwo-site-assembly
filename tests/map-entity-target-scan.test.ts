import { describe, expect, it, beforeEach } from "vitest";
import {
  mapTargetClearsStaleScan,
  resolveMapTarget,
  shouldRestoreScanSession,
  tightBboxAroundTarget,
} from "@/lib/map/map-target";
import { clearScanSession, loadScanSession, saveScanSession } from "@/lib/map-state";

describe("explicit map targets vs restored scan session", () => {
  it("clears stale scan display for parcel and indexed-candidate style links", () => {
    expect(mapTargetClearsStaleScan("PARCEL")).toBe(true);
    expect(mapTargetClearsStaleScan("OPPORTUNITY")).toBe(true);
    expect(mapTargetClearsStaleScan("PLANNING_AREA")).toBe(true);
    expect(mapTargetClearsStaleScan("KEY_SITE")).toBe(true);
    expect(mapTargetClearsStaleScan("SCAN")).toBe(false);
    expect(mapTargetClearsStaleScan("POINT")).toBe(false);
  });

  it("does not restore scan session when opening a new parcel MapTarget", () => {
    const parcelTarget = resolveMapTarget(
      new URLSearchParams("parcelId=NSW123&lat=-33.95&lng=151.12&zoom=18"),
    );
    expect(parcelTarget?.kind).toBe("PARCEL");
    expect(shouldRestoreScanSession(parcelTarget)).toBe(false);
    expect(shouldRestoreScanSession(null)).toBe(true);
  });

  it("keeps scan session restorable for legacy ?scan= bootstrap", () => {
    const scanTarget = resolveMapTarget(new URLSearchParams("scan=Parramatta"));
    expect(scanTarget?.kind).toBe("SCAN");
    expect(shouldRestoreScanSession(scanTarget)).toBe(true);
  });

  it("uses a tight bbox for explicit target parcel fetch", () => {
    const target = resolveMapTarget(
      new URLSearchParams("parcelId=x&bbox=151.1,-33.96,151.11,-33.95"),
    );
    expect(target).not.toBeNull();
    const bbox = tightBboxAroundTarget(target!);
    expect(bbox).not.toBeNull();
    expect(bbox!.east - bbox!.west).toBeLessThan(0.05);
  });
});

describe("scan session persistence contract with entity navigation", () => {
  const store = new Map<string, string>();
  const ls = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
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

  it("restored old scan + new parcel MapTarget implies session still on disk but restore skipped", () => {
    saveScanSession({
      sessionId: "scan_parramatta",
      query: "Parramatta",
      bbox: { west: 150.9, south: -33.82, east: 151.0, north: -33.81 },
      lat: -33.815,
      lng: 150.95,
      zoom: 16,
      candidates: [{ key: "old" }],
      families: [],
      messages: [],
      progress: [],
      parcelsConsidered: 50,
      parcelsEligible: 10,
      assembliesGenerated: 5,
      centres: [],
      activeKey: "old",
      hiddenKeys: [],
      showAllAssemblies: true,
      updatedAt: new Date().toISOString(),
    });

    const parcelTarget = resolveMapTarget(new URLSearchParams("parcelId=NSW999&lat=-33.95&lng=151.12"));
    expect(loadScanSession()?.sessionId).toBe("scan_parramatta");
    expect(shouldRestoreScanSession(parcelTarget)).toBe(false);
    clearScanSession();
  });
});
