-- AlterTable
ALTER TABLE "blog_posts" ADD COLUMN     "editCheckAt" TIMESTAMP(3),
ADD COLUMN     "editCheckLabel" TEXT,
ADD COLUMN     "editCheckPercentage" INTEGER,
ADD COLUMN     "sentToHostAt" TIMESTAMP(3);
