import { mergeJobMetadata } from "./job-metadata";

/**
 * Refresh `metadata.workerHeartbeat` so the stale-job watchdog can tell a
 * live worker from one that was SIGKILLed (OOM) before it could mark the
 * job failed. The Cloud Run entry and the in-process Railway path both use
 * this. Errors are logged and swallowed: a failed heartbeat must not abort
 * an upload that is still making progress.
 */
export function startWorkerHeartbeat(
  jobId: string,
  intervalMs = 60_000
): () => void {
  const beat = () => {
    mergeJobMetadata(jobId, {
      workerHeartbeat: new Date().toISOString(),
    }).catch((error) => {
      console.error("[worker-heartbeat] failed:", error);
    });
  };

  beat();
  const timer = setInterval(beat, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
