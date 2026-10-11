-- Progressive Greater Sydney indexing + candidate provenance

CREATE TYPE "SydneyIndexRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETE', 'FAILED');
CREATE TYPE "SydneyIndexBatchStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETE', 'FAILED');
CREATE TYPE "CandidateProvenance" AS ENUM ('INDEX_DISCOVERY', 'USER_ANALYSED', 'KEY_SITE', 'PLANNING_CHANGE');

ALTER TABLE "SiteCandidateIndex" ADD COLUMN "provenance" "CandidateProvenance" NOT NULL DEFAULT 'INDEX_DISCOVERY';
ALTER TABLE "SiteCandidateIndex" ADD COLUMN "indexRunId" TEXT;
ALTER TABLE "SiteCandidateIndex" ADD COLUMN "indexBatchId" TEXT;
CREATE INDEX "SiteCandidateIndex_provenance_idx" ON "SiteCandidateIndex"("provenance");
CREATE INDEX "SiteCandidateIndex_indexRunId_idx" ON "SiteCandidateIndex"("indexRunId");

-- Rows previously seeded from Opportunities/KeySites are not Sydney discovery.
UPDATE "SiteCandidateIndex"
SET "lifecycleStatus" = 'ARCHIVED'
WHERE "opportunityId" IS NOT NULL
   OR "kind" IN ('KEY_SITE', 'PLANNING_AREA')
   OR ("sourceRefs" IS NOT NULL AND ("sourceRefs"::text LIKE '%opportunity%' OR "sourceRefs"::text LIKE '%planningChangeAreaId%'));

CREATE TABLE "SydneyIndexRun" (
    "id" TEXT NOT NULL,
    "marketScope" TEXT NOT NULL DEFAULT 'sydney-metro',
    "status" "SydneyIndexRunStatus" NOT NULL DEFAULT 'QUEUED',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "totalBatches" INTEGER NOT NULL DEFAULT 0,
    "completedBatches" INTEGER NOT NULL DEFAULT 0,
    "failedBatches" INTEGER NOT NULL DEFAULT 0,
    "parcelsProcessed" INTEGER NOT NULL DEFAULT 0,
    "candidateCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "notes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SydneyIndexRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SydneyIndexRun_status_createdAt_idx" ON "SydneyIndexRun"("status", "createdAt");
CREATE INDEX "SydneyIndexRun_marketScope_status_idx" ON "SydneyIndexRun"("marketScope", "status");

CREATE TABLE "SydneyIndexBatch" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "lga" TEXT NOT NULL,
    "region" TEXT,
    "bbox" JSONB NOT NULL,
    "tileKey" TEXT NOT NULL,
    "status" "SydneyIndexBatchStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "parcelsLoaded" INTEGER NOT NULL DEFAULT 0,
    "candidatesGenerated" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SydneyIndexBatch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SydneyIndexBatch_runId_tileKey_key" ON "SydneyIndexBatch"("runId", "tileKey");
CREATE INDEX "SydneyIndexBatch_runId_status_idx" ON "SydneyIndexBatch"("runId", "status");
CREATE INDEX "SydneyIndexBatch_lga_status_idx" ON "SydneyIndexBatch"("lga", "status");
ALTER TABLE "SydneyIndexBatch" ADD CONSTRAINT "SydneyIndexBatch_runId_fkey" FOREIGN KEY ("runId") REFERENCES "SydneyIndexRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
