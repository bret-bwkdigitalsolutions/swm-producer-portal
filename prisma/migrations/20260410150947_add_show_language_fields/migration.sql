-- AlterTable
ALTER TABLE "show_metadata" ADD COLUMN     "language" TEXT NOT NULL DEFAULT 'en',
ADD COLUMN     "bilingual" BOOLEAN NOT NULL DEFAULT false;
