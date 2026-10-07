import { db } from "@/lib/db";
import { mergeJobMetadata } from "./job-metadata";
import type { VideoWorkerMode } from "./processing-runtime";

/**
 * Cloud Run entry. The Next standalone server loads instrumentation, which
 * calls this when VIDEO_WORKER=1 and then exits. Status is written to the
 * same Postgres rows the portal already polls.
 *
 * A heartbeat lets the Railway process tell a live execution from one that
 * died without running the failure path (OOM, platform kill). SIGTERM is
 * the path Cloud Run uses when the task timeout fires or the execution is
 * cancelled.
 */

let finished = false;
let activeJobId: string | null = null;
let activeMode: VideoWorkerMode | null = null;

async function markInterrupted(reason: string): Promise<void> {
  if (finished || !activeJobId) return;
  const jobId = activeJobId;
  const message = reason.slice(0, 4000);
  console.error(`[video-worker] ${jobId} interrupted: ${message}`);
  await db.distributionJob
    .update({
      where: { id: jobId },
      data: { status: "failed", errorMessage: message },
    })
    .catch((error) => {
      console.error("[video-worker] Could not mark job failed:", error);
    });
  if (activeMode === "analyze") {
    await mergeJobMetadata(jobId, {
      analyze: {
        state: "failed",
        error: message,
      },
    }).catch((error) => {
      console.error("[video-worker] Could not mark analysis failed:", error);
    });
  }
}

function onSigterm(): void {
  void markInterrupted(
    "Cloud Run task received SIGTERM before it finished. Retry the job from the portal."
  ).finally(() => {
    process.exit(1);
  });
}

export async function runVideoWorker(): Promise<void> {
  const jobId = process.env.VIDEO_WORKER_JOB_ID?.trim();
  const mode = process.env.VIDEO_WORKER_MODE?.trim();
  if (!jobId || (mode !== "process" && mode !== "analyze")) {
    throw new Error(
      "VIDEO_WORKER_JOB_ID and VIDEO_WORKER_MODE=process|analyze are required."
    );
  }
  activeJobId = jobId;
  activeMode = mode;
  process.once("SIGTERM", onSigterm);

  const beat = setInterval(() => {
    mergeJobMetadata(jobId, { workerHeartbeat: new Date().toISOString() }).catch(
      (error) => {
        console.error("[video-worker] heartbeat failed:", error);
      }
    );
  }, 60_000);
  // Don't keep the process alive just for the heartbeat after the work ends.
  beat.unref?.();

  try {
    console.log(`[video-worker] Starting ${mode} for job ${jobId}`);
    if (mode === "process") {
      const { processJob } = await import("./processor");
      await processJob(jobId);
    } else {
      const { executeAnalysis } = await import(
        "@/app/api/distribute/analyze/route"
      );
      await executeAnalysis(jobId);
    }
    finished = true;
    console.log(`[video-worker] Finished ${mode} for job ${jobId}`);
  } finally {
    clearInterval(beat);
    process.off("SIGTERM", onSigterm);
  }
}

export async function runVideoWorkerAndExit(): Promise<void> {
  try {
    await runVideoWorker();
    process.exit(0);
  } catch (error) {
    console.error("[video-worker] failed:", error);
    if (activeJobId && !finished) {
      const message = error instanceof Error ? error.message : "Video worker failed";
      await markInterrupted(message);
    }
    process.exit(1);
  }
}
