import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../retry";

describe("withRetry", () => {
  it("returns the result without retrying when the first attempt succeeds", async () => {
    const fn = vi.fn(async () => "ok");
    const result = await withRetry(fn, { retries: 2, delayMs: 0 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries after a failure and returns the first successful attempt", async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("recovered");
    const onError = vi.fn();

    const result = await withRetry(fn, { retries: 2, delayMs: 0, onError });

    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("stops immediately and rethrows when shouldRetry returns false", async () => {
    const err = new Error("permanent");
    const fn = vi.fn(async () => {
      throw err;
    });
    const onError = vi.fn();

    await expect(
      withRetry(fn, {
        retries: 3,
        delayMs: 0,
        onError,
        shouldRetry: () => false,
      })
    ).rejects.toThrow("permanent");

    // No retries: the error was classified as non-retryable on the first failure.
    expect(fn).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("throws the last error and reports every failure after exhausting retries", async () => {
    const err = new Error("still down");
    const fn = vi.fn(async () => {
      throw err;
    });
    const onError = vi.fn();

    await expect(
      withRetry(fn, { retries: 2, delayMs: 0, onError })
    ).rejects.toThrow("still down");

    // initial attempt + 2 retries = 3 calls
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledTimes(3);
  });
});
