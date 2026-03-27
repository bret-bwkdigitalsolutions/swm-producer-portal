-- CreateTable
CREATE TABLE "show_platform_links" (
    "id" TEXT NOT NULL,
    "wpShowId" INTEGER NOT NULL,
    "platform" TEXT NOT NULL,
    "url" TEXT NOT NULL,

    CONSTRAINT "show_platform_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "show_platform_links_wpShowId_platform_key" ON "show_platform_links"("wpShowId", "platform");
