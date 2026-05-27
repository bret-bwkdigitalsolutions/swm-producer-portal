-- Per-identity YouTube cookies for yt-dlp. Multiple PlatformCredential rows
-- can join here via PlatformCredential.connectedEmail, so cookies live with
-- the real Google account that owns the channel, not on each show row.
CREATE TABLE "youtube_identities" (
    "email" TEXT NOT NULL,
    "channelTitle" TEXT,
    "channelId" TEXT,
    "cookies" TEXT,
    "cookiesUpdatedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "youtube_identities_pkey" PRIMARY KEY ("email")
);
