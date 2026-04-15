-- CreateTable
CREATE TABLE "blog_edit_records" (
    "id" TEXT NOT NULL,
    "blogPostId" TEXT NOT NULL,
    "wpShowId" INTEGER NOT NULL,
    "originalContent" TEXT NOT NULL,
    "editedContent" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blog_edit_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "blog_edit_records_blogPostId_key" ON "blog_edit_records"("blogPostId");

-- CreateIndex
CREATE INDEX "blog_edit_records_wpShowId_idx" ON "blog_edit_records"("wpShowId");

-- AddForeignKey
ALTER TABLE "blog_edit_records" ADD CONSTRAINT "blog_edit_records_blogPostId_fkey" FOREIGN KEY ("blogPostId") REFERENCES "blog_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
