-- AlterEnum
ALTER TYPE "MarketValueSource" ADD VALUE 'LIVE_AVM';
ALTER TYPE "MarketValueSource" ADD VALUE 'SUBURB_FALLBACK';
ALTER TYPE "MarketValueSource" ADD VALUE 'NO_VALUE';

-- AlterTable
ALTER TABLE "OpportunityParcel" ADD COLUMN "marketValueLow" DOUBLE PRECISION;
ALTER TABLE "OpportunityParcel" ADD COLUMN "marketValueHigh" DOUBLE PRECISION;
ALTER TABLE "OpportunityParcel" ADD COLUMN "marketValueProvider" TEXT;
ALTER TABLE "OpportunityParcel" ADD COLUMN "marketValueMethod" TEXT;
ALTER TABLE "OpportunityParcel" ADD COLUMN "marketValueCheckedAt" TIMESTAMP(3);
ALTER TABLE "OpportunityParcel" ADD COLUMN "marketValueNote" TEXT;
