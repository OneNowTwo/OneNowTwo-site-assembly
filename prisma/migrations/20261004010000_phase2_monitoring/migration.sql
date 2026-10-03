-- Phase 2: stickiness / monitoring layer

CREATE TYPE "WatchItemKind" AS ENUM ('SUBURB', 'MAP_AREA', 'PRECINCT', 'PARCEL', 'OPPORTUNITY');
CREATE TYPE "ScanCadence" AS ENUM ('MANUAL', 'DAILY', 'WEEKLY');
CREATE TYPE "ScanJobStatus" AS ENUM ('IDLE', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "FeedKind" AS ENUM ('NEW', 'IMPROVED', 'DECLINED', 'PLANNING_CHANGE', 'NEW_SALE', 'WATCHLIST_CHANGE', 'ALERT', 'REPORT');
CREATE TYPE "AlertChannel" AS ENUM ('IN_APP', 'EMAIL', 'PUSH');
CREATE TYPE "ChangeEventKind" AS ENUM ('STATUS', 'SCORE', 'HEADROOM', 'MAX_PAYABLE', 'GRV', 'EXISTING_VALUE', 'PLANNING', 'PATHWAY', 'COMPARABLE', 'SALE', 'ASSUMPTIONS', 'OTHER');

CREATE TABLE "WatchItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "WatchItemKind" NOT NULL,
    "label" TEXT NOT NULL,
    "suburb" TEXT,
    "bbox" JSONB,
    "precinctId" TEXT,
    "externalParcelId" TEXT,
    "opportunityId" TEXT,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "notes" TEXT,
    "scanCadence" "ScanCadence" NOT NULL DEFAULT 'MANUAL',
    "lastScanAt" TIMESTAMP(3),
    "nextScanAt" TIMESTAMP(3),
    "scanStatus" "ScanJobStatus" NOT NULL DEFAULT 'IDLE',
    "lastScanSummary" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WatchItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OpportunityChangeEvent" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "kind" "ChangeEventKind" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpportunityChangeEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FeedItem" (
    "id" TEXT NOT NULL,
    "kind" "FeedKind" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "opportunityId" TEXT,
    "watchItemId" TEXT,
    "href" TEXT,
    "score" INTEGER,
    "headroom" DOUBLE PRECISION,
    "maxPayable" DOUBLE PRECISION,
    "scoreDelta" INTEGER,
    "headroomDelta" DOUBLE PRECISION,
    "importance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "FeedItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AlertRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "criteria" JSONB NOT NULL DEFAULT '{}',
    "watchItemId" TEXT,
    "channels" "AlertChannel"[] DEFAULT ARRAY['IN_APP']::"AlertChannel"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AlertEvent" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "opportunityId" TEXT,
    "href" TEXT,
    "payload" JSONB,
    "deliveredInApp" BOOLEAN NOT NULL DEFAULT true,
    "deliveredEmail" BOOLEAN NOT NULL DEFAULT false,
    "deliveredPush" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MorningReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reportDate" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "summaryLine" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MorningReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AreaScanJob" (
    "id" TEXT NOT NULL,
    "watchItemId" TEXT NOT NULL,
    "status" "ScanJobStatus" NOT NULL DEFAULT 'QUEUED',
    "cadence" "ScanCadence" NOT NULL DEFAULT 'MANUAL',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "resultsAdded" INTEGER NOT NULL DEFAULT 0,
    "resultsChanged" INTEGER NOT NULL DEFAULT 0,
    "resultsRemoved" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AreaScanJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MonitoredSale" (
    "id" TEXT NOT NULL,
    "saleKey" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "suburb" TEXT,
    "salePrice" DOUBLE PRECISION NOT NULL,
    "saleDate" TIMESTAMP(3),
    "dealing" TEXT,
    "propid" INTEGER,
    "lng" DOUBLE PRECISION,
    "lat" DOUBLE PRECISION,
    "landAreaSqm" DOUBLE PRECISION,
    "raw" JSONB,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitoredSale_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlanningMonitorEvent" (
    "id" TEXT NOT NULL,
    "changeKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "status" TEXT,
    "suburb" TEXT,
    "watchItemId" TEXT,
    "opportunityId" TEXT,
    "current" JSONB,
    "proposed" JSONB,
    "impact" TEXT,
    "sourceUrl" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanningMonitorEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WatchItem_userId_active_idx" ON "WatchItem"("userId", "active");
CREATE INDEX "WatchItem_kind_idx" ON "WatchItem"("kind");
CREATE INDEX "WatchItem_nextScanAt_idx" ON "WatchItem"("nextScanAt");
CREATE INDEX "OpportunityChangeEvent_opportunityId_createdAt_idx" ON "OpportunityChangeEvent"("opportunityId", "createdAt");
CREATE INDEX "OpportunityChangeEvent_kind_createdAt_idx" ON "OpportunityChangeEvent"("kind", "createdAt");
CREATE INDEX "FeedItem_createdAt_idx" ON "FeedItem"("createdAt");
CREATE INDEX "FeedItem_kind_createdAt_idx" ON "FeedItem"("kind", "createdAt");
CREATE INDEX "FeedItem_importance_idx" ON "FeedItem"("importance");
CREATE INDEX "FeedItem_opportunityId_idx" ON "FeedItem"("opportunityId");
CREATE INDEX "AlertRule_userId_active_idx" ON "AlertRule"("userId", "active");
CREATE INDEX "AlertEvent_ruleId_createdAt_idx" ON "AlertEvent"("ruleId", "createdAt");
CREATE INDEX "AlertEvent_createdAt_idx" ON "AlertEvent"("createdAt");
CREATE UNIQUE INDEX "MorningReport_userId_reportDate_key" ON "MorningReport"("userId", "reportDate");
CREATE INDEX "MorningReport_reportDate_idx" ON "MorningReport"("reportDate");
CREATE INDEX "AreaScanJob_watchItemId_createdAt_idx" ON "AreaScanJob"("watchItemId", "createdAt");
CREATE INDEX "AreaScanJob_status_idx" ON "AreaScanJob"("status");
CREATE UNIQUE INDEX "MonitoredSale_saleKey_key" ON "MonitoredSale"("saleKey");
CREATE INDEX "MonitoredSale_suburb_idx" ON "MonitoredSale"("suburb");
CREATE INDEX "MonitoredSale_saleDate_idx" ON "MonitoredSale"("saleDate");
CREATE INDEX "PlanningMonitorEvent_changeKey_createdAt_idx" ON "PlanningMonitorEvent"("changeKey", "createdAt");
CREATE INDEX "PlanningMonitorEvent_createdAt_idx" ON "PlanningMonitorEvent"("createdAt");

ALTER TABLE "WatchItem" ADD CONSTRAINT "WatchItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WatchItem" ADD CONSTRAINT "WatchItem_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OpportunityChangeEvent" ADD CONSTRAINT "OpportunityChangeEvent_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeedItem" ADD CONSTRAINT "FeedItem_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AlertRule" ADD CONSTRAINT "AlertRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AlertRule" ADD CONSTRAINT "AlertRule_watchItemId_fkey" FOREIGN KEY ("watchItemId") REFERENCES "WatchItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AlertRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MorningReport" ADD CONSTRAINT "MorningReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AreaScanJob" ADD CONSTRAINT "AreaScanJob_watchItemId_fkey" FOREIGN KEY ("watchItemId") REFERENCES "WatchItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
