import { db } from "@/lib/db";

/**
 * Next.js instrumentation — runs once on server startup before handling requests.
 *
 * Recovers distribution jobs that were left in "processing" when the server
 * shut down (deploy, crash, OOM). Marks them as "failed" so producers see the
 * error and can retry via the UI.
 */
export async function register() {
  // Only run on the Node.js server, not during build or edge runtime
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  await sweepStuckProcessingJobs();
  await sweepStuckAnalyses();

  // Re-schedule post-distribution verification tiers that were pending when
  // the previous container died (their setTimeout timers don't survive).
  try {
    const { resumeVerificationSchedules } = await import("@/lib/jobs/processor");
    await resumeVerificationSchedules();
  } catch (error) {
    console.error("[instrumentation] Verification resume failed:", error);
  }
}

/**
 * Jobs left in "processing" when the server shut down. The fire-and-forget
 * processJob pipeline died with the process — mark them failed so producers
 * can retry.
 */
async function sweepStuckProcessingJobs() {
  try {
    const stuck = await db.distributionJob.findMany({
      where: { status: "processing" },
      include: { platforms: true },
    });

    if (stuck.length === 0) return;

    console.log(
      `[instrumentation] Found ${stuck.length} stuck job(s) in "processing" — marking as failed`
    );

    for (const job of stuck) {
      // Fail any platform sub-tasks that were still in progress
      for (const platform of job.platforms) {
        if (platform.status === "uploading" || platform.status === "processing") {
          await db.distributionJobPlatform.update({
            where: { id: platform.id },
            data: {
              status: "failed",
              error: "Processing interrupted by server restart — please retry.",
            },
          });
        }
      }

      await db.distributionJob.update({
        where: { id: job.id },
        data: { status: "failed" },
      });

      console.log(`[instrumentation] Job ${job.id} ("${job.title}") marked as failed`);
    }
  } catch (error) {
    // Don't block startup if the sweep fails
    console.error("[instrumentation] Stuck job sweep failed:", error);
  }
}

/**
 * Analyze pipelines left in "running" when the server shut down. These jobs
 * sit at status "pending" (not "processing"), so the sweep above misses them.
 * Mark the analyze state failed so the client stops polling and the producer
 * can re-run analysis.
 */
async function sweepStuckAnalyses() {
  try {
    const stuck = await db.distributionJob.findMany({
      where: {
        metadata: { path: ["analyze", "state"], equals: "running" },
      },
      select: { id: true, title: true, metadata: true },
    });

    if (stuck.length === 0) return;

    console.log(
      `[instrumentation] Found ${stuck.length} analyze pipeline(s) stuck in "running" — marking as failed`
    );

    for (const job of stuck) {
      const metadata = (job.metadata as Record<string, unknown>) ?? {};
      const analyze = (metadata.analyze as Record<string, unknown>) ?? {};
      await db.distributionJob.update({
        where: { id: job.id },
        data: {
          metadata: {
            ...metadata,
            analyze: {
              ...analyze,
              state: "failed",
              error: "Analysis was interrupted by a server restart — please try again.",
            },
          },
        },
      });
      console.log(`[instrumentation] Analyze for job ${job.id} ("${job.title}") marked as failed`);
    }
  } catch (error) {
    console.error("[instrumentation] Stuck analyze sweep failed:", error);
  }
}
