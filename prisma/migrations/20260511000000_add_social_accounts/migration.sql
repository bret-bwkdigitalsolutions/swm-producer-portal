-- Social analytics: follower-count tracking for show and host social accounts
-- across Facebook Pages, Instagram, TikTok, and X. Separate from
-- platform_credentials because shows can have multiple handles per platform,
-- host accounts have no wpShowId, and X uses an app-level bearer token.

CREATE TABLE "social_accounts" (
  "id"          TEXT NOT NULL,
  "platform"    TEXT NOT NULL,
  "kind"        TEXT NOT NULL,
  "wpShowId"    INTEGER,
  "hostName"    TEXT,
  "handle"      TEXT NOT NULL,
  "displayName" TEXT,
  "externalId"  TEXT,
  "status"      TEXT NOT NULL DEFAULT 'active',
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "social_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "social_accounts_platform_externalId_key"
  ON "social_accounts"("platform", "externalId");

CREATE INDEX "social_accounts_wpShowId_idx" ON "social_accounts"("wpShowId");
CREATE INDEX "social_accounts_kind_idx"     ON "social_accounts"("kind");

CREATE TABLE "social_account_credentials" (
  "socialAccountId"   TEXT NOT NULL,
  "accessToken"       TEXT NOT NULL,
  "refreshToken"      TEXT,
  "tokenExpiresAt"    TIMESTAMP(3),
  "connectedByUserId" TEXT,
  "connectedEmail"    TEXT,
  "scopes"            TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,

  CONSTRAINT "social_account_credentials_pkey" PRIMARY KEY ("socialAccountId"),
  CONSTRAINT "social_account_credentials_socialAccountId_fkey"
    FOREIGN KEY ("socialAccountId") REFERENCES "social_accounts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "social_follower_snapshots" (
  "id"              TEXT NOT NULL,
  "socialAccountId" TEXT NOT NULL,
  "followerCount"   INTEGER NOT NULL,
  "capturedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "social_follower_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "social_follower_snapshots_socialAccountId_fkey"
    FOREIGN KEY ("socialAccountId") REFERENCES "social_accounts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "social_follower_snapshots_socialAccountId_capturedAt_idx"
  ON "social_follower_snapshots"("socialAccountId", "capturedAt");
