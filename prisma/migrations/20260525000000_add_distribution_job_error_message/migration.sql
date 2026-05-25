-- Persist the last failure message on a distribution job so post-mortems
-- don't depend on Railway log retention (~17h).
ALTER TABLE "distribution_jobs" ADD COLUMN "errorMessage" TEXT;
