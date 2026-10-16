import { describe, expect, it } from "vitest";
import {
  fsrBucket,
  fsrColour,
  heightBucket,
  heritageKind,
  isHeritageMapped,
  FSR_BUCKET_COLOURS,
} from "@/lib/map/layer-styles";

describe("map layer styles", () => {
  it("treats missing / unmapped FSR as Not mapped — never as 0", () => {
    expect(fsrBucket(null)).toBe("not_mapped");
    expect(fsrBucket(undefined, "NO_MAPPED")).toBe("not_mapped");
    expect(fsrBucket(0, "NO_MAPPED")).toBe("not_mapped");
    expect(fsrBucket(0.8, "MAPPED")).toBe("0_5_1");
    expect(fsrColour(null)).toBe(FSR_BUCKET_COLOURS.not_mapped);
  });

  it("buckets current LEP height only", () => {
    expect(heightBucket(null)).toBe("not_mapped");
    expect(heightBucket(9)).toBe("le_9");
    expect(heightBucket(12)).toBe("9_12");
    expect(heightBucket(22)).toBe("gt_18");
  });

  it("does not infer no-heritage from missing data", () => {
    expect(heritageKind(null)).toBe("unknown");
    expect(isHeritageMapped(null)).toBe(false);
    expect(heritageKind("None mapped")).toBe("none");
    expect(heritageKind("Item — Foo House — Local")).toBe("item");
    expect(heritageKind("Heritage Conservation Area — Bar")).toBe("conservation");
    expect(isHeritageMapped("Item — Foo")).toBe(true);
  });
});
