import type { FetchResult, NormalisedSourcePayload, SourceAdapter } from "../types";
import edgecliff from "../fixtures/edgecliff-woollahra.json";
import edgecliffBump from "../fixtures/edgecliff-woollahra-fsr-bump.json";
import innerWest from "../fixtures/inner-west-fairer-future.json";

/** Test-only override: when set, Edgecliff fixture adapter returns the FSR-bump pack. */
let edgecliffVariant: "base" | "fsr-bump" = "base";

export function setEdgecliffFixtureVariant(variant: "base" | "fsr-bump") {
  edgecliffVariant = variant;
}

export function getEdgecliffFixtureVariant(): "base" | "fsr-bump" {
  return edgecliffVariant;
}

export class EdgecliffFixtureAdapter implements SourceAdapter {
  readonly id = "fixture-edgecliff-woollahra";

  async fetch(): Promise<FetchResult> {
    const normalised = structuredClone(
      (edgecliffVariant === "fsr-bump" ? edgecliffBump : edgecliff) as NormalisedSourcePayload,
    );
    return {
      raw: { fixture: this.id, variant: edgecliffVariant },
      // Keep fixture checkedAt stable so unchanged re-runs hash-equal.
      normalised,
      sourceModifiedAt: normalised.checkedAt,
    };
  }
}

export class InnerWestFixtureAdapter implements SourceAdapter {
  readonly id = "fixture-inner-west-fairer-future";

  async fetch(): Promise<FetchResult> {
    const normalised = structuredClone(innerWest as NormalisedSourcePayload);
    return {
      raw: { fixture: this.id },
      normalised,
      sourceModifiedAt: normalised.checkedAt,
    };
  }
}

export const edgecliffFixtureAdapter = new EdgecliffFixtureAdapter();
export const innerWestFixtureAdapter = new InnerWestFixtureAdapter();
