import { Redis } from "@upstash/redis";

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const memoryCache = new Map<string, CacheEntry<unknown>>();

function getRedisClient(): Redis | null {
  if (
    process.env.UPSTASH_REDIS_REST_URL &&
    process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    return new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return null;
}

export async function getCached<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const redis = getRedisClient();

  // Try Redis first
  if (redis) {
    try {
      const cached = await redis.get<T>(key);
      if (cached !== null && cached !== undefined) {
        return cached;
      }
    } catch {
      // Fall through to memory cache
    }
  }

  // Try in-memory cache
  const memEntry = memoryCache.get(key) as CacheEntry<T> | undefined;
  if (memEntry && memEntry.expiresAt > Date.now()) {
    return memEntry.data;
  }

  // Fetch fresh data
  const data = await fetcher();

  // Store in Redis
  if (redis) {
    try {
      await redis.set(key, data, { ex: ttlSeconds });
    } catch {
      // Fall through to memory
    }
  }

  // Store in memory
  memoryCache.set(key, {
    data,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });

  return data;
}

export async function bustCachePrefix(prefix: string): Promise<void> {
  // Clear in-memory
  for (const key of memoryCache.keys()) {
    if (key.startsWith(prefix)) {
      memoryCache.delete(key);
    }
  }

  // Clear Redis
  const redis = getRedisClient();
  if (redis) {
    try {
      let cursor = 0;
      do {
        const result = await redis.scan(cursor, {
          match: `${prefix}*`,
          count: 100,
        });
        cursor = result[0] as unknown as number;
        const keys = result[1] as string[];
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      } while (cursor !== 0);
    } catch {
      // Best effort
    }
  }
}
