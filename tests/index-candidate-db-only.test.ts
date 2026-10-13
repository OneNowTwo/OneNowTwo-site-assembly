import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isLiveDeepScanEnabled } from "@/lib/live-deep-scan";

const routePath = resolve(__dirname, "../src/app/api/map/index-candidate/route.ts");
const routeSrc = readFileSync(routePath, "utf8");

describe("INDEX_CANDIDATE map route is strictly DB-only", () => {
  it("does not import hydrateExactParcelsForIndexCandidate", () => {
    expect(routeSrc).not.toMatch(/hydrateExactParcelsForIndexCandidate/);
    // Only the DB-only helper is allowed from parcel-service.
    expect(routeSrc).toMatch(
      /import\s*\{\s*getStoredParcelsByExternalIds\s*\}\s*from\s*["']@\/lib\/parcel-service["']/,
    );
  });

  it("does not import NSW cadastre / planning / scan paths", () => {
    expect(routeSrc).not.toMatch(/@\/lib\/data-sources\/nsw-cadastre/);
    expect(routeSrc).not.toMatch(/@\/lib\/data-sources\/nsw-planning/);
    expect(routeSrc).not.toMatch(/getParcelsByExternalIds/);
    expect(routeSrc).not.toMatch(/getParcelsForBBox/);
    expect(routeSrc).not.toMatch(/scanArea/);
  });

  it("reads stored parcels only and never writes", () => {
    expect(routeSrc).toMatch(/getStoredParcelsByExternalIds/);
    expect(routeSrc).not.toMatch(/prisma\.siteCandidateIndex\.update/);
    expect(routeSrc).not.toMatch(/upsertParcel/);
    expect(routeSrc).toMatch(/geometryStatus/);
    expect(routeSrc).toMatch(/"MISSING"/);
  });

  it("keeps live deep scan disabled by default", () => {
    expect(isLiveDeepScanEnabled()).toBe(false);
  });
});
