import { NextResponse } from "next/server";
import { z } from "zod";
import { valueProperty, valuationProviderStatus } from "@/lib/data-sources/valuation-service";
import { jsonError, requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const parcelSchema = z.object({
  externalParcelId: z.string().min(1).max(80),
  address: z.string().nullable().optional(),
  suburb: z.string().nullable().optional(),
  areaSqm: z.number().positive(),
  domainPropertyId: z.string().nullable().optional(),
  userValue: z.number().positive().nullable().optional(),
  userLow: z.number().positive().nullable().optional(),
  userHigh: z.number().positive().nullable().optional(),
  comparableDerived: z.number().positive().nullable().optional(),
  preferUserOverride: z.boolean().optional(),
});

const bodySchema = z.object({
  parcels: z.array(parcelSchema).min(1).max(40),
  prefer: z.enum(["domain", "proptrack", "auto"]).optional(),
});

/** GET — credential / waterfall status (no secrets). */
export async function GET() {
  return NextResponse.json(valuationProviderStatus());
}

/** POST — value one or more parcels via Domain → PropTrack → comps → user waterfall. */
export async function POST(req: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid valuation request");

  const results = await Promise.all(
    parsed.data.parcels.map(async (p) => {
      const valuation = await valueProperty({
        externalParcelId: p.externalParcelId,
        address: p.address,
        suburb: p.suburb,
        areaSqm: p.areaSqm,
        domainPropertyId: p.domainPropertyId,
        userValue: p.userValue,
        userLow: p.userLow,
        userHigh: p.userHigh,
        comparableDerived: p.comparableDerived,
        preferUserOverride: p.preferUserOverride,
        prefer: parsed.data.prefer,
      });
      return { externalParcelId: p.externalParcelId, valuation };
    }),
  );

  return NextResponse.json({
    results,
    status: valuationProviderStatus(),
  });
}
