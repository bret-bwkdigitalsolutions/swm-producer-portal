import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const redisStore = new Map<string, number>();
const mockIncr = vi.fn(async (k: string) => {
  const v = (redisStore.get(k) ?? 0) + 1;
  redisStore.set(k, v);
  return v;
});
const mockExpire = vi.fn(async () => 1);
const mockTtl = vi.fn(async () => 600);

vi.mock("@upstash/redis", () => ({
  Redis: class {
    incr = mockIncr;
    expire = mockExpire;
    ttl = mockTtl;
  },
}));

import { rateLimit, clientIpFromHeaders, __resetRateLimitMemory } from "@/lib/rate-limit";

const originalEnv = process.env;

beforeEach(() => {
  vi.clearAllMocks();
  redisStore.clear();
  process.env = { ...originalEnv };
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  __resetRateLimitMemory();
});

afterEach(() => {
  process.env = originalEnv;
  vi.useRealTimers();
});

describe("rateLimit (in-memory fallback)", () => {
  it("allows up to the limit, then blocks with a retry-after", async () => {
    const opts = { limit: 3, windowSeconds: 60 };
    for (let i = 0; i < 3; i++) {
      expect((await rateLimit("login:email:a@b.com", opts)).allowed).toBe(true);
    }
    const blocked = await rateLimit("login:email:a@b.com", opts);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    // Other keys are independent.
    expect((await rateLimit("login:email:c@d.com", opts)).allowed).toBe(true);
  });

  it("resets after the window", async () => {
    vi.useFakeTimers();
    const opts = { limit: 1, windowSeconds: 60 };
    await rateLimit("k", opts);
    expect((await rateLimit("k", opts)).allowed).toBe(false);
    vi.advanceTimersByTime(61_000);
    expect((await rateLimit("k", opts)).allowed).toBe(true);
  });
});

describe("rateLimit (Upstash)", () => {
  it("uses Redis INCR with an expiry when configured", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "token";
    __resetRateLimitMemory();
    const opts = { limit: 2, windowSeconds: 900 };
    expect((await rateLimit("pw", opts)).allowed).toBe(true);
    expect(mockExpire).toHaveBeenCalledWith("ratelimit:pw", 900);
    expect((await rateLimit("pw", opts)).allowed).toBe(true);
    expect((await rateLimit("pw", opts)).allowed).toBe(false);
  });

  it("falls back to memory if Redis errors", async () => {
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "token";
    __resetRateLimitMemory();
    mockIncr.mockRejectedValueOnce(new Error("redis down"));
    expect((await rateLimit("x", { limit: 1, windowSeconds: 60 })).allowed).toBe(true);
  });
});

describe("clientIpFromHeaders", () => {
  it("takes the first X-Forwarded-For address", () => {
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    expect(clientIpFromHeaders(new Headers())).toBe("unknown");
  });
});
