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
