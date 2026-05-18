-- Live recordings: lifecycle table for episodes broadcast via Vimeo Live →
-- YouTube simulcast. The portal polls YouTube for state transitions, hands
-- off to Transistor once the archive is downloadable, and the existing
-- Transistor pipeline updates the linked swm_episode WP post in place.

CREATE TABLE "live_recordings" (
  "id"                  TEXT NOT NULL,
  "wpShowId"            INTEGER NOT NULL,
  "wpPostId"            INTEGER,
  "youtubeVideoId"      TEXT NOT NULL,
  "youtubeLiveUrl"      TEXT NOT NULL,
  "title"               TEXT NOT NULL,
  "description"         TEXT,
  "scheduledStartAt"    TIMESTAMP(3) NOT NULL,
  "state"               TEXT NOT NULL DEFAULT 'scheduled',
  "transistorEpisodeId" TEXT,
  "actualStartedAt"     TIMESTAMP(3),
  "actualEndedAt"       TIMESTAMP(3),
  "archivedAt"          TIMESTAMP(3),
  "lastPolledAt"        TIMESTAMP(3),
  "pollAttempts"        INTEGER NOT NULL DEFAULT 0,
  "downloadAttempts"    INTEGER NOT NULL DEFAULT 0,
  "errorMessage"        TEXT,
  "createdByUserId"     TEXT NOT NULL,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL,

  CONSTRAINT "live_recordings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "live_recordings_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "live_recordings_youtubeVideoId_key"
  ON "live_recordings"("youtubeVideoId");

CREATE UNIQUE INDEX "live_recordings_transistorEpisodeId_key"
  ON "live_recordings"("transistorEpisodeId");

CREATE INDEX "live_recordings_state_scheduledStartAt_idx"
  ON "live_recordings"("state", "scheduledStartAt");

CREATE INDEX "live_recordings_wpShowId_idx"
  ON "live_recordings"("wpShowId");
