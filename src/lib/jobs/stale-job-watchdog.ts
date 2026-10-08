import { db } from "@/lib/db";
import { CLOUD_RUN_HEARTBEAT_STALE_MS } from "./processing-runtime";

/**
 * How often the web process looks for distribution jobs whose worker stopped
 * writing. The startup sweep in instrumentation only runs once per boot, which
 * left an OOM-killed Cloud Run task in "processing" until the next deploy.
 */
export const STALE_JOB_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/** Platform rows a retry can pick up. Completed rows stay completed. */
const UNFINISHED_PLATFORM_STATUSES = ["queued", "uploading", "processing"] as const;

const globalForWatchdog = globalThis as {
  __swmStaleJobWatchdog?: boolean;
};

export interface StaleJobSweepResult {
  checked: number;
  failedIds: string[];
}

export function staleWorkerMessage(): string {
  const minutes = Math.round(CLOUD_RUN_HEARTBEAT_STALE_MS / 60_000);
  return `Worker stopped responding (no heartbeat for ${minutes}+ min) - likely out of memory or crashed. Click Retry.`;
}

function heartbeatMs(metadata: unknown): number | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = (metadata as Record<string, unknown>).workerHeartbeat;
  if (typeof raw !== "string") return null;
  const beat = Date.parse(raw);
  return Number.isFinite(beat) ? beat : null;
}

/**
 * Latest sign of life for a Cloud Run job: a worker heartbeat, or updatedAt
 * when that heartbeat is missing. The periodic sweep never considers a job
 * whose metadata.processingRuntime is not "cloudrun". A live heartbeat keeps
 * the job even if updatedAt is older.
 */
export function lastWorkerSignalMs(job: {
  updatedAt: Date;
  metadata: unknown;
}): number | null {
  const updated = job.updatedAt instanceof Date ? job.updatedAt.getTime() : NaN;
  const beat = heartbeatMs(job.metadata);
  const signals = [updated, beat].filter((value): value is number =>
    Number.isFinite(value)
  );
  if (signals.length === 0) return null;
  return Math.max(...signals);
}

export function isWorkerSignalStale(
  job: { updatedAt: Date; metadata: unknown },
  now = Date.now()
): boolean {
  const signal = lastWorkerSignalMs(job);
  if (signal == null) return true;
  // Equal to the threshold is still fresh, matching isCloudRunWorkerFresh.
  return now - signal > CLOUD_RUN_HEARTBEAT_STALE_MS;
}

function isCloudRunProcessingJob(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") return false;
  return (metadata as Record<string, unknown>).processingRuntime === "cloudrun";
}

/**
 * Fail Cloud Run jobs that are still processing when their worker heartbeat
 * and updatedAt are both older than the shared 20-minute threshold.
 *
 * Railway sets a job to processing and then parks it on the in-process queue.
 * The heartbeat starts only inside processJob, so a queue wait longer than
 * 20 minutes has no heartbeat. Failing that row lets the queued task run
 * anyway, and a Retry can start a second pipeline. The startup sweep and the
 * Railway job timeout already cover those jobs, so this sweep only considers
 * metadata.processingRuntime === "cloudrun".
 *
 * The status update is conditional on the updatedAt we just read. A heartbeat
 * that lands after the read bumps updatedAt, the update matches nothing, and
 * the live job is left alone.
 *
 * Unfinished platform rows (queued, uploading, processing) are failed with
 * the same message. Retry stays available: the existing action only retries
 * a platform whose status is "failed", and processJob skips completed ones.
 */
export async function failStaleProcessingJobs(
  now = Date.now()
): Promise<StaleJobSweepResult> {
  const processing = await db.distributionJob.findMany({
    where: { status: "processing" },
    select: {
      id: true,
      title: true,
      status: true,
      updatedAt: true,
      metadata: true,
    },
  });

  const message = staleWorkerMessage();
  const failedIds: string[] = [];

  for (const job of processing) {
    if (job.status !== "processing") continue;
    if (!isCloudRunProcessingJob(job.metadata)) continue;
    if (!isWorkerSignalStale(job, now)) continue;

    try {
      const claimed = await db.distributionJob.updateMany({
        where: {
          id: job.id,
          status: "processing",
          updatedAt: job.updatedAt,
        },
        data: {
          status: "failed",
          errorMessage: message,
        },
      });
      if (claimed.count === 0) continue;

      await db.distributionJobPlatform.updateMany({
        where: {
          jobId: job.id,
          status: { in: [...UNFINISHED_PLATFORM_STATUSES] },
        },
        data: {
          status: "failed",
          error: message,
        },
      });

      failedIds.push(job.id);
      console.log(
        `[stale-job-watchdog] Job ${job.id} ("${job.title}") marked failed`
      );
    } catch (error) {
      console.error(`[stale-job-watchdog] Job ${job.id} sweep failed:`, error);
    }
  }

  return { checked: processing.length, failedIds };
}

/**
 * Run the sweep on a timer for the life of this process. Safe to call more
 * than once (Next.js dev reloads instrumentation). The timer is unref'd so
 * it does not keep a short-lived process, such as a one-shot script, alive.
 */
export function startStaleJobWatchdog(): void {
  if (globalForWatchdog.__swmStaleJobWatchdog) return;
  globalForWatchdog.__swmStaleJobWatchdog = true;

  const timer = setInterval(() => {
    failStaleProcessingJobs().catch((error) => {
      console.error("[stale-job-watchdog] sweep failed:", error);
    });
  }, STALE_JOB_SWEEP_INTERVAL_MS);
  timer.unref?.();
  console.log(
    `[stale-job-watchdog] Checking every ${Math.round(STALE_JOB_SWEEP_INTERVAL_MS / 60_000)} min`
  );
}
