/**
 * Fetch helpers for post-distribution checks: bounded timeouts, retry with
 * exponential backoff on transient failures, and a HEAD→GET fallback for
 * hosts that reject HEAD.
 */

/** Mutable so tests can shrink delays. */
export const platformFetchConfig = {
  /** Backoff before each retry (length = number of retries). */
  retryDelaysMs: [2_000, 5_000, 15_000] as number[],
  timeoutMs: 30_000,
};

const sleep = (ms: number) =>
  ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();

export function isTransientStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export class PlatformFetchError extends Error {
  constructor(message: string, public transient: boolean) {
    super(message);
    this.name = "PlatformFetchError";
  }
}

/**
 * fetch() with retries. Retries network errors/timeouts and transient HTTP
 * statuses (408/425/429/5xx). Returns the final Response (which may still be
 * non-ok, e.g. a 404 — permanent errors are not retried). Throws a
 * PlatformFetchError if every attempt failed at the network level.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  label = "fetch"
): Promise<Response> {
  const delays = platformFetchConfig.retryDelaysMs;
  let lastError: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(platformFetchConfig.timeoutMs),
      });
      if (!isTransientStatus(res.status) || attempt === delays.length) return res;
      console.warn(`[verify] ${label}: HTTP ${res.status} (attempt ${attempt + 1}) — retrying`);
    } catch (err) {
      lastError = err;
      console.warn(
        `[verify] ${label}: ${err instanceof Error ? err.message : String(err)} (attempt ${attempt + 1})${attempt < delays.length ? " — retrying" : ""}`
      );
    }
    if (attempt < delays.length) await sleep(delays[attempt]);
  }
  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new PlatformFetchError(`${label} failed after retries: ${msg}`, true);
}

/**
 * Check a public URL is serving. 2xx/3xx (after redirects) = reachable.
 * Hosts that reject HEAD (403/405/501) get one ranged GET instead.
 */
export async function checkUrlReachable(
  url: string
): Promise<{ ok: boolean; status: number | null; transient: boolean }> {
  try {
    let res = await fetchWithRetry(url, { method: "HEAD", redirect: "follow" }, `HEAD ${url}`);
    if (res.status === 403 || res.status === 405 || res.status === 501) {
      res = await fetchWithRetry(
        url,
        { method: "GET", redirect: "follow", headers: { Range: "bytes=0-0" } },
        `GET ${url}`
      );
      // Release the body — we only care about the status.
      await res.body?.cancel().catch(() => {});
    }
    return { ok: res.ok, status: res.status, transient: isTransientStatus(res.status) };
  } catch {
    return { ok: false, status: null, transient: true };
  }
}
