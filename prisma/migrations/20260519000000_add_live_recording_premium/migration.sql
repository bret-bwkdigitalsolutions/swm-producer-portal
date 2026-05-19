-- Mirrors swm_episode is_premium_only meta on the WP post so the portal
-- has a local record of the flag and can re-send it on later updates.
ALTER TABLE "live_recordings" ADD COLUMN "isPremiumOnly" BOOLEAN NOT NULL DEFAULT false;
