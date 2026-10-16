import { describe, expect, it } from "vitest";
import {
  layerSucceeded,
  mergePlanningControls,
  planningControlsFromSnapshot,
  latestSourceRetrievedAt,
} from "@/lib/planning/planning-persist";
import type { PlanningControls } from "@/lib/types";

const prev: PlanningControls = {
  zone: "R3",
  zoneName: "Medium Density Residential",
  fsr: 0.7,
  fsrStatus: "MAPPED",
  fsrControls: [{ fsr: 0.7, epiName: "Bayside LEP", lga: "BAYSIDE", layClass: null, intersectionAreaSqm: 645, intersectionShare: 1 }],
  heightM: 8.5,
  minLotSizeSqm: 450,
  heritage: "None mapped",
  planningInstrument: "Bayside Local Environmental Plan 2021",
  lga: "BAYSIDE",
  sources: {
    zone: { kind: "OFFICIAL", source: "NSW Planning · Zoning", retrievedAt: "2026-10-16T06:00:20.350Z" },
    fsr: { kind: "OFFICIAL", source: "NSW Planning · FSR", retrievedAt: "2026-10-16T06:00:20.350Z" },
    heightM: { kind: "OFFICIAL", source: "NSW Planning · Height", retrievedAt: "2026-10-16T06:00:20.350Z" },
  },
};

describe("planning persist merge / snapshot restore", () => {
  it("restores sources, fsrStatus and fsrControls from snapshot JSON", () => {
    const restored = planningControlsFromSnapshot(
      {
        zone: "R3",
        zoneName: "Medium Density Residential",
        fsr: 0.7,
        fsrStatus: "MAPPED",
        fsrControls: prev.fsrControls,
        heightM: 8.5,
        sources: prev.sources,
        planningInstrument: prev.planningInstrument,
        lga: "BAYSIDE",
      },
      null,
    );
    expect(restored?.sources.fsr?.retrievedAt).toBe("2026-10-16T06:00:20.350Z");
    expect(restored?.fsrStatus).toBe("MAPPED");
    expect(restored?.fsrControls).toHaveLength(1);
    expect(latestSourceRetrievedAt(restored)).toBe("2026-10-16T06:00:20.350Z");
  });

  it("keeps UNAVAILABLE distinct from NO_MAPPED when restoring snapshot", () => {
    const unavailable = planningControlsFromSnapshot(
      {
        zone: "R3",
        fsr: null,
        fsrStatus: "UNAVAILABLE",
        fsrControls: [],
        heightM: 8.5,
        sources: {
          zone: { kind: "OFFICIAL", source: "z", retrievedAt: "2026-10-16T06:00:20.350Z" },
          heightM: { kind: "OFFICIAL", source: "h", retrievedAt: "2026-10-16T06:00:20.350Z" },
        },
      },
      null,
    );
    expect(unavailable?.fsrStatus).toBe("UNAVAILABLE");
    expect(unavailable?.sources.fsr).toBeUndefined();

    const noMapped = planningControlsFromSnapshot(
      {
        zone: "R3",
        fsr: null,
        fsrStatus: "NO_MAPPED",
        fsrControls: [],
        sources: {
          zone: { kind: "OFFICIAL", source: "z", retrievedAt: "2026-10-16T06:00:20.350Z" },
          fsr: { kind: "OFFICIAL", source: "f", retrievedAt: "2026-10-16T06:00:20.350Z" },
        },
      },
      null,
    );
    expect(noMapped?.fsrStatus).toBe("NO_MAPPED");
    expect(noMapped?.sources.fsr?.retrievedAt).toBe("2026-10-16T06:00:20.350Z");
  });

  it("preserves verified FSR when live FSR layer fails but zoning succeeds", () => {
    const live: PlanningControls = {
      zone: "R3",
      zoneName: "Medium Density Residential",
      fsr: null,
      fsrStatus: "UNAVAILABLE",
      fsrControls: [],
      heightM: null,
      minLotSizeSqm: null,
      heritage: null,
      planningInstrument: "Bayside Local Environmental Plan 2021",
      lga: "BAYSIDE",
      sources: {
        zone: { kind: "OFFICIAL", source: "NSW Planning · Zoning", retrievedAt: "2026-10-16T07:00:00.000Z" },
        // fsr / height absent → failed layers
      },
    };
    expect(layerSucceeded(live, "zone")).toBe(true);
    expect(layerSucceeded(live, "fsr")).toBe(false);

    const merged = mergePlanningControls(prev, live);
    expect(merged.zone).toBe("R3");
    expect(merged.sources.zone?.retrievedAt).toBe("2026-10-16T07:00:00.000Z");
    // Prior FSR preserved with original date
    expect(merged.fsr).toBe(0.7);
    expect(merged.fsrStatus).toBe("MAPPED");
    expect(merged.fsrControls).toHaveLength(1);
    expect(merged.sources.fsr?.retrievedAt).toBe("2026-10-16T06:00:20.350Z");
    expect(merged.heightM).toBe(8.5);
    expect(merged.sources.heightM?.retrievedAt).toBe("2026-10-16T06:00:20.350Z");
  });

  it("writes null FSR with NO_MAPPED when live FSR layer succeeds with no mapped control", () => {
    const live: PlanningControls = {
      zone: "R3",
      zoneName: "Medium Density Residential",
      fsr: null,
      fsrStatus: "NO_MAPPED",
      fsrControls: [],
      heightM: 8.5,
      minLotSizeSqm: null,
      heritage: "None mapped",
      planningInstrument: "Bayside Local Environmental Plan 2021",
      lga: "BAYSIDE",
      sources: {
        zone: { kind: "OFFICIAL", source: "z", retrievedAt: "2026-10-16T07:00:00.000Z" },
        fsr: { kind: "OFFICIAL", source: "f", retrievedAt: "2026-10-16T07:00:00.000Z" },
        heightM: { kind: "OFFICIAL", source: "h", retrievedAt: "2026-10-16T07:00:00.000Z" },
      },
    };
    const merged = mergePlanningControls(prev, live);
    expect(merged.fsr).toBeNull();
    expect(merged.fsrStatus).toBe("NO_MAPPED");
    expect(merged.sources.fsr?.retrievedAt).toBe("2026-10-16T07:00:00.000Z");
  });
});
