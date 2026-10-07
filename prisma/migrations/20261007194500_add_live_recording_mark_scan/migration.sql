-- Mark-that scan state on an archived live recording. The portal downloads
-- the YouTube VOD, transcribes it, and posts cue marks to the website.
-- Existing rows stay null (not scanned) so a deploy does not backfill
-- every historical broadcast.

ALTER TABLE "live_recordings" ADD COLUMN "transcriptStatus" TEXT;
ALTER TABLE "live_recordings" ADD COLUMN "transcriptVtt" TEXT;
ALTER TABLE "live_recordings" ADD COLUMN "transcriptUtterances" JSONB;
ALTER TABLE "live_recordings" ADD COLUMN "transcriptMarks" JSONB;
ALTER TABLE "live_recordings" ADD COLUMN "transcriptMarksResponse" JSONB;
ALTER TABLE "live_recordings" ADD COLUMN "transcriptError" TEXT;
ALTER TABLE "live_recordings" ADD COLUMN "transcriptAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "live_recordings" ADD COLUMN "transcriptNextAttemptAt" TIMESTAMP(3);
ALTER TABLE "live_recordings" ADD COLUMN "transcriptScannedAt" TIMESTAMP(3);
ALTER TABLE "live_recordings" ADD COLUMN "transcriptDurationSec" INTEGER;
ALTER TABLE "live_recordings" ADD COLUMN "transcriptAudioPath" TEXT;

CREATE INDEX "live_recordings_transcriptStatus_transcriptNextAttemptAt_idx"
  ON "live_recordings"("transcriptStatus", "transcriptNextAttemptAt");
