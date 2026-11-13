-- Vimeo live "mark that" watcher. One row per event, plus one row per
-- posted cue so a restart does not send the same cue twice.

CREATE TABLE "vimeo_live_watches" (
    "eventId" TEXT NOT NULL,
    "showId" INTEGER NOT NULL,
    "activeVideoId" TEXT,
    "archiveVideoId" TEXT,
    "streamStartedAt" TIMESTAMP(3),
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "archiveScannedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vimeo_live_watches_pkey" PRIMARY KEY ("eventId")
);

CREATE TABLE "vimeo_live_mark_posts" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "dedupeBucket" INTEGER NOT NULL,
    "offsetSeconds" INTEGER NOT NULL,
    "cueText" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vimeo_live_mark_posts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vimeo_live_mark_posts_eventId_videoId_dedupeBucket_key" ON "vimeo_live_mark_posts"("eventId", "videoId", "dedupeBucket");

CREATE INDEX "vimeo_live_mark_posts_eventId_status_idx" ON "vimeo_live_mark_posts"("eventId", "status");
