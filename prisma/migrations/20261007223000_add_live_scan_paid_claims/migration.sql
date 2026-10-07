-- One row per paid live-scan claim (download or Deepgram). The daily cap
-- counts these since UTC midnight, so each attempt counts.

CREATE TABLE "live_scan_paid_claims" (
    "id" TEXT NOT NULL,
    "liveRecordingId" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_scan_paid_claims_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "live_scan_paid_claims_claimedAt_idx" ON "live_scan_paid_claims"("claimedAt");
