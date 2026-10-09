-- Source Watcher / development intelligence engine

CREATE TYPE "SourceTransport" AS ENUM ('API', 'ARCGIS', 'WFS', 'JSON', 'HTML', 'PDF', 'RSS', 'FIXTURE', 'OTHER');
CREATE TYPE "SourceCategory" AS ENUM ('CURRENT_CONTROLS', 'PLANNING_PROPOSAL', 'STATE_LED_REZONING', 'COUNCIL_STRATEGIC', 'KEY_SITE', 'HDA', 'MAJOR_PROJECTS', 'DA_CDC_PCC', 'DCP', 'COUNCIL_AGENDA', 'ENVIRONMENT', 'TRANSPORT', 'PROPERTY_SALES', 'OTHER');
CREATE TYPE "SourceRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'UNCHANGED', 'FAILED');
CREATE TYPE "IntelChangeKind" AS ENUM ('PLANNING_PROPOSAL_CREATED', 'PLANNING_STATUS_CHANGED', 'ZONE_PROPOSED_CHANGE', 'FSR_PROPOSED_CHANGE', 'HEIGHT_PROPOSED_CHANGE', 'KEY_SITE_CREATED', 'KEY_SITE_CHANGED', 'ASSEMBLY_REQUIREMENT_CHANGED', 'AFFORDABLE_HOUSING_RATE_CHANGED', 'DCP_CHANGED', 'HDA_RECORD_PUBLISHED', 'HDA_RECOMMENDATION_CHANGED', 'SSD_DECLARED', 'SSD_STATUS_CHANGED', 'DA_LODGED', 'DA_APPROVED', 'PCC_ISSUED', 'COUNCIL_RESOLUTION', 'ENVIRONMENTAL_LAYER_CHANGED', 'SOURCE_REFRESHED', 'OTHER');

CREATE TABLE "SourceRegistry" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "authority" TEXT NOT NULL,
    "category" "SourceCategory" NOT NULL,
    "jurisdiction" TEXT NOT NULL DEFAULT 'NSW',
    "sourceType" "SourceTransport" NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "pollFrequency" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL DEFAULT '1',
    "licence" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "lastSuccessfulAt" TIMESTAMP(3),
    "lastContentHash" TEXT,
    "etag" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceRegistry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SourceRun" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "status" "SourceRunStatus" NOT NULL DEFAULT 'QUEUED',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "contentHash" TEXT,
    "snapshotId" TEXT,
    "eventsCreated" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SourceSnapshot" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contentHash" TEXT NOT NULL,
    "sourceModifiedAt" TIMESTAMP(3),
    "parserVersion" TEXT NOT NULL,
    "raw" JSONB,
    "normalised" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IntelChangeEvent" (
    "id" TEXT NOT NULL,
    "kind" "IntelChangeKind" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "sourceId" TEXT,
    "snapshotId" TEXT,
    "changeKey" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "geometry" JSONB,
    "affectedParcelHints" JSONB,
    "watchItemIds" JSONB,
    "href" TEXT,
    "importance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntelChangeEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlanningChangeArea" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "authority" TEXT,
    "lgas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "suburbs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceId" TEXT,
    "sourceUrl" TEXT,
    "exhibitionEnd" TIMESTAMP(3),
    "bbox" JSONB,
    "geometry" JSONB,
    "proposedControls" JSONB NOT NULL DEFAULT '{}',
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanningChangeArea_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KeySite" (
    "id" TEXT NOT NULL,
    "planningChangeAreaId" TEXT NOT NULL,
    "externalKeySiteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "geometry" JSONB,
    "bbox" JSONB,
    "requiredParcelHints" JSONB,
    "optionalParcelHints" JSONB,
    "currentControls" JSONB,
    "proposedControls" JSONB,
    "incentiveControls" JSONB,
    "requirements" JSONB,
    "conditions" JSONB,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KeySite_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SourceRegistry_category_enabled_idx" ON "SourceRegistry"("category", "enabled");
CREATE INDEX "SourceRegistry_enabled_lastCheckedAt_idx" ON "SourceRegistry"("enabled", "lastCheckedAt");
CREATE INDEX "SourceRun_sourceId_createdAt_idx" ON "SourceRun"("sourceId", "createdAt");
CREATE INDEX "SourceRun_status_createdAt_idx" ON "SourceRun"("status", "createdAt");
CREATE INDEX "SourceSnapshot_sourceId_retrievedAt_idx" ON "SourceSnapshot"("sourceId", "retrievedAt");
CREATE UNIQUE INDEX "SourceSnapshot_sourceId_contentHash_key" ON "SourceSnapshot"("sourceId", "contentHash");
CREATE UNIQUE INDEX "IntelChangeEvent_changeKey_key" ON "IntelChangeEvent"("changeKey");
CREATE INDEX "IntelChangeEvent_kind_createdAt_idx" ON "IntelChangeEvent"("kind", "createdAt");
CREATE INDEX "IntelChangeEvent_createdAt_idx" ON "IntelChangeEvent"("createdAt");
CREATE INDEX "IntelChangeEvent_sourceId_createdAt_idx" ON "IntelChangeEvent"("sourceId", "createdAt");
CREATE INDEX "PlanningChangeArea_status_idx" ON "PlanningChangeArea"("status");
CREATE UNIQUE INDEX "KeySite_planningChangeAreaId_externalKeySiteId_key" ON "KeySite"("planningChangeAreaId", "externalKeySiteId");
CREATE INDEX "KeySite_externalKeySiteId_idx" ON "KeySite"("externalKeySiteId");

ALTER TABLE "SourceRun" ADD CONSTRAINT "SourceRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "SourceRegistry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourceSnapshot" ADD CONSTRAINT "SourceSnapshot_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "SourceRegistry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KeySite" ADD CONSTRAINT "KeySite_planningChangeAreaId_fkey" FOREIGN KEY ("planningChangeAreaId") REFERENCES "PlanningChangeArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;
