import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { queryNswUrbanSalesNear, type NswRegisteredSale } from "@/lib/data-sources/nsw-property-sales";
import { publishFeedItem } from "./feed";
import { recordOpportunityChange } from "./change-history";
import { recomputeOpportunity, loadOpportunity } from "@/lib/opportunity-service";

function saleKey(s: NswRegisteredSale): string {
  return [s.dealing ?? "", s.propid ?? "", s.address, s.saleDate ?? "", s.salePrice].join("|");
}

async function bboxForWatch(item: { bbox: unknown; suburb: string | null; opportunityId: string | null; kind: string }) {
  if (item.bbox && typeof item.bbox === "object") {
    const b = item.bbox as { west: number; south: number; east: number; north: number };
    if ([b.west, b.south, b.east, b.north].every(Number.isFinite)) {
      return { lng: (b.west + b.east) / 2, lat: (b.south + b.north) / 2, radiusM: 1200 };
    }
  }
  if (item.opportunityId) {
    const opp = await loadOpportunity(item.opportunityId);
    const p = opp?.parcels[0]?.parcel;
    if (p) return { lng: p.centroidLng, lat: p.centroidLat, radiusM: 800 };
  }
  // Suburb-level: skip without geocode in monitor (scan schedule handles suburb rescans).
  return null;
}

export async function monitorSalesForUser(userId: string): Promise<{
  newSales: number;
  impactedOpportunities: number;
  events: { address: string; salePrice: number; opportunityId?: string }[];
}> {
  const watches = await prisma.watchItem.findMany({ where: { userId, active: true } });
  let newSales = 0;
  let impacted = 0;
  const events: { address: string; salePrice: number; opportunityId?: string }[] = [];

  for (const w of watches) {
    const centre = await bboxForWatch(w);
    if (!centre) continue;
    let sales: NswRegisteredSale[] = [];
    try {
      sales = await queryNswUrbanSalesNear({ lng: centre.lng, lat: centre.lat, radiusM: centre.radiusM, maxRecords: 40 });
    } catch {
      continue;
    }
    for (const s of sales) {
      const key = saleKey(s);
      const existing = await prisma.monitoredSale.findUnique({ where: { saleKey: key } });
      if (existing) {
        await prisma.monitoredSale.update({ where: { saleKey: key }, data: { lastSeenAt: new Date() } });
        continue;
      }
      await prisma.monitoredSale.create({
        data: {
          saleKey: key,
          address: s.address,
          suburb: s.suburb,
          salePrice: s.salePrice,
          saleDate: s.saleDateMs ? new Date(s.saleDateMs) : s.saleDate ? new Date(s.saleDate) : null,
          dealing: s.dealing,
          propid: s.propid,
          lng: s.lng,
          lat: s.lat,
          landAreaSqm: s.landAreaSqm,
          raw: s as unknown as Prisma.InputJsonValue,
        },
      });
      newSales += 1;

      // Match to watched opportunity parcels by suburb / proximity.
      const opps = await prisma.opportunity.findMany({
        where: {
          OR: [
            w.opportunityId ? { id: w.opportunityId } : undefined,
            w.suburb ? { suburb: { equals: w.suburb, mode: "insensitive" } } : undefined,
          ].filter(Boolean) as Prisma.OpportunityWhereInput[],
        },
        include: { parcels: { include: { parcel: true } }, comparableSales: true },
        take: 8,
      });

      for (const opp of opps) {
        const beforeHeadroom = opp.acquisitionHeadroom;
        const beforeValue = opp.combinedMarketValue;
        // Add as acquisition comp if not already present.
        const already = opp.comparableSales.some(
          (c) => c.address.toLowerCase() === s.address.toLowerCase() && Math.abs(c.salePrice - s.salePrice) < 1,
        );
        if (!already) {
          await prisma.comparableSale.create({
            data: {
              opportunityId: opp.id,
              type: "ACQUISITION",
              address: s.address,
              salePrice: s.salePrice,
              saleDate: s.saleDateMs ? new Date(s.saleDateMs) : null,
              landArea: s.landAreaSqm,
              source: "NSW_REGISTERED_SALE",
              sourceReference: s.dealing ?? String(s.propid ?? ""),
              included: true,
              notes: `Auto-imported by sales monitor · watch “${w.label}”`,
              dataDate: new Date(),
            },
          });
        }
        await recordOpportunityChange({
          opportunityId: opp.id,
          kind: "SALE",
          title: "New registered sale detected",
          summary: `${s.address} sold for $${Math.round(s.salePrice).toLocaleString("en-AU")}`,
          before: { combinedMarketValue: beforeValue, acquisitionHeadroom: beforeHeadroom },
          after: { salePrice: s.salePrice, address: s.address },
          reason: `NSW registered sale ${s.dealing ?? s.propid ?? ""}`,
          source: "sales-monitor",
        });
        await recomputeOpportunity(opp.id);
        const fresh = await prisma.opportunity.findUnique({ where: { id: opp.id } });
        await recordOpportunityChange({
          opportunityId: opp.id,
          kind: "HEADROOM",
          title: "Headroom recalculated after sale",
          summary: `Headroom ${(beforeHeadroom ?? 0).toLocaleString("en-AU")} → ${(fresh?.acquisitionHeadroom ?? 0).toLocaleString("en-AU")}`,
          before: { acquisitionHeadroom: beforeHeadroom, combinedMarketValue: beforeValue },
          after: {
            acquisitionHeadroom: fresh?.acquisitionHeadroom,
            combinedMarketValue: fresh?.combinedMarketValue,
          },
          reason: s.address,
          source: "sales-monitor",
        });
        await publishFeedItem({
          kind: "NEW_SALE",
          title: `New sale: ${s.address}`,
          summary: `Sold $${Math.round(s.salePrice).toLocaleString("en-AU")} · impacts ${opp.name}`,
          opportunityId: opp.id,
          watchItemId: w.id,
          headroom: fresh?.acquisitionHeadroom,
          headroomDelta: (fresh?.acquisitionHeadroom ?? 0) - (beforeHeadroom ?? 0),
          maxPayable: fresh?.maxLandBudget,
          payload: {
            sale: { address: s.address, salePrice: s.salePrice, previousEstimate: beforeValue },
            assemblyImpact: {
              existingValueDelta: (fresh?.combinedMarketValue ?? 0) - (beforeValue ?? 0),
              headroomBefore: beforeHeadroom,
              headroomAfter: fresh?.acquisitionHeadroom,
            },
          },
          importance: 6,
        });
        impacted += 1;
        events.push({ address: s.address, salePrice: s.salePrice, opportunityId: opp.id });
      }

      if (!opps.length) {
        await publishFeedItem({
          kind: "NEW_SALE",
          title: `New sale in ${s.suburb ?? w.label}`,
          summary: `${s.address} · $${Math.round(s.salePrice).toLocaleString("en-AU")}`,
          watchItemId: w.id,
          href: "/watching",
          importance: 3,
          payload: { sale: s },
        });
      }
    }
  }

  return { newSales, impactedOpportunities: impacted, events };
}
