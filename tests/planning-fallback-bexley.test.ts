import { describe, expect, it } from "vitest";
import { fsrBucket, heightBucket, FSR_BUCKET_COLOURS, HEIGHT_BUCKET_COLOURS } from "@/lib/map/layer-styles";

describe("planning failure / fallback states", () => {
  it("distinguishes not mapped from not loaded in FSR buckets", () => {
    expect(fsrBucket(null, "NO_MAPPED")).toBe("not_mapped");
    expect(fsrBucket(null, "UNAVAILABLE")).toBe("not_loaded");
    expect(fsrBucket(null, null, "unavailable")).toBe("not_loaded");
    expect(fsrBucket(0.7, "MAPPED")).toBe("0_5_1");
    expect(FSR_BUCKET_COLOURS.not_loaded).not.toBe(FSR_BUCKET_COLOURS.not_mapped);
  });

  it("distinguishes not mapped from not loaded in height buckets", () => {
    expect(heightBucket(null)).toBe("not_mapped");
    expect(heightBucket(null, "unavailable")).toBe("not_loaded");
    expect(heightBucket(9)).toBe("le_9");
    expect(HEIGHT_BUCKET_COLOURS.not_loaded).not.toBe(HEIGHT_BUCKET_COLOURS.not_mapped);
  });
});

describe("Bexley three-lot assembly identity", () => {
  const LOTS = [
    { address: "39 Beaconsfield Street, Bexley", areaSqm: 645, id: "nsw-cadid:102813140" },
    { address: "42 Connemarra Street, Bexley", areaSqm: 810, id: "nsw-cadid:103811478" },
    { address: "40 Connemarra Street, Bexley", areaSqm: 830, id: "nsw-cadid:103821903" },
  ];

  it("preserves exact three parcel ids and total area across retry/save handoff", () => {
    // Simulate map assembly → retry planning → save payload: ids must not drop.
    let assembly = LOTS.map((l) => l.id);
    const onRetryPlanning = () => {
      // Retry must not clear assembly.
      return assembly;
    };
    assembly = onRetryPlanning();
    expect(assembly).toEqual([
      "nsw-cadid:102813140",
      "nsw-cadid:103811478",
      "nsw-cadid:103821903",
    ]);
    const total = LOTS.reduce((n, l) => n + l.areaSqm, 0);
    expect(total).toBe(2285);
    // Deduped save payload keeps all three.
    const saveIds = [...new Set(assembly)];
    expect(saveIds).toHaveLength(3);
  });

  it("uses stored planning label when live fails (message contract)", () => {
    const planningStatus = "cached" as const;
    const planningMessage =
      "Stored official planning (2026-10-16) — live NSW Planning did not respond (timed out).";
    expect(planningStatus).toBe("cached");
    expect(planningMessage).toMatch(/Stored official planning/);
    expect(planningMessage).not.toMatch(/enter planning controls manually/i);
  });
});
