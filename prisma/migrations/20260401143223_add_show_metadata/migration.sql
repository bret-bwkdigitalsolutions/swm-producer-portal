-- CreateTable
CREATE TABLE "show_metadata" (
    "id" TEXT NOT NULL,
    "wpShowId" INTEGER NOT NULL,
    "hosts" TEXT NOT NULL,

    CONSTRAINT "show_metadata_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "show_metadata_wpShowId_key" ON "show_metadata"("wpShowId");
