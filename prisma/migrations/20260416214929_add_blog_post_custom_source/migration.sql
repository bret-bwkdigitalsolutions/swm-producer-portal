-- Drop existing FK constraints so we can relax NOT NULL on the columns
ALTER TABLE "blog_posts" DROP CONSTRAINT "blog_posts_suggestionId_fkey";
ALTER TABLE "blog_posts" DROP CONSTRAINT "blog_posts_jobId_fkey";

-- Relax NOT NULL on the FK columns and add new source + customPrompt columns
ALTER TABLE "blog_posts"
  ALTER COLUMN "suggestionId" DROP NOT NULL,
  ALTER COLUMN "jobId" DROP NOT NULL,
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'suggestion',
  ADD COLUMN "customPrompt" TEXT;

-- Recreate FK constraints (now tolerate NULLs)
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_suggestionId_fkey"
  FOREIGN KEY ("suggestionId") REFERENCES "ai_suggestions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "distribution_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
