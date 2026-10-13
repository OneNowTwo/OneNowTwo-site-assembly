import { describe, expect, it } from "vitest";
import {
  buildPersistedMapSearchParams,
  isMapTargetPending,
  shouldRewriteMapUrlView,
  shouldStartMapTargetApply,
} from "@/lib/map/map-target-apply";

const CANDIDATE_KEY = "index:cmv4nd4ug00id0pfhzbe0b48r";
const BEXLEY = { lat: -33.95645, lng: 151.13318, zoom: 18 };
const SYDNEY = { lat: -33.868, lng: 151.21, zoom: 11 };

describe("MapTarget apply lifecycle + URL ownership (Fix #7)", () => {
  describe("A — pending target blocks stale Sydney viewport URL rewrite, then apply completes", () => {
    it("candidate pending + stale zoom-11 viewport → URL lat/lng/zoom not rewritten", () => {
      const applied: string | null = null;
      const applying = CANDIDATE_KEY;

      expect(
        isMapTargetPending({ targetKey: CANDIDATE_KEY, appliedTargetKey: applied }),
      ).toBe(true);

      expect(
        shouldRewriteMapUrlView({
          pathname: "/map",
          targetKey: CANDIDATE_KEY,
          appliedTargetKey: applied,
        }),
      ).toBe(false);

      // Simulate what persistClientState would do if the guard were missing:
      const wouldHaveRewritten = buildPersistedMapSearchParams({
        currentSearch: `?candidateId=cmv4nd4ug00id0pfhzbe0b48r&lat=${BEXLEY.lat}&lng=${BEXLEY.lng}&zoom=${BEXLEY.zoom}`,
        lat: SYDNEY.lat,
        lng: SYDNEY.lng,
        zoom: SYDNEY.zoom,
      });
      expect(wouldHaveRewritten.get("zoom")).toBe("11");
      expect(wouldHaveRewritten.get("candidateId")).toBe("cmv4nd4ug00id0pfhzbe0b48r");

      // Guard forbids rewrite while applying/pending — candidate fetch may still complete.
      expect(applying).toBe(CANDIDATE_KEY);
      expect(
        shouldStartMapTargetApply({
          targetKey: CANDIDATE_KEY,
          appliedTargetKey: applied,
          applyingTargetKey: applying,
        }),
      ).toBe(false);
    });

    it("after apply marks applied, candidate parcels path is unblocked for URL ownership handoff", () => {
      const applied = CANDIDATE_KEY;
      expect(
        isMapTargetPending({ targetKey: CANDIDATE_KEY, appliedTargetKey: applied }),
      ).toBe(false);
      expect(
        shouldRewriteMapUrlView({
          pathname: "/map",
          targetKey: CANDIDATE_KEY,
          appliedTargetKey: applied,
        }),
      ).toBe(true);
    });
  });

  describe("B — same mapTarget key re-render does not duplicate / cancel in-flight apply", () => {
    it("second effect entry with same key while applying → do not start again", () => {
      expect(
        shouldStartMapTargetApply({
          targetKey: CANDIDATE_KEY,
          appliedTargetKey: null,
          applyingTargetKey: CANDIDATE_KEY,
        }),
      ).toBe(false);
    });

    it("already applied same key → skip", () => {
      expect(
        shouldStartMapTargetApply({
          targetKey: CANDIDATE_KEY,
          appliedTargetKey: CANDIDATE_KEY,
          applyingTargetKey: null,
        }),
      ).toBe(false);
    });

    it("different key while another is applying → start (gen bump abandons prior)", () => {
      expect(
        shouldStartMapTargetApply({
          targetKey: "index:other",
          appliedTargetKey: null,
          applyingTargetKey: CANDIDATE_KEY,
        }),
      ).toBe(true);
    });
  });

  describe("C — after apply, legitimate viewport persist may update view and keep candidateId", () => {
    it("rewrites lat/lng/zoom but preserves candidateId", () => {
      const applied = CANDIDATE_KEY;
      expect(
        shouldRewriteMapUrlView({
          pathname: "/map",
          targetKey: CANDIDATE_KEY,
          appliedTargetKey: applied,
        }),
      ).toBe(true);

      const next = buildPersistedMapSearchParams({
        currentSearch:
          "?candidateId=cmv4nd4ug00id0pfhzbe0b48r&lat=-33.95645&lng=151.13318&zoom=18",
        lat: -33.9565,
        lng: 151.1332,
        zoom: 17.5,
      });
      expect(next.get("candidateId")).toBe("cmv4nd4ug00id0pfhzbe0b48r");
      expect(next.get("lat")).toBe("-33.95650");
      expect(next.get("lng")).toBe("151.13320");
      expect(next.get("zoom")).toBe("17.5");
    });
  });

  describe("D — plain Map with no pending entity target keeps viewport persistence", () => {
    it("no target → rewrite allowed on /map", () => {
      expect(
        shouldRewriteMapUrlView({
          pathname: "/map",
          targetKey: null,
          appliedTargetKey: null,
        }),
      ).toBe(true);

      const next = buildPersistedMapSearchParams({
        currentSearch: "?lat=-33.86800&lng=151.21000&zoom=11",
        lat: -33.87,
        lng: 151.22,
        zoom: 14,
      });
      expect(next.get("lat")).toBe("-33.87000");
      expect(next.get("zoom")).toBe("14");
      expect(next.get("candidateId")).toBeNull();
    });

    it("non-/map pathname → never rewrite", () => {
      expect(
        shouldRewriteMapUrlView({
          pathname: "/today",
          targetKey: null,
          appliedTargetKey: null,
        }),
      ).toBe(false);
    });
  });

  describe("race sequence (A+B combined)", () => {
    it("stale Sydney viewport during pending apply cannot own URL; in-flight completes once", () => {
      let applied: string | null = null;
      let applying: string | null = null;
      let fetchStarts = 0;
      let replaceStateCalls = 0;
      let parcelsApplied = 0;

      // 1) candidate target arrives
      const targetKey = CANDIDATE_KEY;
      if (
        shouldStartMapTargetApply({
          targetKey,
          appliedTargetKey: applied,
          applyingTargetKey: applying,
        })
      ) {
        applying = targetKey;
        fetchStarts += 1;
      }

      // 2) initial Leaflet viewport emits stale Sydney zoom 11
      const mayRewrite = shouldRewriteMapUrlView({
        pathname: "/map",
        targetKey,
        appliedTargetKey: applied,
      });
      if (mayRewrite) {
        replaceStateCalls += 1;
        buildPersistedMapSearchParams({
          currentSearch: `?candidateId=cmv4nd4ug00id0pfhzbe0b48r&lat=${BEXLEY.lat}&lng=${BEXLEY.lng}&zoom=${BEXLEY.zoom}`,
          ...SYDNEY,
        });
      }
      expect(mayRewrite).toBe(false);
      expect(replaceStateCalls).toBe(0);

      // 3) same key re-render (URL/searchParams identity churn)
      const restart = shouldStartMapTargetApply({
        targetKey,
        appliedTargetKey: applied,
        applyingTargetKey: applying,
      });
      expect(restart).toBe(false);
      expect(fetchStarts).toBe(1);

      // 4) candidate fetch completes → apply parcels + mark applied
      parcelsApplied = 2;
      applied = targetKey;
      applying = null;

      expect(parcelsApplied).toBe(2);
      expect(
        isMapTargetPending({ targetKey, appliedTargetKey: applied }),
      ).toBe(false);

      // 5) later pan may persist view
      expect(
        shouldRewriteMapUrlView({
          pathname: "/map",
          targetKey,
          appliedTargetKey: applied,
        }),
      ).toBe(true);
    });
  });
});
