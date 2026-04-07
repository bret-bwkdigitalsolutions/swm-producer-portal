-- Seed Google Drive blog folder IDs for all shows
INSERT INTO "show_blog_folders" ("id", "wpShowId", "googleFolderId") VALUES
  (gen_random_uuid()::text, 22, '1mNEcsbbOLQwFo5BQbFeF4axY22DAvpZP'),  -- ¡Al Maximo!
  (gen_random_uuid()::text, 23, '1S8b1rlEAxSbzEHxNq1W3i_YAhQOpYfMv'),  -- Beer 30 Sports O'Clock
  (gen_random_uuid()::text, 25, '1Mt_lgpfXupMoXoEiTtUcjNg58UwZZLfX'),  -- Engel Angle
  (gen_random_uuid()::text, 26, '1_xZlBpIJ01FFEBStYiyFx_k5oM-Bza3P'),  -- Just Wondering with Norm Hitzges
  (gen_random_uuid()::text, 27, '1BjZE1nNodB2cWy9VJh75mnkXj8G35_t1'),  -- Signal 51 Chronicles
  (gen_random_uuid()::text, 28, '1OfOkdzklTyyR7PkR0YnT9Odg_lq6uVaQ'),  -- Sunset Soccer Club
  (gen_random_uuid()::text, 24, '1tKzH0-j-HijsPW2YddeHXokGdMRFMAAc'),  -- The Clubhouse Podcast
  (gen_random_uuid()::text, 21, '11kjbYWurmjiiN_GwR7JHEdQipa-Q09Vq')   -- Your Dark Companion
ON CONFLICT ("wpShowId") DO UPDATE SET "googleFolderId" = EXCLUDED."googleFolderId";
