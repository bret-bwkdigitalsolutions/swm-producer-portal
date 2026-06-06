-- AlterTable
ALTER TABLE "distribution_jobs" ADD COLUMN     "isPremium" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "show_metadata" ADD COLUMN     "premiumEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "transistorPrivateShowId" TEXT;
