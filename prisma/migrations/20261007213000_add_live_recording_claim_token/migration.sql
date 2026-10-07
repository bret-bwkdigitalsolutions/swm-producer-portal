-- Lease owner for a live mark scan, plus the clocks for the 14-day
-- website-not-ready stop and the daily Deepgram cap.

ALTER TABLE "live_recordings" ADD COLUMN "transcriptClaimToken" TEXT;
ALTER TABLE "live_recordings" ADD COLUMN "transcriptNotReadySince" TIMESTAMP(3);
ALTER TABLE "live_recordings" ADD COLUMN "transcriptLastClaimedAt" TIMESTAMP(3);
