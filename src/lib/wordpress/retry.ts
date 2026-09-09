import "server-only";

export interface RetryOptions {
  /** Number of retries after the initial attempt (default 2 → up to 3 tries). */
  retries?: number;
  /** Delay between attempts in ms (default 300). Pass 0 in tests. */
  delayMs?: number;
  /** Called on every failed attempt (1-indexed) for logging/observability. */
  onError?: (error: unknown, attempt: number) => void;
  /**
   * Decide whether an error is worth retrying (default: always retry). Return
   * false for permanent failures (e.g. a 404/401) so they fail fast.
   */
  shouldRetry?: (error: unknown) => boolean;
}

const sleep = (ms: number) =>
  ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();

/**
 * Run an async function with retries. Retries on any thrown error, invoking
 * `onError` after each failure, and rethrows the last error once retries are
 * exhausted. Used to make transient WordPress API failures (timeouts, brief
 * WAF/egress hiccups from the Railway host) recoverable and, critically,
 * visible in logs instead of silently swallowed.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const { retries = 2, delayMs = 300, onError, shouldRetry } = opts;
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      onError?.(error, attempt);
      if (shouldRetry && !shouldRetry(error)) break;
      if (attempt <= retries) await sleep(delayMs);
    }
  }

  throw lastError;
}
