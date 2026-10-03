import { describe, expect, it } from "vitest";
import type { Polygon } from "geojson";
import type { ParcelData } from "@/lib/types";
import { DEFAULT_ASSUMPTIONS, parseOpportunityInputs } from "@/lib/analysis/assumptions";
import { runAreaScan } from "@/lib/analysis/area-scan";
import { calculateAssemblyFeasibility, buildScanCalculationSnapshot } from "@/lib/analysis/assembly-feasibility";
import { analyseOpportunity, type OpportunityLot } from "@/lib/analysis/opportunity";
import { buildAdjacency } from "@/lib/analysis/geometry";
import type { NominatedCentre } from "@/lib/data-sources/housing-sepp-lmr";
import { loadMapState, saveMapState, saveScanSession, loadScanSession, clearScanSession, MAP_STATE_KEY, SCAN_SESSION_KEY } from "@/lib/map-state";

const ORIGIN = { lat: -33.835, lng: 151.218 };
const M_PER_DEG_LAT = 111_320;
const mPerDegLng = M_PER_DEG_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180);

function rect(x: number, y: number, w: number, h: number): Polygon {
  const p = (dx: number, dy: number) => [ORIGIN.lng + dx / mPerDegLng, ORIGIN.lat + dy / M_PER_DEG_LAT];
  return { type: "Polygon", coordinates: [[p(x, y), p(x + w, y), p(x + w, y + h), p(x, y + h), p(x, y)]] };
}

function parcel(id: string, x: number, opts: Partial<ParcelData> = {}): ParcelData {
  const areaSqm = 20 * 35;
  const geometry = rect(x, 0, 20, 35);
  const centroid: [number, number] = [ORIGIN.lng + (x + 10) / mPerDegLng, ORIGIN.lat + 17.5 / M_PER_DEG_LAT];
  return {
    externalParcelId: `nsw-cadid:${id}`,
    source: "LIVE_NSW",
    lot: id,
    section: null,
    dp: "DP999",
    lotIdString: `${id}//DP999`,
    address: `${10 + x} Undercliff Street`,
    suburb: "Neutral Bay",
    geometry,
    centroid,
    areaSqm,
    isStrata: false,
    planning: {
      zone: "R2",
      zoneName: "Low Density Residential",
      // Official LEP often unmapped / weak — the bug case.
      fsr: null,
      fsrStatus: "NO_MAPPED",
      fsrControls: [],
      heightM: 8.5,
      minLotSizeSqm: 450,
      heritage: "None mapped",
      planningInstrument: "North Sydney LEP 2013",
      lga: "NORTH SYDNEY",
      sources: {},
    },
    planningStatus: "ok",
    retrievedAt: "2026-10-02T00:00:00.000Z",
    ...opts,
  };
}

const centre: NominatedCentre = {
  id: "town-centre:neutral-bay",
  label: "Neutral Bay",
  layClass: "Town Centre",
  lng: ORIGIN.lng + 0.001,
  lat: ORIGIN.lat + 0.001,
  source: "test",
  retrievedAt: "2026-10-02T00:00:00.000Z",
};

describe("scan → analyse financial reconciliation", () => {
  it("persists modelled FSR so Analyse does not collapse to FSR 0 / GRV $0", () => {
    const parcels = [parcel("1", 0), parcel("2", 20), parcel("3", 40)];
    // Force LMR proximity via walking OK so modelled FSR is 0.8 for R2.
    const walkingByParcelId = new Map(
      parcels.map((p) => [
        p.externalParcelId,
        { status: "OK" as const, straightLineDistanceM: 400, walkingDistanceM: 520, provider: "test" },
      ]),
    );

    const scan = runAreaScan({
      parcels,
      centres: [centre],
      assumptions: DEFAULT_ASSUMPTIONS,
      maxResults: 5,
      walkingByParcelId,
    });

    expect(scan.candidates.length).toBeGreaterThan(0);
    const top = scan.candidates[0]!;
    expect(top.effectiveFsr).toBeGreaterThan(0);
    expect(top.maxPayable).toBeGreaterThan(0);
    expect(top.calculationSnapshot.modelledEffectiveFsr).toBeGreaterThan(0);
    expect(top.calculationSnapshot.grv).toBeGreaterThan(0);

    const X = top.existingValue;
    const Y = top.maxPayable!;
    const H = top.headroom!;

    // Simulate Analyse payload: same parcels + fsrOverride from scan snapshot.
    const inputs = parseOpportunityInputs({
      fsrOverride: top.calculationSnapshot.modelledEffectiveFsr,
      fsrOverrideKind: "SCAN_MODELLED",
      fsrOverrideCertainty: top.calculationSnapshot.effectiveCertainty,
      heightOverrideM: top.calculationSnapshot.effectiveHeightM,
      scanProvenance: {
        originType: "AREA_SCAN",
        scanSessionId: "scan_test",
        assemblyKey: top.key,
        scanRank: top.rank,
        scanCalculatedAt: top.calculationSnapshot.calculatedAt,
        calculationVersion: top.calculationSnapshot.version,
        scanCalculationSnapshot: top.calculationSnapshot,
      },
    });

    const lots: OpportunityLot[] = top.lotIds.map((id) => {
      const p = parcels.find((x) => x.externalParcelId === id)!;
      return {
        id,
        label: p.address ?? id,
        areaSqm: p.areaSqm,
        zone: p.planning?.zone ?? null,
        zoneName: p.planning?.zoneName ?? null,
        fsr: p.planning?.fsr ?? null,
        fsrStatus: p.planning?.fsrStatus ?? "NO_MAPPED",
        fsrControls: [],
        heightM: p.planning?.heightM ?? null,
        minLotSizeSqm: p.planning?.minLotSizeSqm ?? null,
        heritage: p.planning?.heritage ?? null,
        isStrata: p.isStrata,
        planningKnown: true,
        marketValue: null,
        geometry: p.geometry,
        included: true,
        maxAllocationOverride: null,
        openingOfferOverride: null,
        strategicWeight: null,
      };
    });

    // Without override — the bug: FSR disappears.
    const broken = analyseOpportunity(lots, DEFAULT_ASSUMPTIONS, parseOpportunityInputs({}));
    expect(broken.site.fsr).toBe(0);
    expect(broken.base.feasibility.grv).toBe(0);
    expect(broken.maxPayableToOwners).toBe(0);

    // With scan override — numbers must reconcile.
    const detailed = analyseOpportunity(lots, DEFAULT_ASSUMPTIONS, inputs, buildAdjacency(lots));
    expect(detailed.site.fsr).toBeCloseTo(top.calculationSnapshot.modelledEffectiveFsr!, 3);
    expect(detailed.site.fsr).toBeGreaterThan(0);
    expect(detailed.base.yield.achievableGfa).toBeGreaterThan(0);
    expect(detailed.base.feasibility.grv).toBeGreaterThan(0);
    expect(detailed.maxPayableToOwners).toBeGreaterThan(0);

    expect(detailed.combinedExistingValue).toBeCloseTo(X, -2);
    expect(detailed.maxPayableToOwners).toBeCloseTo(Y, -2);
    expect(detailed.acquisitionHeadroom).toBeCloseTo(H, -2);
    expect(Math.abs(detailed.maxPayableToOwners - detailed.combinedExistingValue - detailed.acquisitionHeadroom)).toBeLessThan(2);
  });

  it("shared calculateAssemblyFeasibility matches scan snapshot fields", () => {
    const parcels = [parcel("a", 0), parcel("b", 20)];
    const result = calculateAssemblyFeasibility({
      parcels,
      assumptions: DEFAULT_ASSUMPTIONS,
      centres: [centre],
      effectiveByParcelId: new Map(
        parcels.map((p) => [
          p.externalParcelId,
          {
            lep: { fsr: null, heightM: 8.5, label: "LEP", source: "t", certainty: "NOT_APPLICABLE" as const },
            statePolicy: { fsr: 0.8, heightM: 9.5, label: "STATE", source: "t", certainty: "STATE_POLICY_CANDIDATE" as const },
            modelled: { fsr: 0.8, heightM: 9.5, label: "MODELLED", source: "t", certainty: "REQUIRES_PLANNING_CONFIRMATION" as const },
            fsrUplift: 0.8,
            lmr: {
              centreName: "Neutral Bay",
              band: "OUTER_400_800" as const,
              distanceM: 500,
              straightLineDistanceM: 400,
              walkingDistanceM: null,
              distanceBasis: "STRAIGHT_LINE_APPROXIMATION" as const,
              walkingStatus: "NOT_CHECKED" as const,
              developmentType: "rfb",
              zoneEligible: true,
              exclusionNotes: [],
            },
          },
        ]),
      ),
    });
    const snap = buildScanCalculationSnapshot(result, parcels);
    expect(snap.modelledEffectiveFsr).toBe(0.8);
    expect(snap.maxPayable).toBe(result.metrics.maxPayableToOwners);
    expect(snap.existingValue).toBe(result.metrics.combinedValue);
    expect(snap.headroom).toBeCloseTo(snap.maxPayable - snap.existingValue, 0);
    expect(snap.grv).toBeGreaterThan(0);
  });
});

describe("map / scan session persistence", () => {
  it("round-trips map centre/zoom/query and scan session without requiring a re-scan", () => {
    const store = new Map<string, string>();
    const ls = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    };
    // jsdom/localStorage may already exist in vitest — patch.
    Object.defineProperty(globalThis, "localStorage", { value: ls, configurable: true });
    Object.defineProperty(globalThis, "window", { value: globalThis, configurable: true });

    saveMapState({
      lat: -33.831,
      lng: 151.218,
      zoom: 16.5,
      query: "Neutral Bay",
      zoneFill: true,
      zoningWms: false,
      updatedAt: "2026-10-02T00:00:00.000Z",
    });
    const map = loadMapState();
    expect(map?.lat).toBeCloseTo(-33.831);
    expect(map?.query).toBe("Neutral Bay");
    expect(map?.zoom).toBe(16.5);

    saveScanSession({
      sessionId: "scan_abc",
      query: "Neutral Bay",
      bbox: { west: 151.2, south: -33.84, east: 151.23, north: -33.82 },
      lat: -33.831,
      lng: 151.218,
      zoom: 16.5,
      candidates: [{ key: "a|b", rank: 1 }],
      families: [{ familyId: "family:a|b", best: { key: "a|b" }, alternatives: [] }],
      messages: [],
      progress: [],
      parcelsConsidered: 260,
      parcelsEligible: 260,
      assembliesGenerated: 16,
      centres: [],
      activeKey: "a|b",
      hiddenKeys: [],
      showAllAssemblies: true,
      updatedAt: "2026-10-02T00:00:00.000Z",
    });
    const session = loadScanSession();
    expect(session?.sessionId).toBe("scan_abc");
    expect(session?.candidates).toHaveLength(1);
    expect(session?.activeKey).toBe("a|b");
    expect(session?.parcelsEligible).toBe(260);

    clearScanSession();
    expect(loadScanSession()).toBeNull();
    expect(store.has(MAP_STATE_KEY)).toBe(true);
    expect(store.has(SCAN_SESSION_KEY)).toBe(false);
  });
});
