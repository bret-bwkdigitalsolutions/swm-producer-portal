-- Dedupe a cue on the event and the time bucket, not the video id, and
-- remember when a live watch already ran its full window for a video.

ALTER TABLE "vimeo_live_watches" ADD COLUMN "liveExhaustedVideoId" TEXT;

-- Keep one row per event and bucket. Prefer a posted row, then the older row.
DELETE FROM "vimeo_live_mark_posts" AS extra
USING "vimeo_live_mark_posts" AS keep
WHERE extra."eventId" = keep."eventId"
  AND extra."dedupeBucket" = keep."dedupeBucket"
  AND extra."id" <> keep."id"
  AND (
    (extra.status <> 'posted' AND keep.status = 'posted')
    OR (
      extra.status = keep.status
      AND (
        extra."createdAt" > keep."createdAt"
        OR (extra."createdAt" = keep."createdAt" AND extra."id" > keep."id")
      )
    )
  );

DROP INDEX IF EXISTS "vimeo_live_mark_posts_eventId_videoId_dedupeBucket_key";

CREATE UNIQUE INDEX "vimeo_live_mark_posts_eventId_dedupeBucket_key"
  ON "vimeo_live_mark_posts"("eventId", "dedupeBucket");
