-- CreateTable
CREATE TABLE "transistor_scraped_overviews" (
    "id" TEXT NOT NULL,
    "wpShowId" INTEGER NOT NULL,
    "scrapedAt" TIMESTAMP(3) NOT NULL,
    "estimatedSubscribers" INTEGER,
    "avgDownloads7d" DOUBLE PRECISION,
    "avgDownloads30d" DOUBLE PRECISION,
    "avgDownloads60d" DOUBLE PRECISION,
    "avgDownloads90d" DOUBLE PRECISION,
    "monthlyDownloads" JSONB,
    "yearlyDownloads" JSONB,

    CONSTRAINT "transistor_scraped_overviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transistor_scraped_geo" (
    "id" TEXT NOT NULL,
    "wpShowId" INTEGER NOT NULL,
    "scrapedAt" TIMESTAMP(3) NOT NULL,
    "country" TEXT NOT NULL,
    "region" TEXT,
    "downloads" INTEGER NOT NULL,
    "percentage" DOUBLE PRECISION,

    CONSTRAINT "transistor_scraped_geo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transistor_scraped_apps" (
    "id" TEXT NOT NULL,
    "wpShowId" INTEGER NOT NULL,
    "scrapedAt" TIMESTAMP(3) NOT NULL,
    "appName" TEXT NOT NULL,
    "downloads" INTEGER NOT NULL,
    "percentage" DOUBLE PRECISION,

    CONSTRAINT "transistor_scraped_apps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transistor_scraped_devices" (
    "id" TEXT NOT NULL,
    "wpShowId" INTEGER NOT NULL,
    "scrapedAt" TIMESTAMP(3) NOT NULL,
    "deviceType" TEXT NOT NULL,
    "deviceName" TEXT,
    "downloads" INTEGER NOT NULL,
    "percentage" DOUBLE PRECISION,

    CONSTRAINT "transistor_scraped_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transistor_scrape_logs" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "showCount" INTEGER,
    "errors" JSONB,

    CONSTRAINT "transistor_scrape_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transistor_scraped_overviews_wpShowId_scrapedAt_key" ON "transistor_scraped_overviews"("wpShowId", "scrapedAt");

-- CreateIndex
CREATE INDEX "transistor_scraped_geo_wpShowId_scrapedAt_idx" ON "transistor_scraped_geo"("wpShowId", "scrapedAt");

-- CreateIndex
CREATE UNIQUE INDEX "transistor_scraped_geo_wpShowId_scrapedAt_country_region_key" ON "transistor_scraped_geo"("wpShowId", "scrapedAt", "country", "region");

-- CreateIndex
CREATE INDEX "transistor_scraped_apps_wpShowId_scrapedAt_idx" ON "transistor_scraped_apps"("wpShowId", "scrapedAt");

-- CreateIndex
CREATE UNIQUE INDEX "transistor_scraped_apps_wpShowId_scrapedAt_appName_key" ON "transistor_scraped_apps"("wpShowId", "scrapedAt", "appName");

-- CreateIndex
CREATE INDEX "transistor_scraped_devices_wpShowId_scrapedAt_idx" ON "transistor_scraped_devices"("wpShowId", "scrapedAt");

-- CreateIndex
CREATE UNIQUE INDEX "transistor_scraped_devices_wpShowId_scrapedAt_deviceType_de_key" ON "transistor_scraped_devices"("wpShowId", "scrapedAt", "deviceType", "deviceName");
