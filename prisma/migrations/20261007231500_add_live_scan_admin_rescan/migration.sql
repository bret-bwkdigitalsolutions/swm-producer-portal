-- An admin Re-scan sets this so a later cron retry still POSTs an empty
-- mark list. Cleared after that post succeeds.

ALTER TABLE "live_recordings" ADD COLUMN "liveScanAdminRescan" BOOLEAN NOT NULL DEFAULT false;
