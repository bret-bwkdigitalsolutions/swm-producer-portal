-- CreateTable
CREATE TABLE "show_blog_folders" (
    "id" TEXT NOT NULL,
    "wpShowId" INTEGER NOT NULL,
    "googleFolderId" TEXT NOT NULL,

    CONSTRAINT "show_blog_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_posts" (
    "id" TEXT NOT NULL,
    "suggestionId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "wpShowId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "googleDocId" TEXT NOT NULL,
    "googleDocUrl" TEXT NOT NULL,
    "author" TEXT,
    "hostEmail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "wpPostId" INTEGER,
    "wpPostUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blog_posts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "show_blog_folders_wpShowId_key" ON "show_blog_folders"("wpShowId");

-- CreateIndex
CREATE UNIQUE INDEX "blog_posts_suggestionId_key" ON "blog_posts"("suggestionId");

-- AddForeignKey
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "ai_suggestions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "distribution_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
