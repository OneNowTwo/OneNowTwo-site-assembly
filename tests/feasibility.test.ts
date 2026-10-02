import { describe, expect, it } from "vitest";
import { computeFeasibility, testPurchasePrice } from "@/lib/analysis/feasibility";
import { computeYield } from "@/lib/analysis/yield";
import { DEFAULT_ASSUMPTIONS, type Assumptions } from "@/lib/analysis/assumptions";

const zeroCosts: Assumptions = {
  ...DEFAULT_ASSUMPTIONS,
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
};

describe("yield", () => {
  it("matches the brief example: 3,000 sqm × 2.0, 82%, 92 sqm → ~53 dwellings", () => {
    const y = computeYield({ siteAreaSqm: 3000, fsr: 2, efficiency: 0.82, siteCoverage: 0.5, floorToFloorM: 3.1, avgDwellingSizeSqm: 92, carSpacesPerDwelling: 1, heightLimitM: 20 });
    expect(y.gfa).toBe(6000);
    expect(y.saleableArea).toBeCloseTo(4920);
    expect(y.dwellings).toBe(53);
    expect(y.storeys).toBe(4);
    expect(y.heightCompliant).toBe(true);
  });
});

describe("residual land value", () => {
  it("solves L = GRV/(1+M) − C on margin on cost", () => {
    // GRV = 10,000 × $10,000 = $100m; C = construction 10,000 × $5,000 = $50m (no other costs)
    const f = computeFeasibility({
      gfa: 10_000,
      saleableArea: 10_000,
      dwellings: 100,
      lotCount: 5,
      a: { ...zeroCosts, salePricePerSqm: 10_000, constructionCostPerSqm: 5_000, targetMarginOnCost: 0.25 },
    });
    expect(f.grv).toBe(100_000_000);
    expect(f.nonLandCosts).toBe(50_000_000);
    expect(f.residualLandValue).toBeCloseTo(100_000_000 / 1.25 - 50_000_000); // $30m
    expect(f.maxAcquisitionBudget).toBeCloseTo(30_000_000);
    expect(f.marginOnCost).toBeCloseTo(0.25);
  });

  it("accounts for land-dependent acquisition costs without double counting", () => {
    const a = { ...zeroCosts, salePricePerSqm: 10_000, constructionCostPerSqm: 5_000, targetMarginOnCost: 0.2, acquisitionCostPct: 0.055, landFinancePct: 0.045 };
    const f = computeFeasibility({ gfa: 10_000, saleableArea: 10_000, dwellings: 100, lotCount: 5, a });
    const L = 100_000_000 / 1.2 - 50_000_000;
    expect(f.residualLandValue).toBeCloseTo(L);
    expect(f.landCostMultiplier).toBeCloseTo(1.1);
    expect(f.maxAcquisitionBudget).toBeCloseTo(L / 1.1);
    // Buying at the budget, with acquisition costs added on top, lands exactly on the target margin.
    const t = testPurchasePrice(f, f.maxAcquisitionBudget);
    expect(t.totalLandCost).toBeCloseTo(L);
    expect(t.marginOnCost).toBeCloseTo(0.2, 10);
    expect(f.acquisitionCosts + f.landHoldingCosts + f.maxAcquisitionBudget).toBeCloseTo(L);
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

  it("builds non-land costs from every line item", () => {
    const a = { ...DEFAULT_ASSUMPTIONS, salePricePerSqm: 15_000, constructionCostPerSqm: 4_500 };
    const f = computeFeasibility({ gfa: 4_000, saleableArea: 3_200, dwellings: 37, lotCount: 5, a });
    const construction = 4_000 * 4_500;
    const demolition = 5 * a.demolitionPerLot;
    const consultants = construction * a.consultantsPct;
    const statutory = 37 * a.statutoryFeesPerDwelling;
    const contingency = (construction + demolition + consultants) * a.contingencyPct;
    const grv = 3_200 * 15_000;
    const pre = construction + demolition + consultants + statutory + contingency + grv * (a.marketingPct + a.sellingCostPct);
    expect(f.grv).toBe(grv);
    expect(f.nonLandCosts).toBeCloseTo(pre * (1 + a.financePct));
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
    expect(f.maxAcquisitionBudget).toBeLessThan(0);
  });
});
