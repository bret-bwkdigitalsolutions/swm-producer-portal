import "server-only";

/**
 * Global concurrency cap for the memory-heavy background pipelines
 * (distribution processing + AI analysis). These run fire-and-forget from their
 * API routes, so without a cap several overlapping episodes would download,
 * ffmpeg-extract, transcribe, and upload at once — stacking hundreds of MB each
 * and risking a Railway OOM. The queue bounds how many run simultaneously while
 * preserving the fire-and-forget UX (routes still return immediately).
 *
 * Tune with MAX_CONCURRENT_JOBS in Railway (default 2). Set to 1 to fully
 * serialize if memory is tight; raise it once the container has more headroom.
 *
 * This is per-process. The app runs as a single Node server on Railway, so one
 * in-memory limiter is sufficient; if the service is ever scaled to multiple
 * replicas, each replica enforces the cap independently.
 */
function maxConcurrent(): number {
  const n = parseInt(process.env.MAX_CONCURRENT_JOBS ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 2;
}

let active = 0;
const waiting: Array<() => void> = [];

function pump(): void {
  while (active < maxConcurrent() && waiting.length > 0) {
    const start = waiting.shift()!;
    active++;
    start();
  }
}

/**
 * Run `task` under the global concurrency cap. Returns immediately; the task is
 * queued and starts when a slot frees. Errors are logged (never thrown to the
 * caller) so one failed job can't wedge the queue.
 */
export function enqueueJob(label: string, task: () => Promise<unknown>): void {
  waiting.push(() => {
    Promise.resolve()
      .then(task)
      .catch((err) => {
        console.error(`[job-queue] "${label}" failed:`, err);
      })
      .finally(() => {
        active--;
        pump();
      });
  });
  console.log(
    `[job-queue] queued "${label}" (active=${active}, waiting=${waiting.length}, max=${maxConcurrent()})`
  );
  pump();
}
