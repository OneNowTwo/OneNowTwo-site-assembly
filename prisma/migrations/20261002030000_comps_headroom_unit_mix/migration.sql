-- CreateEnum
CREATE TYPE "ComparableSaleType" AS ENUM ('ACQUISITION', 'EXIT');

-- CreateEnum
CREATE TYPE "MarketValueSource" AS ENUM ('USER_ESTIMATE', 'COMPARABLE_DERIVED', 'LIVE_PROVIDER', 'SYSTEM_ESTIMATE', 'DEMO');

-- AlterTable Opportunity
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "acquisitionHeadroom" DOUBLE PRECISION;
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "acquisitionHeadroomPercent" DOUBLE PRECISION;
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "assemblyUplift" DOUBLE PRECISION;
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "theoreticalGfa" DOUBLE PRECISION;
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "achievableGfa" DOUBLE PRECISION;
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "saleableArea" DOUBLE PRECISION;
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "unitCount" INTEGER;
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "totalNonLandCost" DOUBLE PRECISION;
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "targetMoc" DOUBLE PRECISION;

-- AlterTable OpportunityParcel
ALTER TABLE "OpportunityParcel" ADD COLUMN IF NOT EXISTS "marketValueSource" "MarketValueSource";
ALTER TABLE "OpportunityParcel" ADD COLUMN IF NOT EXISTS "marketValueConfidence" TEXT;
ALTER TABLE "OpportunityParcel" ADD COLUMN IF NOT EXISTS "strategicWeight" DOUBLE PRECISION;
ALTER TABLE "OpportunityParcel" ADD COLUMN IF NOT EXISTS "negotiationHeadroom" DOUBLE PRECISION;
ALTER TABLE "OpportunityParcel" ADD COLUMN IF NOT EXISTS "ownerPremiumAmount" DOUBLE PRECISION;
ALTER TABLE "OpportunityParcel" ADD COLUMN IF NOT EXISTS "ownerPremiumPercent" DOUBLE PRECISION;
ALTER TABLE "OpportunityParcel" ADD COLUMN IF NOT EXISTS "criticalityScore" DOUBLE PRECISION;

-- CreateTable ComparableSale
CREATE TABLE IF NOT EXISTS "ComparableSale" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "parcelId" TEXT,
    "type" "ComparableSaleType" NOT NULL,
    "address" TEXT NOT NULL,
    "salePrice" DOUBLE PRECISION NOT NULL,
    "saleDate" TIMESTAMP(3),
    "propertyType" TEXT,
    "bedrooms" DOUBLE PRECISION,
    "bathrooms" DOUBLE PRECISION,
    "parking" DOUBLE PRECISION,
    "landArea" DOUBLE PRECISION,
    "internalArea" DOUBLE PRECISION,
    "externalArea" DOUBLE PRECISION,
    "saleableArea" DOUBLE PRECISION,
    "pricePerSqm" DOUBLE PRECISION,
    "newBuildStatus" TEXT,
    "unitType" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "sourceReference" TEXT,
    "included" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "distanceM" DOUBLE PRECISION,
    "dataDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComparableSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable UnitType
CREATE TABLE IF NOT EXISTS "UnitType" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "count" INTEGER NOT NULL DEFAULT 0,
    "avgInternalArea" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgExternalArea" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgSaleableArea" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "salePricePerUnit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pricePerSqm" DOUBLE PRECISION,
    "revenue" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnitType_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "Opportunity_acquisitionHeadroom_idx" ON "Opportunity"("acquisitionHeadroom");
CREATE INDEX IF NOT EXISTS "ComparableSale_opportunityId_type_idx" ON "ComparableSale"("opportunityId", "type");
CREATE INDEX IF NOT EXISTS "UnitType_opportunityId_idx" ON "UnitType"("opportunityId");

-- ForeignKeys
DO $$ BEGIN
  ALTER TABLE "ComparableSale" ADD CONSTRAINT "ComparableSale_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ComparableSale" ADD CONSTRAINT "ComparableSale_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "Parcel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "UnitType" ADD CONSTRAINT "UnitType_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
