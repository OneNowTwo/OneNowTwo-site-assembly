import { NextResponse } from "next/server";
import { z } from "zod";
import { findDevelopmentSites } from "@/lib/find/find-sites";
import { jsonError } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const bodySchema = z.object({
  state: z.string().optional(),
  lga: z.string().nullable().optional(),
  suburb: z.string().nullable().optional(),
  centreQuery: z.string().nullable().optional(),
  strategy: z.enum(["APARTMENTS", "CO_LIVING", "TOWNHOUSES", "GENERAL_RESIDENTIAL"]).optional(),
  zone: z.string().nullable().optional(),
  minCurrentFsr: z.number().nullable().optional(),
  maxCurrentFsr: z.number().nullable().optional(),
  minProposedFsr: z.number().nullable().optional(),
  maxProposedFsr: z.number().nullable().optional(),
  minSiteAreaSqm: z.number().nullable().optional(),
  maxSiteAreaSqm: z.number().nullable().optional(),
  singleLotOnly: z.boolean().nullable().optional(),
  maxOwners: z.number().nullable().optional(),
  excludeStrata: z.boolean().nullable().optional(),
  maxStationDistanceM: z.number().nullable().optional(),
  insidePlanningChangeArea: z.boolean().nullable().optional(),
  keySiteOnly: z.boolean().nullable().optional(),
  minRequiredParcelCount: z.number().nullable().optional(),
  minHeadroom: z.number().nullable().optional(),
  minScore: z.number().nullable().optional(),
  naturalLanguage: z.string().nullable().optional(),
  west: z.number().optional(),
  south: z.number().optional(),
  east: z.number().optional(),
  north: z.number().optional(),
  maxResults: z.number().int().min(3).max(30).optional(),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid find request");
  try {
    const result = await findDevelopmentSites(parsed.data);
    return NextResponse.json(result);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Find failed", 503);
  }
}
