import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @upstash/redis before importing cache module
vi.mock("@upstash/redis", () => ({
  Redis: vi.fn(),
}));

// Reset modules between tests so env var changes take effect
beforeEach(() => {
  vi.resetModules();
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

describe("getCached (in-memory fallback)", () => {
  it("calls fetcher on cache miss and returns result", async () => {
    const { getCached } = await import("@/lib/analytics/cache");
    const fetcher = vi.fn().mockResolvedValue({ count: 42 });

    const result = await getCached("test:key", 3600, fetcher);

    expect(result).toEqual({ count: 42 });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("returns cached value on subsequent calls", async () => {
    const { getCached } = await import("@/lib/analytics/cache");
    const fetcher = vi.fn().mockResolvedValue({ count: 42 });

    await getCached("test:key2", 3600, fetcher);
    const result = await getCached("test:key2", 3600, fetcher);

    expect(result).toEqual({ count: 42 });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
