-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('WATCHING', 'ANALYSING', 'FEASIBLE', 'ACQUIRING', 'CONTROLLED', 'REJECTED', 'HOLD');

-- CreateEnum
CREATE TYPE "AcquisitionStage" AS ENUM ('NOT_RESEARCHED', 'OWNER_IDENTIFIED', 'READY_TO_APPROACH', 'LETTER_SENT', 'DOOR_KNOCKED', 'CONTACT_MADE', 'INTERESTED', 'PRICE_DISCUSSED', 'OFFER_PREPARED', 'OFFER_MADE', 'NEGOTIATING', 'OPTION_CONTRACT', 'CONTROLLED', 'DECLINED', 'HOLD');

-- CreateEnum
CREATE TYPE "DataSource" AS ENUM ('LIVE_NSW', 'CACHED_NSW', 'MANUAL');

-- CreateEnum
CREATE TYPE "ScenarioType" AS ENUM ('BASE', 'UPSIDE', 'DOWNSIDE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "OpportunityStatus" NOT NULL DEFAULT 'ANALYSING',
    "suburb" TEXT,
    "lga" TEXT,
    "demoFinancialData" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "inputs" JSONB NOT NULL DEFAULT '{}',
    "score" INTEGER,
    "scoreFactors" JSONB,
    "totalSiteArea" DOUBLE PRECISION,
    "grv" DOUBLE PRECISION,
    "maxLandBudget" DOUBLE PRECISION,
    "residualLandValue" DOUBLE PRECISION,
    "profit" DOUBLE PRECISION,
    "marginOnCost" DOUBLE PRECISION,
    "combinedMarketValue" DOUBLE PRECISION,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Parcel" (
    "id" TEXT NOT NULL,
    "externalParcelId" TEXT NOT NULL,
    "source" "DataSource" NOT NULL DEFAULT 'LIVE_NSW',
    "lot" TEXT,
    "section" TEXT,
    "dp" TEXT,
    "lotIdString" TEXT,
    "address" TEXT,
    "suburb" TEXT,
    "geometry" JSONB NOT NULL,
    "centroidLat" DOUBLE PRECISION NOT NULL,
    "centroidLng" DOUBLE PRECISION NOT NULL,
    "areaSqm" DOUBLE PRECISION NOT NULL,
    "zone" TEXT,
    "zoneName" TEXT,
    "fsr" DOUBLE PRECISION,
    "heightM" DOUBLE PRECISION,
    "minLotSizeSqm" DOUBLE PRECISION,
    "heritage" TEXT,
    "planningInstrument" TEXT,
    "lga" TEXT,
    "isStrata" BOOLEAN NOT NULL DEFAULT false,
    "planningCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Parcel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityParcel" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "parcelId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "included" BOOLEAN NOT NULL DEFAULT true,
    "marketValue" DOUBLE PRECISION,
    "landValuePerSqm" DOUBLE PRECISION,
    "comparableValue" DOUBLE PRECISION,
    "maxAllocationOverride" DOUBLE PRECISION,
    "openingOfferOverride" DOUBLE PRECISION,
    "maximumOffer" DOUBLE PRECISION,
    "openingOffer" DOUBLE PRECISION,
    "ownerPremium" DOUBLE PRECISION,
    "critical" BOOLEAN,
    "acquisitionStage" "AcquisitionStage" NOT NULL DEFAULT 'NOT_RESEARCHED',
    "lastContactAt" TIMESTAMP(3),
    "nextAction" TEXT,
    "nextActionDate" TIMESTAMP(3),
    "approachNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpportunityParcel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnerContact" (
    "id" TEXT NOT NULL,
    "opportunityParcelId" TEXT NOT NULL,
    "name" TEXT,
    "ownerType" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "mailingAddress" TEXT,
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OwnerContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcquisitionActivity" (
    "id" TEXT NOT NULL,
    "opportunityParcelId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "note" TEXT,
    "activityDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextAction" TEXT,
    "nextActionDate" TIMESTAMP(3),
    "stageFrom" "AcquisitionStage",
    "stageTo" "AcquisitionStage",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcquisitionActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeasibilityScenario" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scenarioType" "ScenarioType" NOT NULL,
    "assumptions" JSONB NOT NULL,
    "results" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeasibilityScenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlobalAssumptions" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "values" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlobalAssumptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanningSnapshot" (
    "id" TEXT NOT NULL,
    "parcelId" TEXT NOT NULL,
    "source" "DataSource" NOT NULL,
    "data" JSONB NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanningSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Opportunity_status_idx" ON "Opportunity"("status");

-- CreateIndex
CREATE INDEX "Opportunity_updatedAt_idx" ON "Opportunity"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Parcel_externalParcelId_key" ON "Parcel"("externalParcelId");

-- CreateIndex
CREATE INDEX "OpportunityParcel_acquisitionStage_idx" ON "OpportunityParcel"("acquisitionStage");

-- CreateIndex
CREATE UNIQUE INDEX "OpportunityParcel_opportunityId_parcelId_key" ON "OpportunityParcel"("opportunityId", "parcelId");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerContact_opportunityParcelId_key" ON "OwnerContact"("opportunityParcelId");

-- CreateIndex
CREATE INDEX "AcquisitionActivity_opportunityParcelId_activityDate_idx" ON "AcquisitionActivity"("opportunityParcelId", "activityDate");

-- CreateIndex
CREATE UNIQUE INDEX "FeasibilityScenario_opportunityId_scenarioType_key" ON "FeasibilityScenario"("opportunityId", "scenarioType");

-- CreateIndex
CREATE INDEX "PlanningSnapshot_parcelId_retrievedAt_idx" ON "PlanningSnapshot"("parcelId", "retrievedAt");

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityParcel" ADD CONSTRAINT "OpportunityParcel_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityParcel" ADD CONSTRAINT "OpportunityParcel_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "Parcel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerContact" ADD CONSTRAINT "OwnerContact_opportunityParcelId_fkey" FOREIGN KEY ("opportunityParcelId") REFERENCES "OpportunityParcel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcquisitionActivity" ADD CONSTRAINT "AcquisitionActivity_opportunityParcelId_fkey" FOREIGN KEY ("opportunityParcelId") REFERENCES "OpportunityParcel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeasibilityScenario" ADD CONSTRAINT "FeasibilityScenario_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningSnapshot" ADD CONSTRAINT "PlanningSnapshot_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "Parcel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
