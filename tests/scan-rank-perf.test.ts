import { describe, expect, it } from "vitest";
import { filterSalesNearPoint, type NswRegisteredSale } from "@/lib/data-sources/nsw-property-sales";
import { estimateFromNswComps } from "@/lib/data-sources/nsw-comparable-valuation";
import { NSW_SALES_SOURCE_LABEL } from "@/lib/data-sources/nsw-property-sales";

function sale(partial: Partial<NswRegisteredSale> & { lng: number; lat: number; salePrice: number }): NswRegisteredSale {
  return {
    propid: partial.propid ?? 1,
    dealing: partial.dealing ?? "AA123",
    houseNo: partial.houseNo ?? "10",
    street: partial.street ?? "Example Street",
    suburb: partial.suburb ?? "Balgowlah",
    postcode: 2093,
    address: partial.address ?? "10 Example Street Balgowlah",
    salePrice: partial.salePrice,
    saleDate: partial.saleDate ?? "2024-06-01",
    saleDateMs: partial.saleDateMs ?? Date.parse("2024-06-01T00:00:00Z"),
    landAreaSqm: partial.landAreaSqm ?? 450,
    strata: false,
    lastSale: true,
    lng: partial.lng,
    lat: partial.lat,
    source: NSW_SALES_SOURCE_LABEL,
  };
}

describe("scan rank perf — shared sales pool", () => {
  it("filters prefetched pool to the same radius cut as point queries", () => {
    const subject = { lng: 151.26, lat: -33.795 };
    const near = sale({ lng: 151.2605, lat: -33.7952, salePrice: 2_800_000, dealing: "N1" });
    const far = sale({ lng: 151.28, lat: -33.81, salePrice: 3_000_000, dealing: "F1" });
    const filtered = filterSalesNearPoint([near, far], subject.lng, subject.lat, 1000);
    expect(filtered.map((s) => s.dealing)).toEqual(["N1"]);
  });

  it("produces identical valuation from the same sales pool for the same subject", async () => {
    const lng = 151.261;
    const lat = -33.794;
    const pool = [
      sale({ lng: 151.2612, lat: -33.7941, salePrice: 2_650_000, landAreaSqm: 420, dealing: "A1", address: "1 Alpha St Balgowlah" }),
      sale({ lng: 151.2605, lat: -33.7938, salePrice: 2_900_000, landAreaSqm: 480, dealing: "A2", address: "2 Alpha St Balgowlah" }),
      sale({ lng: 151.262, lat: -33.7945, salePrice: 2_750_000, landAreaSqm: 440, dealing: "A3", address: "3 Alpha St Balgowlah" }),
      sale({ lng: 151.259, lat: -33.795, salePrice: 3_100_000, landAreaSqm: 500, dealing: "A4", address: "4 Alpha St Balgowlah" }),
      sale({ lng: 151.263, lat: -33.7935, salePrice: 2_550_000, landAreaSqm: 400, dealing: "A5", address: "5 Alpha St Balgowlah" }),
    ];
    const a = await estimateFromNswComps({
      externalParcelId: "nsw-cadid:1",
      address: "12 Beta Street, Balgowlah",
      suburb: "Balgowlah",
      areaSqm: 450,
      lng,
      lat,
      prefetchedSales: pool,
    });
    const b = await estimateFromNswComps({
      externalParcelId: "nsw-cadid:1",
      address: "12 Beta Street, Balgowlah",
      suburb: "Balgowlah",
      areaSqm: 450,
      lng,
      lat,
      prefetchedSales: filterSalesNearPoint(pool, lng, lat, 1000),
    });
    expect(a.mid).toBe(b.mid);
    expect(a.low).toBe(b.low);
    expect(a.high).toBe(b.high);
    expect(a.numberOfComps).toBe(b.numberOfComps);
    expect(a.status).toBe(b.status);
  });
});
