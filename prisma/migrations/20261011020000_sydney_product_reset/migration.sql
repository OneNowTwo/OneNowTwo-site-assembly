-- Sydney-wide product reset: lifecycle, baseline runs, IntelligenceStory, SiteCandidateIndex

CREATE TYPE "ProductRecordStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'TEST', 'FIXTURE', 'SUPERSEDED');
CREATE TYPE "SourceRunPurpose" AS ENUM ('BASELINE', 'REFRESH', 'CHANGE');
CREATE TYPE "IntelligenceStoryKind" AS ENUM ('PLANNING_UPDATE', 'KEY_SITE_PROGRAM', 'DEVELOPMENT_ACTIVITY', 'MARKET', 'OTHER');

ALTER TABLE "Opportunity" ADD COLUMN "lifecycleStatus" "ProductRecordStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "Opportunity" ADD COLUMN "canonicalKey" TEXT;
ALTER TABLE "Opportunity" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Opportunity" ADD COLUMN "archivedReason" TEXT;
CREATE INDEX "Opportunity_lifecycleStatus_idx" ON "Opportunity"("lifecycleStatus");
CREATE INDEX "Opportunity_canonicalKey_idx" ON "Opportunity"("canonicalKey");

ALTER TABLE "SourceRun" ADD COLUMN "purpose" "SourceRunPurpose" NOT NULL DEFAULT 'REFRESH';
CREATE INDEX "SourceRun_purpose_createdAt_idx" ON "SourceRun"("purpose", "createdAt");

CREATE TABLE "IntelligenceStory" (
    "id" TEXT NOT NULL,
    "kind" "IntelligenceStoryKind" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "locationLabel" TEXT,
    "strategyTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dedupeKey" TEXT NOT NULL,
    "affectedSiteCount" INTEGER,
    "mapHref" TEXT,
    "findHref" TEXT,
    "sourceHref" TEXT,
    "importance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "material" BOOLEAN NOT NULL DEFAULT true,
    "lifecycleStatus" "ProductRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "windowStart" TIMESTAMP(3),
    "windowEnd" TIMESTAMP(3),
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "IntelligenceStory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IntelligenceStory_dedupeKey_key" ON "IntelligenceStory"("dedupeKey");
CREATE INDEX "IntelligenceStory_lifecycleStatus_material_importance_idx" ON "IntelligenceStory"("lifecycleStatus", "material", "importance");
CREATE INDEX "IntelligenceStory_createdAt_idx" ON "IntelligenceStory"("createdAt");

ALTER TABLE "IntelChangeEvent" ADD COLUMN "material" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "IntelChangeEvent" ADD COLUMN "lifecycleStatus" "ProductRecordStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "IntelChangeEvent" ADD COLUMN "storyId" TEXT;
ALTER TABLE "IntelChangeEvent" ADD COLUMN "runPurpose" "SourceRunPurpose";
CREATE INDEX "IntelChangeEvent_lifecycleStatus_material_createdAt_idx" ON "IntelChangeEvent"("lifecycleStatus", "material", "createdAt");
CREATE INDEX "IntelChangeEvent_storyId_idx" ON "IntelChangeEvent"("storyId");
ALTER TABLE "IntelChangeEvent" ADD CONSTRAINT "IntelChangeEvent_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "IntelligenceStory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "SiteCandidateIndex" (
    "id" TEXT NOT NULL,
    "canonicalKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "parcelIds" JSONB NOT NULL DEFAULT '[]',
    "address" TEXT,
    "suburb" TEXT,
    "lga" TEXT,
    "zone" TEXT,
    "siteAreaSqm" DOUBLE PRECISION,
    "lotCount" INTEGER,
    "owners" INTEGER,
    "currentFsr" DOUBLE PRECISION,
    "currentHeightM" DOUBLE PRECISION,
    "proposedFsr" DOUBLE PRECISION,
    "proposedHeightM" DOUBLE PRECISION,
    "keySiteStatus" TEXT,
    "stationDistanceM" DOUBLE PRECISION,
    "planningChangeFlags" JSONB,
    "developmentActivityFlags" JSONB,
    "lastSaleValue" DOUBLE PRECISION,
    "quickScore" DOUBLE PRECISION,
    "quickHeadroom" DOUBLE PRECISION,
    "maxPayable" DOUBLE PRECISION,
    "geometry" JSONB,
    "centroidLat" DOUBLE PRECISION,
    "centroidLng" DOUBLE PRECISION,
    "bbox" JSONB,
    "reasonHints" JSONB,
    "strategyScores" JSONB,
    "sourceRefs" JSONB,
    "opportunityId" TEXT,
    "lastEvaluatedAt" TIMESTAMP(3),
    "lifecycleStatus" "ProductRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SiteCandidateIndex_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SiteCandidateIndex_canonicalKey_key" ON "SiteCandidateIndex"("canonicalKey");
CREATE INDEX "SiteCandidateIndex_lifecycleStatus_quickScore_idx" ON "SiteCandidateIndex"("lifecycleStatus", "quickScore");
CREATE INDEX "SiteCandidateIndex_lga_suburb_idx" ON "SiteCandidateIndex"("lga", "suburb");
CREATE INDEX "SiteCandidateIndex_kind_idx" ON "SiteCandidateIndex"("kind");
CREATE INDEX "SiteCandidateIndex_lastEvaluatedAt_idx" ON "SiteCandidateIndex"("lastEvaluatedAt");

-- Mark fixture-derived intel as FIXTURE so Today ignores them by default.
UPDATE "IntelChangeEvent"
SET "lifecycleStatus" = 'FIXTURE', "material" = false
WHERE "sourceId" LIKE 'fixture-%' OR "changeKey" LIKE 'fixture-%';

-- Bootstrap / first-ingest SOURCE_REFRESHED events are baseline noise, not "changed today".
UPDATE "IntelChangeEvent"
SET "material" = false, "runPurpose" = 'BASELINE'
WHERE "kind" = 'SOURCE_REFRESHED' AND ("changeKey" LIKE '%:bootstrap:%' OR "title" ILIKE '%ingested%');

-- Engineering-only document churn is not developer intelligence by default.
UPDATE "IntelChangeEvent"
SET "material" = false
WHERE "kind" = 'SOURCE_DOCUMENT_CHANGED';
