/**
 * Where video-byte work runs.
 *
 * `railway` (default) keeps today's in-process path so a deploy of this code
 * changes nothing until Bret sets the flag. `cloudrun` asks the Cloud Run
 * job to run the same pipeline. The Railway path stays in the binary as the
 * fallback: set the variable back to `railway` and new jobs stay on the app.
 */

export type ProcessingRuntime = "railway" | "cloudrun";
export type VideoWorkerMode = "process" | "analyze";

/** Railway cap. A stuck ffmpeg must not hold the web process overnight. */
export const RAILWAY_JOB_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * The Cloud Run task is capped at 24h in the job spec (the platform allows
 * up to 168h). Stop one hour earlier so the worker can record a failure in
 * Postgres before the platform SIGKILLs the container.
 */
export const CLOUD_RUN_JOB_TIMEOUT_MS = 23 * 60 * 60 * 1000;

/** ffmpeg / yt-dlp ceiling on Railway. */
export const RAILWAY_MEDIA_TIMEOUT_MS = 30 * 60 * 1000;

/** A 90 GB decode can run for hours. Stay under the job timeout. */
export const CLOUD_RUN_MEDIA_TIMEOUT_MS = 20 * 60 * 60 * 1000;

/**
 * How long the portal waits without a worker heartbeat before it treats a
 * Cloud Run execution as dead. Long enough for an image pull, short enough
 * that a crashed task does not look "running" all day.
 */
export const CLOUD_RUN_HEARTBEAT_STALE_MS = 20 * 60 * 1000;

/** Railway analyze pipelines have no heartbeat. This matches the old constant. */
export const RAILWAY_ANALYZE_STALE_MS = 90 * 60 * 1000;

export function isVideoWorker(): boolean {
  return process.env.VIDEO_WORKER === "1";
}

export function getProcessingRuntime(): ProcessingRuntime {
  const raw = (process.env.VIDEO_PROCESSING_RUNTIME ?? "railway").trim().toLowerCase();
  if (raw === "cloudrun") return "cloudrun";
  if (raw && raw !== "railway") {
    console.warn(
      `[processing-runtime] Unknown VIDEO_PROCESSING_RUNTIME="${raw}"; using railway`
    );
  }
  return "railway";
}

export function jobTimeoutMs(): number {
  return isVideoWorker() ? CLOUD_RUN_JOB_TIMEOUT_MS : RAILWAY_JOB_TIMEOUT_MS;
}

export function mediaToolTimeoutMs(): number {
  return isVideoWorker() ? CLOUD_RUN_MEDIA_TIMEOUT_MS : RAILWAY_MEDIA_TIMEOUT_MS;
}

export function formatDuration(ms: number): string {
  if (ms >= 60 * 60 * 1000) {
    const hours = Math.round(ms / (60 * 60 * 1000));
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const minutes = Math.round(ms / 60000);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export function cloudRunJobResourceName(): string {
  const job = process.env.CLOUD_RUN_JOB?.trim();
  if (!job) {
    throw new Error(
      "CLOUD_RUN_JOB is not set. Expected projects/<project>/locations/<region>/jobs/<name>."
    );
  }
  if (!/^projects\/[^/]+\/locations\/[^/]+\/jobs\/[^/]+$/.test(job)) {
    throw new Error(
      "CLOUD_RUN_JOB must look like projects/<project>/locations/<region>/jobs/<name>."
    );
  }
  return job;
}

/**
 * Body for the Cloud Run Admin API `:run` call.
 * Only the job id and mode are passed. Tokens and database URLs stay in
 * Secret Manager on the job, not in the execution request.
 */
export function buildCloudRunRunRequest(jobId: string, mode: VideoWorkerMode): {
  url: string;
  body: {
    overrides: {
      containerOverrides: Array<{
        env: Array<{ name: string; value: string }>;
      }>;
    };
  };
} {
  const job = cloudRunJobResourceName();
  return {
    url: `https://run.googleapis.com/v2/${job}:run`,
    body: {
      overrides: {
        containerOverrides: [
          {
            env: [
              { name: "VIDEO_WORKER_JOB_ID", value: jobId },
              { name: "VIDEO_WORKER_MODE", value: mode },
            ],
          },
        ],
      },
    },
  };
}

export function isCloudRunWorkerFresh(
  metadata: Record<string, unknown>,
  now = Date.now()
): boolean {
  if (metadata.processingRuntime !== "cloudrun") return false;
  const raw = metadata.workerHeartbeat;
  if (typeof raw !== "string") return false;
  const beat = Date.parse(raw);
  if (!Number.isFinite(beat)) return false;
  return now - beat <= CLOUD_RUN_HEARTBEAT_STALE_MS;
}

/**
 * Railway sweeps and the analyze poller use this so a live Cloud Run task
 * is not marked failed just because the web container restarted, and a dead
 * task does not look running forever.
 */
export function isAnalyzeStale(
  metadata: Record<string, unknown>,
  analyze: { startedAt?: string } | undefined,
  now = Date.now()
): boolean {
  if (metadata.processingRuntime === "cloudrun") {
    return !isCloudRunWorkerFresh(metadata, now);
  }
  const startedAt = analyze?.startedAt ? Date.parse(analyze.startedAt) : NaN;
  return !Number.isFinite(startedAt) || now - startedAt > RAILWAY_ANALYZE_STALE_MS;
}
