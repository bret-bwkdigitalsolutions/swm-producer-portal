-- Add seasonScheme + currentSeason columns to ShowMetadata.
ALTER TABLE "show_metadata" ADD COLUMN "seasonScheme" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "show_metadata" ADD COLUMN "currentSeason" INTEGER;

-- Backfill: shows that use seasons today.
-- The Clubhouse Podcast (wpShowIds 27 and 15) -> season scheme, currently S16.
-- Signal 51 Chronicles (wpShowIds 24 and 12) -> case scheme, currently Case 6.
-- (Several wpShowIds map to the same Transistor show due to legacy duplicate
--  ShowPlatformLink rows; setting both for safety.)
INSERT INTO "show_metadata" ("id", "wpShowId", "hosts", "seasonScheme", "currentSeason")
VALUES
  ('cm_seed_sm_27', 27, '', 'season', 16),
  ('cm_seed_sm_15', 15, '', 'season', 16),
  ('cm_seed_sm_24', 24, '', 'case',   6),
  ('cm_seed_sm_12', 12, '', 'case',   6)
ON CONFLICT ("wpShowId") DO UPDATE
  SET "seasonScheme" = EXCLUDED."seasonScheme",
      "currentSeason" = EXCLUDED."currentSeason";
