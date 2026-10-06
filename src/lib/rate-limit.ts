import "server-only";

import { Redis } from "@upstash/redis";

/**
 * Fixed-window rate limiter.
 *
 * Uses Upstash Redis when UPSTASH_REDIS_REST_URL/TOKEN are set (shared across
 * instances and restarts), otherwise an in-memory map (per instance). If Redis
 * errors, it falls back to memory rather than locking everyone out.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

const memory = new Map<string, { count: number; resetAt: number }>();
let redisClient: Redis | null | undefined;

function getRedis(): Redis | null {
  if (redisClient !== undefined) return redisClient;
  redisClient =
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
      ? new Redis({
          url: process.env.UPSTASH_REDIS_REST_URL,
          token: process.env.UPSTASH_REDIS_REST_TOKEN,
        })
      : null;
  return redisClient;
}

function memoryHit(key: string, windowSeconds: number): { count: number; ttl: number } {
  const now = Date.now();
  // Opportunistic cleanup so the map can't grow without bound.
  if (memory.size > 10_000) {
    for (const [k, v] of memory) if (v.resetAt <= now) memory.delete(k);
  }
  const entry = memory.get(key);
  if (!entry || entry.resetAt <= now) {
    memory.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { count: 1, ttl: windowSeconds };
  }
  entry.count++;
  return { count: entry.count, ttl: Math.ceil((entry.resetAt - now) / 1000) };
}

export async function rateLimit(
  key: string,
  { limit, windowSeconds }: { limit: number; windowSeconds: number }
): Promise<RateLimitResult> {
  const fullKey = `ratelimit:${key}`;
  let count: number;
  let ttl: number;

  const redis = getRedis();
  try {
    if (!redis) throw new Error("no redis");
    count = await redis.incr(fullKey);
    if (count === 1) {
      await redis.expire(fullKey, windowSeconds);
      ttl = windowSeconds;
    } else {
      ttl = await redis.ttl(fullKey);
      if (ttl < 0) {
        // Key lost its expiry (e.g. expire call failed) — re-arm it.
        await redis.expire(fullKey, windowSeconds);
        ttl = windowSeconds;
      }
    }
  } catch {
    ({ count, ttl } = memoryHit(fullKey, windowSeconds));
  }

  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds: count <= limit ? 0 : ttl,
  };
}

/** Best-effort client IP from proxy headers (Railway sets X-Forwarded-For). */
export function clientIpFromHeaders(headers: Headers | { get(name: string): string | null }): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim() || "unknown";
  return headers.get("x-real-ip")?.trim() || "unknown";
}

/** Test helper. */
export function __resetRateLimitMemory() {
  memory.clear();
  redisClient = undefined;
}
