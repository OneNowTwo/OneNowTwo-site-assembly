/**
 * Acceptance for the SAME 8 multi-site validation sites.
 * Simulates Planning Portal down (null lot FSR) + INDEX snapshot handoff.
 * Truthful Planning required / Value required = PASS; fake zeroes = FAIL.
 */
import { describe, expect, it } from "vitest";
import { analyseOpportunity } from "@/lib/analysis/opportunity";
import { DEFAULT_ASSUMPTIONS, parseOpportunityInputs } from "@/lib/analysis/assumptions";
import {
  displayEffectiveFsr,
  displayPlanningMoney,
  effectiveFsrSurfacesAgree,
} from "@/lib/analysis/planning-economics-display";
import { row } from "./helpers";

const A = { ...DEFAULT_ASSUMPTIONS, revenueMode: "UNIT_MIX" as const, planningAdjustment: 0.9 };

/** Same 8 sites from docs/multi-site-mvp-validation.md / selected-sites.json */
const SITES = [
  {
    tag: "2lot-mapped-near",
    name: "Warialda Street, Kogarah",
    lga: "BAYSIDE",
    lots: 2,
    areaPerLot: 912,
    indexFsr: 0.7,
    before: { hdrFsr: "—", bodyFsr: "0.0:1", grv: "$0", maxPay: "$0", result: "FAIL" },
  },
  {
    tag: "3lot-mapped-near",
    name: "Hector Street, Chester Hill",
    lga: "CANTERBURY-BANKSTOWN",
    lots: 3,
    areaPerLot: 761,
    indexFsr: 0.75,
    before: { hdrFsr: "—", bodyFsr: "0.0:1", grv: "$0", maxPay: "$0", result: "FAIL" },
  },
  {
    tag: "2lot-mapped-station",
    name: "Wellington Road, Chester Hill",
    lga: "CANTERBURY-BANKSTOWN",
    lots: 2,
    areaPerLot: 916,
    indexFsr: 0.75,
    before: { hdrFsr: "—", bodyFsr: "0.0:1", grv: "$0", maxPay: "$0", result: "FAIL" },
  },
  {
    tag: "2lot-no-fsr",
    name: "Fletcher Street, Northmead",
    lga: "CITY OF PARRAMATTA",
    lots: 2,
    areaPerLot: 981,
    indexFsr: null as number | null,
    before: { hdrFsr: "—", bodyFsr: "0.0:1", grv: "$0", maxPay: "$0", result: "FAIL" },
  },
  {
    tag: "5lot-no-fsr",
    name: "Carter Street, Cammeray",
    lga: "NORTH SYDNEY",
    lots: 5,
    areaPerLot: 402,
    indexFsr: null as number | null,
    before: { hdrFsr: "—", bodyFsr: "0.0:1", grv: "$0", maxPay: "$0", result: "FAIL" },
  },
  {
    tag: "proposed-near",
    name: "Liverpool Road, Ashfield",
    lga: "INNER WEST",
    lots: 2,
    areaPerLot: 819,
    indexFsr: null as number | null,
    before: { hdrFsr: "—", bodyFsr: "0.0:1", grv: "$0", maxPay: "$0", result: "FAIL" },
  },
  {
    tag: "uplift-small",
    name: "Hardy Street, Hurlstone Park",
    lga: "INNER WEST",
    lots: 2,
    areaPerLot: 989,
    indexFsr: 0.7,
    before: { hdrFsr: "—", bodyFsr: "0.0:1", grv: "$0", maxPay: "$0", result: "FAIL" },
  },
  {
    tag: "weak-far",
    name: "Ellsworth Drive, Tregear",
    lga: "BLACKTOWN",
    lots: 2,
    areaPerLot: 967,
    indexFsr: null as number | null,
    before: { hdrFsr: "—", bodyFsr: "0.0:1", grv: "$0", maxPay: "$0", result: "FAIL" },
  },
] as const;

function portalDownLots(n: number, areaPerLot: number) {
  const lots = row(n);
  for (const l of lots) {
    l.fsr = null;
    l.fsrStatus = "NO_MAPPED";
    l.fsrControls = [];
    l.zone = "R2";
    l.heightM = 8.5;
    l.areaSqm = areaPerLot;
    l.marketValue = 1_100_000;
  }
  return lots;
}

describe("pass-2 acceptance: same 8 validation sites", () => {
  const results: Array<{
    tag: string;
    name: string;
    lots: number;
    before: string;
    after: string;
    pass: boolean;
    reason: string;
  }> = [];

  for (const site of SITES) {
    it(`${site.tag} — ${site.name}`, () => {
      const lots = portalDownLots(site.lots, site.areaPerLot);
      // Simulate Analyse mis-click duplicate then dedupe (2-lot stays 2).
      const assemblyIds = lots.map((l) => l.id);
      const withDup = [...assemblyIds, assemblyIds[0]!];
      const unique = [...new Set(withDup)];
      expect(unique).toHaveLength(site.lots);

      const inputs = parseOpportunityInputs(
        site.indexFsr != null
          ? {
              indexPlanningSnapshot: {
                candidateId: `cand-${site.tag}`,
                canonicalKey: unique.join("|"),
                currentFsr: site.indexFsr,
                source: "SITE_CANDIDATE_INDEX",
                provenance: "STORED_OFFICIAL_NSW_PLANNING",
              },
            }
          : {},
      );
      const analysis = analyseOpportunity(
        lots.filter((l) => unique.includes(l.id)),
        A,
        inputs,
      );

      const eff = analysis.planningSnapshot.effectiveControls.effectiveFsr;
      const hdr = displayEffectiveFsr(eff, analysis.feasibilityCalculable);
      const body = displayEffectiveFsr(analysis.calculation.effectiveFsr, analysis.feasibilityCalculable);
      const grv = displayPlanningMoney(analysis.base.feasibility.grv, analysis.feasibilityCalculable, {
        compact: true,
      });
      const maxPay = displayPlanningMoney(analysis.maxPayableToOwners, analysis.feasibilityCalculable, {
        compact: true,
      });

      expect(effectiveFsrSurfacesAgree([hdr, body])).toBe(true);
      // Fake zeroes are always FAIL.
      expect(body).not.toBe("0.0:1");
      expect(grv).not.toBe("$0");
      expect(maxPay).not.toBe("$0");

      let pass = false;
      let reason = "";
      if (site.indexFsr != null) {
        expect(analysis.feasibilityCalculable).toBe(true);
        expect(eff).toBe(site.indexFsr);
        expect(analysis.planningSnapshot.effectiveControls.fsrSource).toBe("INDEX_SNAPSHOT");
        expect(analysis.base.feasibility.grv).toBeGreaterThan(0);
        expect(analysis.maxPayableToOwners).toBeGreaterThan(0);
        pass = true;
        reason = `INDEX_SNAPSHOT ${site.indexFsr}:1 · calculable economics`;
      } else {
        // Truthful incomplete — Planning required, not fake zeroes.
        expect(analysis.feasibilityCalculable).toBe(false);
        expect(hdr).toBe("—");
        expect(body).toBe("—");
        expect(grv).toBe("—");
        expect(maxPay).toBe("—");
        pass = true;
        reason = "Planning required (truthful incomplete — no index FSR)";
      }

      results.push({
        tag: site.tag,
        name: site.name,
        lots: site.lots,
        before: `${site.before.hdrFsr}/${site.before.bodyFsr} · GRV ${site.before.grv}`,
        after: `${hdr} · GRV ${grv} · max ${maxPay}`,
        pass,
        reason,
      });
    });
  }

  it("summary: 8/8 product PASS (calculable or truthful incomplete)", () => {
    expect(results).toHaveLength(8);
    expect(results.every((r) => r.pass)).toBe(true);
    const calculable = results.filter((r) => r.reason.includes("INDEX_SNAPSHOT")).length;
    const incomplete = results.filter((r) => r.reason.includes("Planning required")).length;
    expect(calculable + incomplete).toBe(8);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ calculable, incomplete, results }, null, 2));
  });
});
