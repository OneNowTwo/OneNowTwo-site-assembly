import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { lotLabel } from "@/lib/opportunity-service";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await prisma.opportunityParcel.findMany({
    where: { included: true, opportunity: { status: { not: "REJECTED" } } },
    include: {
      parcel: { select: { address: true, lot: true, section: true, dp: true, areaSqm: true } },
      opportunity: { select: { id: true, name: true, demoFinancialData: true, status: true } },
      owner: { select: { name: true, ownerType: true } },
    },
    orderBy: [{ opportunity: { updatedAt: "desc" } }, { sortOrder: "asc" }],
  });
  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      opportunityId: r.opportunity.id,
      opportunityName: r.opportunity.name,
      demoFinancialData: r.opportunity.demoFinancialData,
      label: lotLabel(r.parcel),
      lotDp: `Lot ${r.parcel.lot ?? "?"}${r.parcel.section ? ` Sec ${r.parcel.section}` : ""} ${r.parcel.dp ?? ""}`.trim(),
      areaSqm: r.parcel.areaSqm,
      ownerName: r.owner?.name ?? null,
      ownerType: r.owner?.ownerType ?? null,
      marketValue: r.marketValue,
      openingOffer: r.openingOffer,
      maximumOffer: r.maximumOffer,
      ownerPremium: r.ownerPremium,
      critical: r.critical,
      acquisitionStage: r.acquisitionStage,
      lastContactAt: r.lastContactAt?.toISOString() ?? null,
      nextAction: r.nextAction,
      nextActionDate: r.nextActionDate?.toISOString() ?? null,
      updatedAt: r.updatedAt.toISOString(),
    })),
  );
}
