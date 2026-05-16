-- Per-post primary language override (e.g. "es" for a Spanish-primary import
-- on a show that's otherwise English-primary). Null = use ShowMetadata.language.
ALTER TABLE "blog_posts" ADD COLUMN "primaryLanguage" TEXT;
