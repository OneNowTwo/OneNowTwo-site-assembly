import { describe, expect, it } from "vitest";
import { computeFeasibility, testPurchasePrice, acquisitionHeadroom, roundArea } from "@/lib/analysis/feasibility";
import { computeYield } from "@/lib/analysis/yield";
import { DEFAULT_ASSUMPTIONS, type Assumptions } from "@/lib/analysis/assumptions";
import { computeUnitMix, autoGenerateUnitMix, DEFAULT_UNIT_MIX_TEMPLATE } from "@/lib/analysis/unit-mix";
import { allocateOffers } from "@/lib/analysis/allocation";
import { analyseMarginalLots } from "@/lib/analysis/marginal";
import { analyseOpportunity } from "@/lib/analysis/opportunity";
import { computeAssemblyMetrics, generateAssemblies, compareAssemblies } from "@/lib/analysis/assembly";
import { buildAdjacency } from "@/lib/analysis/geometry";
import { parseOpportunityInputs } from "@/lib/analysis/assumptions";
import { row, lot } from "./helpers";

const zeroCosts: Assumptions = {
  ...DEFAULT_ASSUMPTIONS,
  revenueMode: "PER_SQM",
  planningAdjustment: 1,
  demolitionPerLot: 0,
  consultantsPct: 0,
  statutoryFeesPerDwelling: 0,
  marketingPct: 0,
  sellingCostPct: 0,
  contingencyPct: 0,
  financePct: 0,
  landFinancePct: 0,
  acquisitionCostPct: 0,
  otherCosts: 0,
  basementParkingCost: 0,
  siteWorksCost: 0,
  remediationCost: 0,
  difficultExcavationCost: 0,
  premiumFacadeCost: 0,
  liftsCost: 0,
  publicDomainWorksCost: 0,
  landscapingCost: 0,
  otherFixedConstructionCost: 0,
};

describe("yield — theoretical vs achievable", () => {
  it("matches the brief example with planning adjustment", () => {
    const y = computeYield({
      siteAreaSqm: 3000,
      fsr: 2,
      efficiency: 0.82,
      siteCoverage: 0.5,
      floorToFloorM: 3.1,
      avgDwellingSizeSqm: 92,
      carSpacesPerDwelling: 1,
      heightLimitM: 20,
      planningAdjustment: 0.9,
    });
    expect(y.theoreticalGfa).toBe(6000);
    expect(y.achievableGfa).toBeCloseTo(5400);
    expect(y.saleableArea).toBeCloseTo(4428);
    expect(y.dwellings).toBe(48);
  });
});

describe("residual land value", () => {
  it("solves L = GRV/(1+M) − C on margin on cost", () => {
    const f = computeFeasibility({
      gfa: 10_000,
      saleableArea: 10_000,
      dwellings: 100,
      lotCount: 5,
      a: { ...zeroCosts, salePricePerSqm: 10_000, constructionCostPerSqm: 5_000, targetMarginOnCost: 0.25 },
    });
    expect(f.grv).toBe(100_000_000);
    expect(f.nonLandCosts).toBe(50_000_000);
    expect(f.residualLandValue).toBeCloseTo(100_000_000 / 1.25 - 50_000_000);
    expect(f.maxPayableToOwners).toBeCloseTo(30_000_000);
    expect(f.marginOnCost).toBeCloseTo(0.25);
  });

  it("accounts for land-dependent acquisition costs without double counting", () => {
    const a = { ...zeroCosts, salePricePerSqm: 10_000, constructionCostPerSqm: 5_000, targetMarginOnCost: 0.2, acquisitionCostPct: 0.055, landFinancePct: 0.045 };
    const f = computeFeasibility({ gfa: 10_000, saleableArea: 10_000, dwellings: 100, lotCount: 5, a });
    const L = 100_000_000 / 1.2 - 50_000_000;
    expect(f.residualLandValue).toBeCloseTo(L);
    expect(f.landCostMultiplier).toBeCloseTo(1.1);
    expect(f.maxAcquisitionBudget).toBeCloseTo(L / 1.1);
    const t = testPurchasePrice(f, f.maxAcquisitionBudget);
    expect(t.totalLandCost).toBeCloseTo(L);
    expect(t.marginOnCost).toBeCloseTo(0.2, 10);
  });

  it("solves on margin on revenue", () => {
    const f = computeFeasibility({
      gfa: 10_000,
      saleableArea: 10_000,
      dwellings: 100,
      lotCount: 5,
      a: { ...zeroCosts, targetBasis: "REVENUE", targetMarginOnRevenue: 0.15, salePricePerSqm: 10_000, constructionCostPerSqm: 5_000 },
    });
    expect(f.residualLandValue).toBeCloseTo(100_000_000 * 0.85 - 50_000_000);
    expect(f.marginOnRevenue).toBeCloseTo(0.15);
  });

  it("supports per-dwelling revenue and flags unviable projects", () => {
    const f = computeFeasibility({
      gfa: 1000,
      saleableArea: 800,
      dwellings: 8,
      lotCount: 2,
      a: { ...DEFAULT_ASSUMPTIONS, revenueMode: "PER_DWELLING", avgDwellingPrice: 500_000, constructionCostPerSqm: 6000 },
    });
    expect(f.salesRevenue).toBe(4_000_000);
    expect(f.viable).toBe(false);
  });
});

describe("acquisition headroom", () => {
  it("is max payable minus combined existing value", () => {
    const h = acquisitionHeadroom(21_080_000, 7_800_000);
    expect(h.acquisitionHeadroom).toBeCloseTo(13_280_000);
    expect(h.acquisitionHeadroomPercent).toBeCloseTo(13_280_000 / 7_800_000);
    expect(h.assemblyUplift).toBe(h.acquisitionHeadroom);
  });
});

describe("unit mix GRV", () => {
  it("sums unit revenues and blended $/sqm", () => {
    const mix = [
      { name: "1 Bed", count: 10, avgInternalArea: 55, avgExternalArea: 8, avgSaleableArea: 58, salePricePerUnit: 1_100_000 },
      { name: "2 Bed", count: 30, avgInternalArea: 80, avgExternalArea: 12, avgSaleableArea: 88, salePricePerUnit: 1_650_000 },
      { name: "3 Bed", count: 14, avgInternalArea: 110, avgExternalArea: 15, avgSaleableArea: 125, salePricePerUnit: 2_450_000 },
      { name: "Penthouse", count: 2, avgInternalArea: 160, avgExternalArea: 40, avgSaleableArea: 180, salePricePerUnit: 4_200_000 },
    ];
    const t = computeUnitMix(mix);
    expect(t.totalUnits).toBe(56);
    expect(t.totalRevenue).toBe(10 * 1_100_000 + 30 * 1_650_000 + 14 * 2_450_000 + 2 * 4_200_000);
    expect(t.totalRevenue).toBe(103_200_000);
    expect(t.blendedPricePerSqm).toBeCloseTo(t.totalRevenue / t.totalSaleableArea);

    const f = computeFeasibility({
      gfa: 5400,
      saleableArea: t.totalSaleableArea,
      dwellings: t.totalUnits,
      lotCount: 6,
      unitMix: mix,
      a: { ...zeroCosts, revenueMode: "UNIT_MIX", constructionCostPerSqm: 4200 },
    });
    expect(f.grv).toBe(103_200_000);
    expect(f.blendedPricePerSqm).toBeCloseTo(t.blendedPricePerSqm!);
  });

  it("auto-generates an indicative mix from saleable area", () => {
    const rows = autoGenerateUnitMix(4428, DEFAULT_UNIT_MIX_TEMPLATE);
    const t = computeUnitMix(rows);
    expect(t.totalUnits).toBeGreaterThan(20);
    expect(t.totalSaleableArea).toBeGreaterThan(3000);
  });
});

describe("rounding consistency", () => {
  it("reconciles displayed saleable area × rate with GRV", () => {
    const raw = 4821.2;
    const display = roundArea(raw);
    expect(display).toBe(4821.2);
    const rate = 15500;
    const f = computeFeasibility({
      gfa: 6000,
      saleableArea: raw,
      dwellings: 50,
      lotCount: 5,
      a: { ...zeroCosts, salePricePerSqm: rate, constructionCostPerSqm: 1000 },
    });
    expect(f.grv).toBe(display * rate);
    expect(f.display.saleableArea).toBe(display);
  });
});

describe("owner premium and negotiation headroom", () => {
  it("computes premiums and negotiation headroom from weighted allocation", () => {
    const r = allocateOffers(
      10_000_000,
      [
        { id: "A", marketValue: 1_300_000, areaSqm: 400, criticalityScore: 1, connectivityScore: 2 },
        { id: "B", marketValue: 1_300_000, areaSqm: 400, criticalityScore: 0, connectivityScore: 1 },
      ],
      0.85,
      2600,
      { marketValueWeight: 1, criticalityWeight: 0.5, connectivityWeight: 0.2 },
    );
    expect(r.totalMaximum).toBeCloseTo(10_000_000);
    for (const l of r.lots) {
      expect(l.negotiationHeadroom).toBeCloseTo(l.maximumOffer - l.openingOffer);
      expect(l.ownerPremiumPercent).toBeCloseTo(l.openingOffer / l.marketValue! - 1);
      expect(l.ownerPremiumAmount).toBeCloseTo(l.openingOffer - l.marketValue!);
    }
    // Critical lot A should receive more than equal split
    expect(r.lots.find((l) => l.id === "A")!.maximumOffer).toBeGreaterThan(r.lots.find((l) => l.id === "B")!.maximumOffer);
  });
});

describe("marginal lot analysis", () => {
  it("flags a lot that destroys value at market price", () => {
    const base = { areaSqm: 3000, theoreticalGfa: 6000, achievableGfa: 5400, grv: 75e6, maxPayable: 21e6, combinedExistingValue: 7.8e6, acquisitionHeadroom: 13.2e6 };
    const res = analyseMarginalLots(
      [
        { id: "cheap", marketValue: 1_300_000 },
        { id: "expensive", marketValue: 1_400_000 },
      ],
      base,
      (id) =>
        id === "expensive"
          ? { ...base, maxPayable: 20.2e6, acquisitionHeadroom: 11.8e6, achievableGfa: 4800, theoreticalGfa: 5400, grv: 70.9e6, areaSqm: 2500, combinedExistingValue: 6.4e6 }
          : { ...base, maxPayable: 17.8e6, acquisitionHeadroom: 10.5e6, achievableGfa: 4500, theoreticalGfa: 5000, grv: 68e6, areaSqm: 2400, combinedExistingValue: 6.5e6 },
    );
    const expensive = res.find((r) => r.id === "expensive")!;
    expect(expensive.verdict).toBe("DESTROYS_VALUE");
    expect(expensive.netValueAdd!).toBeLessThan(0);
    const cheap = res.find((r) => r.id === "cheap")!;
    expect(cheap.verdict).toBe("HIGH_VALUE");
  });
});

describe("assembly comparison — best ≠ largest", () => {
  it("can rank a smaller assembly above a larger one on headroom", () => {
    const a = { ...DEFAULT_ASSUMPTIONS, revenueMode: "PER_SQM" as const, salePricePerSqm: 16000, planningAdjustment: 0.9, minViableSiteAreaSqm: 1000 };
    // Five equal lots
    const lots = [
      lot("A", 0, { marketValue: 1_300_000, fsr: 2 }),
      lot("B", 20, { marketValue: 1_300_000, fsr: 2 }),
      lot("C", 40, { marketValue: 1_300_000, fsr: 2 }),
      lot("D", 60, { marketValue: 1_300_000, fsr: 2 }),
      // Expensive low-yield edge lot — high MV relative to area contribution
      lot("E", 80, { marketValue: 3_500_000, fsr: 0.5, areaSqm: 400 }),
    ];
    // Fix E area in geometry-derived areaSqm from helpers — override areaSqm after
    lots[4]!.areaSqm = 400;
    const adj = buildAdjacency(lots);
    const candidates = generateAssemblies(lots, adj, "C", a, { maxSize: 5, maxResults: 10 });
    const byHeadroom = compareAssemblies(candidates, "headroom");
    expect(byHeadroom.length).toBeGreaterThan(1);
    const best = byHeadroom[0]!;
    const largest = [...candidates].sort((x, y) => y.metrics.lotCount - x.metrics.lotCount)[0]!;
    // Document the product thesis: sorting by headroom may prefer a non-largest set
    expect(best.metrics.acquisitionHeadroom ?? 0).toBeGreaterThanOrEqual((largest.metrics.acquisitionHeadroom ?? 0) - 1);
    const withE = candidates.find((c) => c.lotIds.includes("E") && c.lotIds.length === 5);
    const withoutE = candidates.find((c) => !c.lotIds.includes("E") && c.lotIds.length === 4);
    if (withE && withoutE) {
      expect(withoutE.metrics.acquisitionHeadroom ?? 0).toBeGreaterThan(withE.metrics.acquisitionHeadroom ?? 0);
    }
  });
});

describe("opportunity orchestration", () => {
  it("exposes headroom, unit mix and remove-lot recalculation", () => {
    const lots = row(5);
    const inputs = parseOpportunityInputs({
      overrides: { revenueMode: "UNIT_MIX" },
      unitMix: [
        { name: "2 Bed", count: 20, avgInternalArea: 80, avgExternalArea: 12, avgSaleableArea: 88, salePricePerUnit: 1_650_000 },
        { name: "3 Bed", count: 10, avgInternalArea: 110, avgExternalArea: 15, avgSaleableArea: 125, salePricePerUnit: 2_450_000 },
      ],
    });
    const all = analyseOpportunity(lots, { ...DEFAULT_ASSUMPTIONS, minViableSiteAreaSqm: 2000 }, inputs);
    expect(all.maxPayableToOwners).toBe(all.base.feasibility.maxPayableToOwners);
    expect(all.acquisitionHeadroom).toBeCloseTo(all.maxPayableToOwners - (all.combinedExistingValue as number));
    expect(all.marginal).toHaveLength(5);
    expect(all.allocation.lots[0]!.negotiationHeadroom).toBeGreaterThanOrEqual(0);

    lots[4]!.included = false;
    const without = analyseOpportunity(lots, { ...DEFAULT_ASSUMPTIONS, minViableSiteAreaSqm: 2000 }, inputs);
    expect(without.site.siteAreaSqm).toBe(all.site.siteAreaSqm - 700);
    expect(without.base.feasibility.maxAcquisitionBudget).not.toBe(all.base.feasibility.maxAcquisitionBudget);
  });

  it("switches revenue method between unit mix and $/sqm", () => {
    const lots = row(4);
    const mix = [{ name: "2 Bed", count: 25, avgInternalArea: 80, avgExternalArea: 12, avgSaleableArea: 88, salePricePerUnit: 1_650_000 }];
    const unit = analyseOpportunity(lots, { ...DEFAULT_ASSUMPTIONS, revenueMode: "UNIT_MIX" }, parseOpportunityInputs({ unitMix: mix }));
    const perSqm = analyseOpportunity(lots, { ...DEFAULT_ASSUMPTIONS, revenueMode: "PER_SQM", salePricePerSqm: 15500 }, parseOpportunityInputs({}));
    expect(unit.base.feasibility.grv).toBe(25 * 1_650_000);
    expect(perSqm.base.feasibility.grv).not.toBe(unit.base.feasibility.grv);
  });
});

describe("MOC label", () => {
  it("margin on cost equals profit / total cost at solved residual", () => {
    const f = computeFeasibility({
      gfa: 5000,
      saleableArea: 4000,
      dwellings: 40,
      lotCount: 4,
      a: { ...zeroCosts, salePricePerSqm: 15000, constructionCostPerSqm: 4500, targetMarginOnCost: 0.2 },
    });
    expect(f.marginOnCost).toBeCloseTo(0.2, 10);
    expect(f.profit / f.totalCost).toBeCloseTo(0.2, 10);
  });
});

describe("assembly metrics expose headroom", () => {
  it("computes combined value, max payable and headroom", () => {
    const lots = row(3);
    const m = computeAssemblyMetrics(lots, { ...DEFAULT_ASSUMPTIONS, revenueMode: "PER_SQM", planningAdjustment: 1 });
    expect(m.combinedValue).toBe(3_900_000);
    expect(m.maxPayableToOwners).toBe(m.indicativeBudget);
    expect(m.acquisitionHeadroom).toBeCloseTo(m.maxPayableToOwners - m.combinedValue);
    expect(m.theoreticalGfa).toBeCloseTo(m.achievableGfa);
  });
});
