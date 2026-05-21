-- Optional Vimeo source URL for a live recording. When set, the handoff
-- downloads audio from Vimeo instead of scraping the YouTube VOD — more
-- reliable, and avoids YouTube's cookie/bot-detection breakage. YouTube
-- still drives live-state monitoring.
ALTER TABLE "live_recordings" ADD COLUMN "vimeoSourceUrl" TEXT;
