# Analytics Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate Transistor podcast and YouTube analytics into the SWM Producer Portal, replacing the standalone analytics dashboard.

**Architecture:** Server-side library functions fetch from Transistor/YouTube APIs using per-show credentials from the existing `PlatformCredential` model, cached via Upstash Redis. Client components render charts with Recharts. All views scoped to user's accessible shows via existing `UserShowAccess` model.

**Tech Stack:** Next.js 16, Prisma 7, Upstash Redis, Recharts, Tailwind v4, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-29-analytics-integration-design.md`

---

## File Structure

### New files to create:

**Types & utilities:**
- `src/lib/analytics/types.ts` — TypeScript types for all analytics data
- `src/lib/analytics/cache.ts` — Redis + in-memory cache wrapper
- `src/lib/analytics/credentials.ts` — Credential + platform ID resolution
- `src/lib/analytics/date-utils.ts` — Date range presets and formatting
- `src/lib/analytics/transistor.ts` — Transistor API data fetching
- `src/lib/analytics/youtube.ts` — YouTube API data fetching

**Chart components:**
- `src/components/analytics/charts/time-series-chart.tsx` — Line chart
- `src/components/analytics/charts/bar-chart.tsx` — Bar chart (horizontal/vertical)
- `src/components/analytics/charts/donut-chart.tsx` — Donut/pie chart
- `src/components/analytics/charts/area-chart.tsx` — Stacked area chart
- `src/components/analytics/stat-card.tsx` — Metric card

**UI components:**
- `src/components/analytics/show-selector.tsx` — Show dropdown
- `src/components/analytics/date-range-picker.tsx` — Date range presets + custom
- `src/components/analytics/date-range-provider.tsx` — Date range context
- `src/components/analytics/analytics-nav.tsx` — Tab navigation
- `src/components/analytics/episode-table.tsx` — Sortable episode list
- `src/components/analytics/video-table.tsx` — Sortable video list

**Pages:**
- `src/app/dashboard/analytics/layout.tsx` — Analytics layout with auth + show selector
- `src/app/dashboard/analytics/page.tsx` — Overview page
- `src/app/dashboard/analytics/podcasts/page.tsx` — Podcast analytics
- `src/app/dashboard/analytics/podcasts/episodes/[id]/page.tsx` — Episode detail
- `src/app/dashboard/analytics/youtube/page.tsx` — YouTube analytics
- `src/app/dashboard/analytics/youtube/videos/[id]/page.tsx` — Video detail
- `src/app/dashboard/analytics/compare/page.tsx` — Show comparison

### Files to modify:
- `src/components/sidebar.tsx` — Add Analytics nav item
- `package.json` — Add recharts, @upstash/redis, date-fns dependencies

---

### Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install recharts, @upstash/redis, and date-fns**

```bash
npm install recharts @upstash/redis date-fns
```

- [ ] **Step 2: Verify installation**

```bash
npm ls recharts @upstash/redis date-fns
```

Expected: All three packages listed with versions.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add recharts, @upstash/redis, and date-fns dependencies"
```

---

### Task 2: Analytics Types

**Files:**
- Create: `src/lib/analytics/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
// Transistor types

export interface TransistorShow {
  id: string;
  type: string;
  attributes: {
    title: string;
    description: string;
    author: string;
    image_url: string;
    created_at: string;
    updated_at: string;
  };
}

export interface TransistorEpisode {
  id: string;
  type: string;
  attributes: {
    title: string;
    summary: string;
    published_at: string;
    duration: number;
    number: number;
    status: string;
    share_url: string;
    media_url: string;
    image_url: string;
    formatted_published_at: string;
  };
}

export interface TransistorAnalyticsPoint {
  date: string;
  downloads: number;
}

export interface TransistorAnalyticsResponse {
  data: {
    id: string;
    type: string;
    attributes: {
      downloads: TransistorAnalyticsPoint[];
      start_date: string;
      end_date: string;
    };
  };
}

export interface TransistorCountryData {
  country: string;
  downloads: number;
}

export interface TransistorAppData {
  app: string;
  downloads: number;
}

export interface TransistorDeviceData {
  device: string;
  downloads: number;
  percentage: number;
}

// YouTube types

export interface YouTubeChannelStats {
  subscriberCount: number;
  viewCount: number;
  videoCount: number;
}

export interface YouTubeVideo {
  id: string;
  title: string;
  description: string;
  publishedAt: string;
  thumbnailUrl: string;
  duration: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
}

export interface YouTubeAnalyticsPoint {
  date: string;
  views: number;
  estimatedMinutesWatched: number;
  subscribersGained: number;
  subscribersLost: number;
}

export interface YouTubeTrafficSource {
  source: string;
  views: number;
  estimatedMinutesWatched: number;
}

export interface YouTubeCountryData {
  country: string;
  views: number;
  estimatedMinutesWatched: number;
}

// Shared types

export interface DateRange {
  from: string;
  to: string;
}

export type DateRangePreset = "7d" | "30d" | "90d" | "12m" | "custom";

export interface AccessibleShow {
  wpShowId: number;
  title: string;
}
```

- [ ] **Step 2: Verify the file compiles**

```bash
npx tsc --noEmit src/lib/analytics/types.ts
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/analytics/types.ts
git commit -m "feat(analytics): add TypeScript types for Transistor and YouTube analytics"
```

---

### Task 3: Date Utilities

**Files:**
- Create: `src/lib/analytics/date-utils.ts`
- Test: `src/__tests__/lib/analytics/date-utils.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getDateRange, formatDate } from "@/lib/analytics/date-utils";

describe("formatDate", () => {
  it("formats a Date as YYYY-MM-DD", () => {
    const date = new Date(2026, 2, 15); // March 15, 2026
    expect(formatDate(date)).toBe("2026-03-15");
  });
});

describe("getDateRange", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 29)); // March 29, 2026
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 7 day range", () => {
    const range = getDateRange("7d");
    expect(range.from).toBe("2026-03-22");
    expect(range.to).toBe("2026-03-29");
  });

  it("returns 30 day range", () => {
    const range = getDateRange("30d");
    expect(range.from).toBe("2026-02-27");
    expect(range.to).toBe("2026-03-29");
  });

  it("returns 90 day range", () => {
    const range = getDateRange("90d");
    expect(range.from).toBe("2025-12-29");
    expect(range.to).toBe("2026-03-29");
  });

  it("returns 12 month range", () => {
    const range = getDateRange("12m");
    expect(range.from).toBe("2025-03-29");
    expect(range.to).toBe("2026-03-29");
  });

  it("defaults to 30d for custom preset", () => {
    const range = getDateRange("custom");
    expect(range.from).toBe("2026-02-27");
    expect(range.to).toBe("2026-03-29");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/__tests__/lib/analytics/date-utils.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
import { format, subDays, subMonths } from "date-fns";
import type { DateRangePreset, DateRange } from "./types";

export function formatDate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export function formatNumber(num: number): string {
  return new Intl.NumberFormat().format(num);
}

export function getDateRange(preset: DateRangePreset): DateRange {
  const end = new Date();
  let start: Date;

  switch (preset) {
    case "7d":
      start = subDays(end, 7);
      break;
    case "30d":
      start = subDays(end, 30);
      break;
    case "90d":
      start = subDays(end, 90);
      break;
    case "12m":
      start = subMonths(end, 12);
      break;
    default:
      start = subDays(end, 30);
  }

  return { from: formatDate(start), to: formatDate(end) };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/__tests__/lib/analytics/date-utils.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics/date-utils.ts src/__tests__/lib/analytics/date-utils.test.ts
git commit -m "feat(analytics): add date range utility functions with tests"
```

---

### Task 4: Redis Cache Layer

**Files:**
- Create: `src/lib/analytics/cache.ts`
- Test: `src/__tests__/lib/analytics/cache.test.ts`

- [ ] **Step 1: Write the test**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/__tests__/lib/analytics/cache.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/__tests__/lib/analytics/cache.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics/cache.ts src/__tests__/lib/analytics/cache.test.ts
git commit -m "feat(analytics): add Redis + in-memory cache layer"
```

---

### Task 5: Credential & Platform ID Resolution

**Files:**
- Create: `src/lib/analytics/credentials.ts`
- Test: `src/__tests__/lib/analytics/credentials.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveCredential, resolvePlatformId } from "@/lib/analytics/credentials";

// Mock the db module
vi.mock("@/lib/db", () => ({
  db: {
    platformCredential: {
      findUnique: vi.fn(),
    },
    showPlatformLink: {
      findUnique: vi.fn(),
    },
  },
}));

import { db } from "@/lib/db";

const mockCredentialFind = vi.mocked(db.platformCredential.findUnique);
const mockPlatformLinkFind = vi.mocked(db.showPlatformLink.findUnique);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveCredential", () => {
  it("returns show-specific credential when it exists", async () => {
    const cred = { id: "1", apiKey: "key123", platform: "transistor" };
    mockCredentialFind.mockResolvedValue(cred as never);

    const result = await resolveCredential(5, "transistor");

    expect(result).toEqual(cred);
    expect(mockCredentialFind).toHaveBeenCalledWith({
      where: { wpShowId_platform: { wpShowId: 5, platform: "transistor" } },
    });
  });

  it("falls back to network default (wpShowId=0) when show-specific not found", async () => {
    const networkCred = { id: "2", apiKey: "network-key", platform: "transistor" };
    mockCredentialFind
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(networkCred as never);

    const result = await resolveCredential(5, "transistor");

    expect(result).toEqual(networkCred);
    expect(mockCredentialFind).toHaveBeenCalledTimes(2);
  });

  it("returns null when no credential exists at any level", async () => {
    mockCredentialFind.mockResolvedValue(null as never);

    const result = await resolveCredential(5, "transistor");

    expect(result).toBeNull();
  });
});

describe("resolvePlatformId", () => {
  it("returns show-specific platform link URL", async () => {
    mockPlatformLinkFind.mockResolvedValue({
      id: "1",
      url: "https://share.transistor.fm/s/abc123",
      wpShowId: 5,
      platform: "transistor_show",
    } as never);

    const result = await resolvePlatformId(5, "transistor_show");

    expect(result).toBe("https://share.transistor.fm/s/abc123");
  });

  it("falls back to network default when show-specific not found", async () => {
    mockPlatformLinkFind
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({
        id: "2",
        url: "https://share.transistor.fm/s/network",
        wpShowId: 0,
        platform: "transistor_show",
      } as never);

    const result = await resolvePlatformId(5, "transistor_show");

    expect(result).toBe("https://share.transistor.fm/s/network");
  });

  it("returns null when no platform link exists", async () => {
    mockPlatformLinkFind.mockResolvedValue(null as never);

    const result = await resolvePlatformId(5, "transistor_show");

    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/__tests__/lib/analytics/credentials.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
import "server-only";
import { db } from "@/lib/db";
import { refreshAccessToken } from "@/lib/youtube-oauth";

/**
 * Resolve an API credential for a given show and platform.
 * Falls back to network default (wpShowId=0) if show-specific not found.
 */
export async function resolveCredential(
  wpShowId: number,
  platform: string
) {
  // Try show-specific first
  const showCred = await db.platformCredential.findUnique({
    where: { wpShowId_platform: { wpShowId, platform } },
  });
  if (showCred) return showCred;

  // Fall back to network default
  if (wpShowId !== 0) {
    const networkCred = await db.platformCredential.findUnique({
      where: { wpShowId_platform: { wpShowId: 0, platform } },
    });
    return networkCred;
  }

  return null;
}

/**
 * Resolve a platform-specific identifier (URL) for a show.
 * Falls back to network default (wpShowId=0) if show-specific not found.
 */
export async function resolvePlatformId(
  wpShowId: number,
  platformLinkType: string
): Promise<string | null> {
  const showLink = await db.showPlatformLink.findUnique({
    where: { wpShowId_platform: { wpShowId, platform: platformLinkType } },
  });
  if (showLink) return showLink.url;

  if (wpShowId !== 0) {
    const networkLink = await db.showPlatformLink.findUnique({
      where: { wpShowId_platform: { wpShowId: 0, platform: platformLinkType } },
    });
    return networkLink?.url ?? null;
  }

  return null;
}

/**
 * Get a valid YouTube access token for a show, refreshing if expired.
 * Updates the credential in the database with the new token.
 */
export async function getYouTubeAccessToken(
  wpShowId: number
): Promise<string | null> {
  const cred = await resolveCredential(wpShowId, "youtube");
  if (!cred || !cred.refreshToken) return null;

  // Check if token is still valid (with 5 min buffer)
  const isExpired =
    !cred.accessToken ||
    !cred.tokenExpiresAt ||
    cred.tokenExpiresAt < new Date(Date.now() + 5 * 60 * 1000);

  if (!isExpired && cred.accessToken) {
    return cred.accessToken;
  }

  // Refresh the token
  const { accessToken, expiresAt } = await refreshAccessToken(cred.refreshToken);

  // Update the credential in the database
  await db.platformCredential.update({
    where: { id: cred.id },
    data: {
      accessToken,
      tokenExpiresAt: expiresAt,
      status: "valid",
    },
  });

  return accessToken;
}

/**
 * Get the Transistor API key for a show.
 */
export async function getTransistorApiKey(
  wpShowId: number
): Promise<string | null> {
  const cred = await resolveCredential(wpShowId, "transistor");
  return cred?.apiKey ?? null;
}

/**
 * Extract a Transistor show ID from its ShowPlatformLink URL.
 * URL format: the stored value may be a numeric ID or a URL like
 * "https://share.transistor.fm/s/abc123" — we store the Transistor show ID directly.
 */
export function parseTransistorShowId(urlOrId: string): string {
  // If it's purely numeric, it's already a show ID
  if (/^\d+$/.test(urlOrId)) return urlOrId;

  // Try to extract from URL path
  try {
    const url = new URL(urlOrId);
    const segments = url.pathname.split("/").filter(Boolean);
    return segments[segments.length - 1] || urlOrId;
  } catch {
    return urlOrId;
  }
}

/**
 * Extract a YouTube channel ID from its ShowPlatformLink URL.
 * URL formats:
 *   - https://youtube.com/channel/UC...
 *   - https://youtube.com/@handle
 *   - Just the channel ID: UC...
 */
export function parseYouTubeChannelId(urlOrId: string): string {
  if (urlOrId.startsWith("UC")) return urlOrId;

  try {
    const url = new URL(urlOrId);
    const segments = url.pathname.split("/").filter(Boolean);
    const channelIdx = segments.indexOf("channel");
    if (channelIdx !== -1 && segments[channelIdx + 1]) {
      return segments[channelIdx + 1];
    }
    return segments[segments.length - 1] || urlOrId;
  } catch {
    return urlOrId;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/__tests__/lib/analytics/credentials.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics/credentials.ts src/__tests__/lib/analytics/credentials.test.ts
git commit -m "feat(analytics): add credential and platform ID resolution"
```

---

### Task 6: Transistor Analytics API Library

**Files:**
- Create: `src/lib/analytics/transistor.ts`
- Test: `src/__tests__/lib/analytics/transistor.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("@/lib/analytics/credentials", () => ({
  getTransistorApiKey: vi.fn(),
  resolvePlatformId: vi.fn(),
  parseTransistorShowId: vi.fn((id: string) => id),
}));

vi.mock("@/lib/analytics/cache", () => ({
  getCached: vi.fn((_key: string, _ttl: number, fetcher: () => Promise<unknown>) => fetcher()),
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

import { getTransistorShowAnalytics } from "@/lib/analytics/transistor";
import { getTransistorApiKey, resolvePlatformId } from "@/lib/analytics/credentials";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getTransistorShowAnalytics", () => {
  it("fetches show analytics with correct params", async () => {
    vi.mocked(getTransistorApiKey).mockResolvedValue("test-key");
    vi.mocked(resolvePlatformId).mockResolvedValue("12345");

    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            attributes: {
              downloads: [
                { date: "2026-03-01", downloads: 100 },
                { date: "2026-03-02", downloads: 150 },
              ],
            },
          },
        }),
    });

    const result = await getTransistorShowAnalytics(5, {
      from: "2026-03-01",
      to: "2026-03-02",
    });

    expect(result).toEqual([
      { date: "2026-03-01", downloads: 100 },
      { date: "2026-03-02", downloads: 150 },
    ]);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("show_id=12345"),
      expect.objectContaining({
        headers: { "x-api-key": "test-key" },
      })
    );
  });

  it("throws when no API key is configured", async () => {
    vi.mocked(getTransistorApiKey).mockResolvedValue(null);

    await expect(
      getTransistorShowAnalytics(5, { from: "2026-03-01", to: "2026-03-02" })
    ).rejects.toThrow("No Transistor API key");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/__tests__/lib/analytics/transistor.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
import "server-only";
import { getCached } from "./cache";
import {
  getTransistorApiKey,
  resolvePlatformId,
  parseTransistorShowId,
} from "./credentials";
import type {
  TransistorShow,
  TransistorEpisode,
  TransistorAnalyticsPoint,
  TransistorCountryData,
  TransistorAppData,
  TransistorDeviceData,
  DateRange,
} from "./types";

const BASE_URL = "https://api.transistor.fm/v1";

async function transistorFetch<T>(
  path: string,
  apiKey: string,
  params?: Record<string, string>
): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  const res = await fetch(url.toString(), {
    headers: { "x-api-key": apiKey },
  });

  if (!res.ok) {
    throw new Error(`Transistor API error: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

async function requireApiKey(wpShowId: number): Promise<string> {
  const key = await getTransistorApiKey(wpShowId);
  if (!key) throw new Error("No Transistor API key configured for this show.");
  return key;
}

async function requireShowId(wpShowId: number): Promise<string> {
  const url = await resolvePlatformId(wpShowId, "transistor_show");
  if (!url) throw new Error("No Transistor show linked for this show.");
  return parseTransistorShowId(url);
}

export async function getTransistorShows(
  wpShowId: number
): Promise<TransistorShow[]> {
  const apiKey = await requireApiKey(wpShowId);

  return getCached(`analytics:transistor:${wpShowId}:shows`, 3600, async () => {
    const raw = await transistorFetch<{ data: TransistorShow[] }>(
      "/shows",
      apiKey
    );
    return raw.data ?? [];
  });
}

export async function getTransistorEpisodes(
  wpShowId: number
): Promise<TransistorEpisode[]> {
  const apiKey = await requireApiKey(wpShowId);
  const showId = await requireShowId(wpShowId);

  return getCached(
    `analytics:transistor:${wpShowId}:episodes`,
    3600,
    async () => {
      const raw = await transistorFetch<{ data: TransistorEpisode[] }>(
        "/episodes",
        apiKey,
        { show_id: showId }
      );
      return raw.data ?? [];
    }
  );
}

export async function getTransistorShowAnalytics(
  wpShowId: number,
  dateRange: DateRange
): Promise<TransistorAnalyticsPoint[]> {
  const apiKey = await requireApiKey(wpShowId);
  const showId = await requireShowId(wpShowId);

  return getCached(
    `analytics:transistor:${wpShowId}:show:${dateRange.from}:${dateRange.to}`,
    14400,
    async () => {
      const raw = await transistorFetch<{
        data: { attributes: { downloads: TransistorAnalyticsPoint[] } };
      }>("/analytics", apiKey, {
        show_id: showId,
        start_date: dateRange.from,
        end_date: dateRange.to,
      });
      return raw.data?.attributes?.downloads ?? [];
    }
  );
}

export async function getTransistorEpisodeAnalytics(
  wpShowId: number,
  episodeId: string,
  dateRange: DateRange
): Promise<TransistorAnalyticsPoint[]> {
  const apiKey = await requireApiKey(wpShowId);

  return getCached(
    `analytics:transistor:${wpShowId}:episode:${episodeId}:${dateRange.from}:${dateRange.to}`,
    14400,
    async () => {
      const raw = await transistorFetch<{
        data: { attributes: { downloads: TransistorAnalyticsPoint[] } };
      }>(`/analytics/episodes/${episodeId}`, apiKey, {
        start_date: dateRange.from,
        end_date: dateRange.to,
      });
      return raw.data?.attributes?.downloads ?? [];
    }
  );
}

export async function getTransistorCountryAnalytics(
  wpShowId: number
): Promise<TransistorCountryData[]> {
  const apiKey = await requireApiKey(wpShowId);
  const showId = await requireShowId(wpShowId);

  return getCached(
    `analytics:transistor:${wpShowId}:countries`,
    14400,
    async () => {
      const raw = await transistorFetch<{
        data: { attributes: { countries: TransistorCountryData[] } };
      }>("/analytics/countries", apiKey, { show_id: showId });
      return raw.data?.attributes?.countries ?? [];
    }
  );
}

export async function getTransistorAppAnalytics(
  wpShowId: number
): Promise<TransistorAppData[]> {
  const apiKey = await requireApiKey(wpShowId);
  const showId = await requireShowId(wpShowId);

  return getCached(
    `analytics:transistor:${wpShowId}:apps`,
    14400,
    async () => {
      const raw = await transistorFetch<{
        data: { attributes: { applications: TransistorAppData[] } };
      }>("/analytics/applications", apiKey, { show_id: showId });
      return raw.data?.attributes?.applications ?? [];
    }
  );
}

export async function getTransistorDeviceAnalytics(
  wpShowId: number
): Promise<TransistorDeviceData[]> {
  const apiKey = await requireApiKey(wpShowId);
  const showId = await requireShowId(wpShowId);

  return getCached(
    `analytics:transistor:${wpShowId}:devices`,
    14400,
    async () => {
      const raw = await transistorFetch<{
        data: { attributes: { devices: TransistorDeviceData[] } };
      }>("/analytics/devices", apiKey, { show_id: showId });
      return raw.data?.attributes?.devices ?? [];
    }
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/__tests__/lib/analytics/transistor.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics/transistor.ts src/__tests__/lib/analytics/transistor.test.ts
git commit -m "feat(analytics): add Transistor API data fetching library"
```

---

### Task 7: YouTube Analytics API Library

**Files:**
- Create: `src/lib/analytics/youtube.ts`
- Test: `src/__tests__/lib/analytics/youtube.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/analytics/credentials", () => ({
  getYouTubeAccessToken: vi.fn(),
}));

vi.mock("@/lib/analytics/cache", () => ({
  getCached: vi.fn((_key: string, _ttl: number, fetcher: () => Promise<unknown>) => fetcher()),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { getYouTubeChannelStats, getYouTubeChannelAnalytics } from "@/lib/analytics/youtube";
import { getYouTubeAccessToken } from "@/lib/analytics/credentials";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getYouTubeChannelStats", () => {
  it("fetches channel statistics", async () => {
    vi.mocked(getYouTubeAccessToken).mockResolvedValue("access-token");

    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          items: [
            {
              statistics: {
                subscriberCount: "1000",
                viewCount: "50000",
                videoCount: "120",
              },
            },
          ],
        }),
    });

    const result = await getYouTubeChannelStats(5);

    expect(result).toEqual({
      subscriberCount: 1000,
      viewCount: 50000,
      videoCount: 120,
    });
  });

  it("throws when no access token available", async () => {
    vi.mocked(getYouTubeAccessToken).mockResolvedValue(null);

    await expect(getYouTubeChannelStats(5)).rejects.toThrow(
      "No YouTube credentials"
    );
  });
});

describe("getYouTubeChannelAnalytics", () => {
  it("fetches and parses channel analytics rows", async () => {
    vi.mocked(getYouTubeAccessToken).mockResolvedValue("access-token");

    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          rows: [
            ["2026-03-01", 100, 500, 5, 1],
            ["2026-03-02", 150, 700, 8, 2],
          ],
        }),
    });

    const result = await getYouTubeChannelAnalytics(5, {
      from: "2026-03-01",
      to: "2026-03-02",
    });

    expect(result).toEqual([
      {
        date: "2026-03-01",
        views: 100,
        estimatedMinutesWatched: 500,
        subscribersGained: 5,
        subscribersLost: 1,
      },
      {
        date: "2026-03-02",
        views: 150,
        estimatedMinutesWatched: 700,
        subscribersGained: 8,
        subscribersLost: 2,
      },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/__tests__/lib/analytics/youtube.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
import "server-only";
import { getCached } from "./cache";
import { getYouTubeAccessToken } from "./credentials";
import type {
  YouTubeChannelStats,
  YouTubeVideo,
  YouTubeAnalyticsPoint,
  YouTubeTrafficSource,
  YouTubeCountryData,
  DateRange,
} from "./types";

const DATA_API_BASE = "https://www.googleapis.com/youtube/v3";
const ANALYTICS_API_BASE = "https://youtubeanalytics.googleapis.com/v2";

async function requireAccessToken(wpShowId: number): Promise<string> {
  const token = await getYouTubeAccessToken(wpShowId);
  if (!token) throw new Error("No YouTube credentials configured for this show.");
  return token;
}

async function fetchDataApi(
  accessToken: string,
  path: string,
  params: Record<string, string>
) {
  const url = new URL(`${DATA_API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`YouTube Data API error (${res.status}): ${text}`);
  }

  return res.json();
}

async function fetchAnalyticsApi(
  accessToken: string,
  params: {
    metrics: string;
    dimensions?: string;
    filters?: string;
    startDate: string;
    endDate: string;
  }
) {
  const url = new URL(`${ANALYTICS_API_BASE}/reports`);
  url.searchParams.set("ids", "channel==MINE");
  url.searchParams.set("metrics", params.metrics);
  if (params.dimensions) url.searchParams.set("dimensions", params.dimensions);
  if (params.filters) url.searchParams.set("filters", params.filters);
  url.searchParams.set("startDate", params.startDate);
  url.searchParams.set("endDate", params.endDate);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`YouTube Analytics API error (${res.status}): ${text}`);
  }

  return res.json();
}

export async function getYouTubeChannelStats(
  wpShowId: number
): Promise<YouTubeChannelStats> {
  const accessToken = await requireAccessToken(wpShowId);

  return getCached(
    `analytics:youtube:${wpShowId}:channel-stats`,
    3600,
    async () => {
      const data = await fetchDataApi(accessToken, "/channels", {
        part: "statistics",
        mine: "true",
      });

      const stats = data.items?.[0]?.statistics;
      if (!stats) throw new Error("No channel statistics found");

      return {
        subscriberCount: Number(stats.subscriberCount),
        viewCount: Number(stats.viewCount),
        videoCount: Number(stats.videoCount),
      };
    }
  );
}

export async function getYouTubeVideos(
  wpShowId: number,
  maxResults = 50
): Promise<YouTubeVideo[]> {
  const accessToken = await requireAccessToken(wpShowId);

  return getCached(
    `analytics:youtube:${wpShowId}:videos`,
    3600,
    async () => {
      // Step 1: Search for channel's videos
      const searchData = await fetchDataApi(accessToken, "/search", {
        part: "snippet",
        forMine: "true",
        type: "video",
        order: "date",
        maxResults: String(maxResults),
      });

      const videoIds: string[] = (searchData.items || []).map(
        (item: { id: { videoId: string } }) => item.id.videoId
      );

      if (videoIds.length === 0) return [];

      // Step 2: Fetch full details in batches of 50
      const videos: YouTubeVideo[] = [];
      for (let i = 0; i < videoIds.length; i += 50) {
        const chunk = videoIds.slice(i, i + 50);
        const detailData = await fetchDataApi(accessToken, "/videos", {
          part: "snippet,statistics,contentDetails",
          id: chunk.join(","),
        });

        for (const item of detailData.items || []) {
          videos.push({
            id: item.id,
            title: item.snippet.title,
            description: item.snippet.description,
            publishedAt: item.snippet.publishedAt,
            thumbnailUrl:
              item.snippet.thumbnails?.medium?.url ||
              item.snippet.thumbnails?.default?.url ||
              "",
            duration: item.contentDetails.duration,
            viewCount: Number(item.statistics.viewCount || 0),
            likeCount: Number(item.statistics.likeCount || 0),
            commentCount: Number(item.statistics.commentCount || 0),
          });
        }
      }

      return videos;
    }
  );
}

export async function getYouTubeChannelAnalytics(
  wpShowId: number,
  dateRange: DateRange
): Promise<YouTubeAnalyticsPoint[]> {
  const accessToken = await requireAccessToken(wpShowId);

  return getCached(
    `analytics:youtube:${wpShowId}:channel:${dateRange.from}:${dateRange.to}`,
    21600,
    async () => {
      const data = await fetchAnalyticsApi(accessToken, {
        metrics:
          "views,estimatedMinutesWatched,subscribersGained,subscribersLost",
        dimensions: "day",
        startDate: dateRange.from,
        endDate: dateRange.to,
      });

      return (data.rows || []).map((row: number[]) => ({
        date: row[0],
        views: row[1],
        estimatedMinutesWatched: row[2],
        subscribersGained: row[3],
        subscribersLost: row[4],
      }));
    }
  );
}

export async function getYouTubeVideoAnalytics(
  wpShowId: number,
  videoId: string,
  dateRange: DateRange
): Promise<YouTubeAnalyticsPoint[]> {
  const accessToken = await requireAccessToken(wpShowId);

  return getCached(
    `analytics:youtube:${wpShowId}:video:${videoId}:${dateRange.from}:${dateRange.to}`,
    21600,
    async () => {
      const data = await fetchAnalyticsApi(accessToken, {
        metrics:
          "views,estimatedMinutesWatched,subscribersGained,subscribersLost",
        dimensions: "day",
        filters: `video==${videoId}`,
        startDate: dateRange.from,
        endDate: dateRange.to,
      });

      return (data.rows || []).map((row: number[]) => ({
        date: row[0],
        views: row[1],
        estimatedMinutesWatched: row[2],
        subscribersGained: row[3],
        subscribersLost: row[4],
      }));
    }
  );
}

export async function getYouTubeTrafficSources(
  wpShowId: number,
  dateRange: DateRange
): Promise<YouTubeTrafficSource[]> {
  const accessToken = await requireAccessToken(wpShowId);

  return getCached(
    `analytics:youtube:${wpShowId}:traffic:${dateRange.from}:${dateRange.to}`,
    21600,
    async () => {
      const data = await fetchAnalyticsApi(accessToken, {
        metrics: "views,estimatedMinutesWatched",
        dimensions: "insightTrafficSourceType",
        startDate: dateRange.from,
        endDate: dateRange.to,
      });

      return (data.rows || []).map((row: (string | number)[]) => ({
        source: row[0] as string,
        views: row[1] as number,
        estimatedMinutesWatched: row[2] as number,
      }));
    }
  );
}

export async function getYouTubeGeoAnalytics(
  wpShowId: number,
  dateRange: DateRange
): Promise<YouTubeCountryData[]> {
  const accessToken = await requireAccessToken(wpShowId);

  return getCached(
    `analytics:youtube:${wpShowId}:geo:${dateRange.from}:${dateRange.to}`,
    21600,
    async () => {
      const data = await fetchAnalyticsApi(accessToken, {
        metrics: "views,estimatedMinutesWatched",
        dimensions: "country",
        startDate: dateRange.from,
        endDate: dateRange.to,
      });

      return (data.rows || []).map((row: (string | number)[]) => ({
        country: row[0] as string,
        views: row[1] as number,
        estimatedMinutesWatched: row[2] as number,
      }));
    }
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/__tests__/lib/analytics/youtube.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics/youtube.ts src/__tests__/lib/analytics/youtube.test.ts
git commit -m "feat(analytics): add YouTube API data fetching library"
```

---

### Task 8: Chart Components

**Files:**
- Create: `src/components/analytics/stat-card.tsx`
- Create: `src/components/analytics/charts/time-series-chart.tsx`
- Create: `src/components/analytics/charts/bar-chart.tsx`
- Create: `src/components/analytics/charts/donut-chart.tsx`
- Create: `src/components/analytics/charts/area-chart.tsx`

- [ ] **Step 1: Create StatCard**

```typescript
interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  loading?: boolean;
}

export default function StatCard({
  title,
  value,
  subtitle,
  loading,
}: StatCardProps) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">{title}</p>
      {loading ? (
        <div className="mt-1 h-8 w-24 animate-pulse rounded bg-muted" />
      ) : (
        <p className="mt-1 text-2xl font-bold">{value}</p>
      )}
      {subtitle && (
        <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create TimeSeriesChart**

```typescript
"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

interface Series {
  dataKey: string;
  name: string;
  color: string;
}

interface TimeSeriesChartProps {
  data: Record<string, unknown>[];
  xKey: string;
  series: Series[];
  height?: number;
}

export default function TimeSeriesChart({
  data,
  xKey,
  series,
  height = 300,
}: TimeSeriesChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis
          dataKey={xKey}
          tick={{ fontSize: 12 }}
          className="text-muted-foreground"
        />
        <YAxis tick={{ fontSize: 12 }} className="text-muted-foreground" />
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 8,
          }}
        />
        {series.length > 1 && <Legend />}
        {series.map((s) => (
          <Line
            key={s.dataKey}
            type="monotone"
            dataKey={s.dataKey}
            name={s.name}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 3: Create BarChart**

```typescript
"use client";

import {
  ResponsiveContainer,
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

interface Series {
  dataKey: string;
  name: string;
  color: string;
}

interface BarChartProps {
  data: Record<string, unknown>[];
  xKey: string;
  series: Series[];
  layout?: "horizontal" | "vertical";
  height?: number;
}

export default function BarChart({
  data,
  xKey,
  series,
  layout = "vertical",
  height = 300,
}: BarChartProps) {
  const isHorizontal = layout === "horizontal";

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsBarChart
        data={data}
        layout={isHorizontal ? "horizontal" : "vertical"}
      >
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        {isHorizontal ? (
          <>
            <XAxis
              type="number"
              tick={{ fontSize: 12 }}
              className="text-muted-foreground"
            />
            <YAxis
              type="category"
              dataKey={xKey}
              tick={{ fontSize: 12 }}
              className="text-muted-foreground"
              width={100}
            />
          </>
        ) : (
          <>
            <XAxis
              dataKey={xKey}
              tick={{ fontSize: 12 }}
              className="text-muted-foreground"
            />
            <YAxis
              tick={{ fontSize: 12 }}
              className="text-muted-foreground"
            />
          </>
        )}
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 8,
          }}
        />
        {series.length > 1 && <Legend />}
        {series.map((s) => (
          <Bar
            key={s.dataKey}
            dataKey={s.dataKey}
            name={s.name}
            fill={s.color}
          />
        ))}
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 4: Create DonutChart**

```typescript
"use client";

import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from "recharts";

const DEFAULT_COLORS = [
  "#6366f1", // indigo-500
  "#8b5cf6", // violet-500
  "#a855f7", // purple-500
  "#3b82f6", // blue-500
  "#06b6d4", // cyan-500
  "#14b8a6", // teal-500
  "#22c55e", // green-500
  "#eab308", // yellow-500
];

interface DonutChartProps {
  data: { name: string; value: number }[];
  height?: number;
  colors?: string[];
}

export default function DonutChart({
  data,
  height = 300,
  colors = DEFAULT_COLORS,
}: DonutChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={100}
          paddingAngle={2}
        >
          {data.map((_, index) => (
            <Cell
              key={`cell-${index}`}
              fill={colors[index % colors.length]}
            />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 8,
          }}
        />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 5: Create AreaChart**

```typescript
"use client";

import {
  ResponsiveContainer,
  AreaChart as RechartsAreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

interface Series {
  dataKey: string;
  name: string;
  color: string;
}

interface AreaChartProps {
  data: Record<string, unknown>[];
  xKey: string;
  series: Series[];
  stacked?: boolean;
  height?: number;
}

export default function AreaChart({
  data,
  xKey,
  series,
  stacked = false,
  height = 300,
}: AreaChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsAreaChart data={data}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis
          dataKey={xKey}
          tick={{ fontSize: 12 }}
          className="text-muted-foreground"
        />
        <YAxis tick={{ fontSize: 12 }} className="text-muted-foreground" />
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 8,
          }}
        />
        {series.length > 1 && <Legend />}
        {series.map((s) => (
          <Area
            key={s.dataKey}
            type="monotone"
            dataKey={s.dataKey}
            name={s.name}
            stroke={s.color}
            fill={s.color}
            fillOpacity={0.3}
            stackId={stacked ? "stack" : undefined}
          />
        ))}
      </RechartsAreaChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 6: Verify build**

```bash
npm run build 2>&1 | head -30
```

Expected: No TypeScript errors in chart components.

- [ ] **Step 7: Commit**

```bash
git add src/components/analytics/
git commit -m "feat(analytics): add chart components (line, bar, donut, area) and stat card"
```

---

### Task 9: Date Range Provider, Show Selector, and Analytics Nav

**Files:**
- Create: `src/components/analytics/date-range-provider.tsx`
- Create: `src/components/analytics/date-range-picker.tsx`
- Create: `src/components/analytics/show-selector.tsx`
- Create: `src/components/analytics/analytics-nav.tsx`

- [ ] **Step 1: Create DateRangeProvider**

```typescript
"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { getDateRange } from "@/lib/analytics/date-utils";
import type { DateRangePreset } from "@/lib/analytics/types";

interface DateRangeContextType {
  preset: DateRangePreset;
  from: string;
  to: string;
  setPreset: (preset: DateRangePreset) => void;
  setCustomRange: (from: string, to: string) => void;
}

const DateRangeContext = createContext<DateRangeContextType | null>(null);

export function useDateRange() {
  const ctx = useContext(DateRangeContext);
  if (!ctx)
    throw new Error("useDateRange must be used within DateRangeProvider");
  return ctx;
}

export default function DateRangeProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [preset, setPresetState] = useState<DateRangePreset>("30d");
  const defaultRange = getDateRange("30d");
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);

  function setPreset(p: DateRangePreset) {
    setPresetState(p);
    if (p !== "custom") {
      const range = getDateRange(p);
      setFrom(range.from);
      setTo(range.to);
    }
  }

  function setCustomRange(newFrom: string, newTo: string) {
    setPresetState("custom");
    setFrom(newFrom);
    setTo(newTo);
  }

  return (
    <DateRangeContext.Provider
      value={{ preset, from, to, setPreset, setCustomRange }}
    >
      {children}
    </DateRangeContext.Provider>
  );
}
```

- [ ] **Step 2: Create DateRangePicker**

```typescript
"use client";

import { useDateRange } from "./date-range-provider";
import type { DateRangePreset } from "@/lib/analytics/types";

const presets: { value: DateRangePreset; label: string }[] = [
  { value: "7d", label: "7 Days" },
  { value: "30d", label: "30 Days" },
  { value: "90d", label: "90 Days" },
  { value: "12m", label: "12 Months" },
];

export default function DateRangePicker() {
  const { preset, from, to, setPreset, setCustomRange } = useDateRange();

  return (
    <div className="flex items-center gap-2">
      {presets.map((p) => (
        <button
          key={p.value}
          onClick={() => setPreset(p.value)}
          className={`rounded px-3 py-1 text-xs transition-colors ${
            preset === p.value
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-accent"
          }`}
        >
          {p.label}
        </button>
      ))}

      <div className="ml-2 flex items-center gap-1">
        <input
          type="date"
          value={from}
          onChange={(e) => setCustomRange(e.target.value, to)}
          className="rounded border bg-background px-2 py-1 text-xs"
        />
        <span className="text-xs text-muted-foreground">to</span>
        <input
          type="date"
          value={to}
          onChange={(e) => setCustomRange(from, e.target.value)}
          className="rounded border bg-background px-2 py-1 text-xs"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create ShowSelector**

```typescript
"use client";

import type { AccessibleShow } from "@/lib/analytics/types";

interface ShowSelectorProps {
  shows: AccessibleShow[];
  selectedShowId: number | null;
  onChange: (wpShowId: number) => void;
}

export default function ShowSelector({
  shows,
  selectedShowId,
  onChange,
}: ShowSelectorProps) {
  if (shows.length <= 1) return null;

  return (
    <select
      value={selectedShowId ?? ""}
      onChange={(e) => onChange(Number(e.target.value))}
      className="rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
    >
      {shows.map((show) => (
        <option key={show.wpShowId} value={show.wpShowId}>
          {show.title}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 4: Create AnalyticsNav**

```typescript
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const tabs = [
  { label: "Overview", href: "/dashboard/analytics" },
  { label: "Podcasts", href: "/dashboard/analytics/podcasts" },
  { label: "YouTube", href: "/dashboard/analytics/youtube" },
  { label: "Compare", href: "/dashboard/analytics/compare" },
];

export default function AnalyticsNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 border-b">
      {tabs.map((tab) => {
        const isActive =
          tab.href === "/dashboard/analytics"
            ? pathname === tab.href
            : pathname.startsWith(tab.href);

        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              isActive
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add src/components/analytics/
git commit -m "feat(analytics): add date range, show selector, and nav components"
```

---

### Task 10: Episode and Video Tables

**Files:**
- Create: `src/components/analytics/episode-table.tsx`
- Create: `src/components/analytics/video-table.tsx`

- [ ] **Step 1: Create EpisodeTable**

```typescript
"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { TransistorEpisode } from "@/lib/analytics/types";
import { formatNumber } from "@/lib/analytics/date-utils";

type SortField = "title" | "published_at";
type SortDir = "asc" | "desc";

interface EpisodeTableProps {
  episodes: TransistorEpisode[];
  limit?: number;
}

export default function EpisodeTable({ episodes, limit }: EpisodeTableProps) {
  const [sortField, setSortField] = useState<SortField>("published_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  const sorted = useMemo(() => {
    const arr = [...episodes].sort((a, b) => {
      let aVal: string;
      let bVal: string;

      switch (sortField) {
        case "title":
          aVal = a.attributes.title.toLowerCase();
          bVal = b.attributes.title.toLowerCase();
          break;
        case "published_at":
          aVal = a.attributes.published_at || "";
          bVal = b.attributes.published_at || "";
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

    return limit ? arr.slice(0, limit) : arr;
  }, [episodes, sortField, sortDir, limit]);

  const sortIcon = (field: SortField) => {
    if (sortField !== field) return "";
    return sortDir === "asc" ? " \u2191" : " \u2193";
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th
              className="cursor-pointer px-4 py-3 hover:text-foreground"
              onClick={() => handleSort("title")}
            >
              Title{sortIcon("title")}
            </th>
            <th
              className="cursor-pointer px-4 py-3 hover:text-foreground"
              onClick={() => handleSort("published_at")}
            >
              Published{sortIcon("published_at")}
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((ep) => (
            <tr key={ep.id} className="border-b hover:bg-muted/50">
              <td className="px-4 py-3">
                <Link
                  href={`/dashboard/analytics/podcasts/episodes/${ep.id}`}
                  className="text-primary hover:underline"
                >
                  {ep.attributes.title}
                </Link>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {ep.attributes.formatted_published_at ||
                  ep.attributes.published_at}
              </td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td
                colSpan={2}
                className="py-8 text-center text-muted-foreground"
              >
                No episodes found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Create VideoTable**

```typescript
"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import type { YouTubeVideo } from "@/lib/analytics/types";
import { formatNumber } from "@/lib/analytics/date-utils";

type SortField = "title" | "publishedAt" | "viewCount";
type SortDir = "asc" | "desc";

interface VideoTableProps {
  videos: YouTubeVideo[];
  limit?: number;
}

export default function VideoTable({ videos, limit }: VideoTableProps) {
  const [sortField, setSortField] = useState<SortField>("publishedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  const sorted = useMemo(() => {
    const arr = [...videos].sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;

      switch (sortField) {
        case "title":
          aVal = a.title.toLowerCase();
          bVal = b.title.toLowerCase();
          break;
        case "publishedAt":
          aVal = a.publishedAt;
          bVal = b.publishedAt;
          break;
        case "viewCount":
          aVal = a.viewCount;
          bVal = b.viewCount;
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

    return limit ? arr.slice(0, limit) : arr;
  }, [videos, sortField, sortDir, limit]);

  const sortIcon = (field: SortField) => {
    if (sortField !== field) return "";
    return sortDir === "asc" ? " \u2191" : " \u2193";
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th className="w-12 px-4 py-3" />
            <th
              className="cursor-pointer px-4 py-3 hover:text-foreground"
              onClick={() => handleSort("title")}
            >
              Title{sortIcon("title")}
            </th>
            <th
              className="cursor-pointer px-4 py-3 hover:text-foreground"
              onClick={() => handleSort("publishedAt")}
            >
              Published{sortIcon("publishedAt")}
            </th>
            <th
              className="cursor-pointer px-4 py-3 text-right hover:text-foreground"
              onClick={() => handleSort("viewCount")}
            >
              Views{sortIcon("viewCount")}
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((video) => (
            <tr key={video.id} className="border-b hover:bg-muted/50">
              <td className="px-4 py-3">
                {video.thumbnailUrl && (
                  <Image
                    src={video.thumbnailUrl}
                    alt=""
                    width={64}
                    height={36}
                    className="rounded object-cover"
                  />
                )}
              </td>
              <td className="px-4 py-3">
                <Link
                  href={`/dashboard/analytics/youtube/videos/${video.id}`}
                  className="text-primary hover:underline"
                >
                  {video.title}
                </Link>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {new Date(video.publishedAt).toLocaleDateString()}
              </td>
              <td className="px-4 py-3 text-right">
                {formatNumber(video.viewCount)}
              </td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td
                colSpan={4}
                className="py-8 text-center text-muted-foreground"
              >
                No videos found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/analytics/episode-table.tsx src/components/analytics/video-table.tsx
git commit -m "feat(analytics): add episode and video table components"
```

---

### Task 11: Analytics Layout and Show Access Helper

**Files:**
- Create: `src/app/dashboard/analytics/layout.tsx`
- Create: `src/lib/analytics/access.ts`

- [ ] **Step 1: Create the access helper**

```typescript
import "server-only";
import { db } from "@/lib/db";
import { getShows } from "@/lib/wordpress/shows";
import type { AccessibleShow } from "./types";

/**
 * Get the list of shows a user can access for analytics.
 * Admins see all shows. Producers see only their assigned shows.
 */
export async function getAccessibleShows(
  userId: string,
  role: string
): Promise<AccessibleShow[]> {
  // Get all WP shows for title lookups
  const wpShows = await getShows();

  if (role === "admin") {
    return wpShows.map((s) => ({
      wpShowId: s.id,
      title: s.title.rendered,
    }));
  }

  // Producer: filter by UserShowAccess
  const accessEntries = await db.userShowAccess.findMany({
    where: { userId },
  });

  const allowedIds = new Set(accessEntries.map((a) => a.wpShowId));

  return wpShows
    .filter((s) => allowedIds.has(s.id))
    .map((s) => ({
      wpShowId: s.id,
      title: s.title.rendered,
    }));
}
```

Note: This file imports `getShows` from `src/lib/wordpress/shows`. Before writing this file, verify this function exists and its return shape. Check with:

```bash
grep -n "export.*function getShows\|export.*async function getShows" src/lib/wordpress/*.ts
```

If the function doesn't exist or returns a different shape, adapt accordingly. The key fields needed are `id` (number) and `title.rendered` (string) from each WordPress show.

- [ ] **Step 2: Create the analytics layout**

```typescript
import { requireAuth } from "@/lib/auth-guard";
import { getAccessibleShows } from "@/lib/analytics/access";
import AnalyticsNav from "@/components/analytics/analytics-nav";
import DateRangeProvider from "@/components/analytics/date-range-provider";
import DateRangePicker from "@/components/analytics/date-range-picker";

export default async function AnalyticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireAuth();
  const shows = await getAccessibleShows(
    session.user.id,
    session.user.role
  );

  return (
    <DateRangeProvider>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Analytics</h1>
          <DateRangePicker />
        </div>
        <AnalyticsNav />
        {children}
      </div>
    </DateRangeProvider>
  );
}
```

Note: The `shows` data is fetched here but will be passed to pages via a different mechanism (search params for selected show, and the ShowSelector component fetches its own data client-side via a server action). We'll wire this up in subsequent tasks.

- [ ] **Step 3: Verify the layout renders**

```bash
npm run build 2>&1 | tail -20
```

Expected: No errors related to the analytics layout.

- [ ] **Step 4: Commit**

```bash
git add src/lib/analytics/access.ts src/app/dashboard/analytics/layout.tsx
git commit -m "feat(analytics): add analytics layout with auth guard and date range"
```

---

### Task 12: Add Analytics to Sidebar

**Files:**
- Modify: `src/components/sidebar.tsx`

- [ ] **Step 1: Add Analytics nav item to the sidebar**

In `src/components/sidebar.tsx`, add "Analytics" between the content type links and the distribution link. Modify the `navItems` array construction:

```typescript
const navItems = [
  { label: "Dashboard", href: "/dashboard" },
  ...visibleContentTypes.map((type) => ({
    label:
      CONTENT_TYPE_LABELS[type as keyof typeof CONTENT_TYPE_LABELS] ?? type,
    href: `/dashboard/${type.replace("_", "-")}`,
  })),
  { label: "Analytics", href: "/dashboard/analytics" },
  ...(session?.user?.hasDistributionAccess
    ? [{ label: "Episode Distribution", href: "/dashboard/distribute" }]
    : []),
  { label: "Settings", href: "/settings" },
];
```

Also update the active state check in the Link className to handle nested analytics routes:

```typescript
pathname === item.href || pathname.startsWith(item.href + "/")
```

But be careful — this would also match `/dashboard` for everything. Use a more specific check:

```typescript
const isActive =
  item.href === "/dashboard"
    ? pathname === "/dashboard"
    : pathname === item.href || pathname.startsWith(item.href + "/");
```

- [ ] **Step 2: Verify sidebar renders with Analytics link**

```bash
npm run dev &
sleep 3
curl -s http://localhost:3000/dashboard | grep -o "Analytics" | head -1
kill %1
```

Expected: "Analytics" appears in the output.

- [ ] **Step 3: Commit**

```bash
git add src/components/sidebar.tsx
git commit -m "feat(analytics): add Analytics link to dashboard sidebar"
```

---

### Task 13: Analytics Overview Page

**Files:**
- Create: `src/app/dashboard/analytics/page.tsx`

- [ ] **Step 1: Create the overview page**

This page shows aggregated stats across the user's accessible shows. It's a client component that fetches data based on the selected show and date range.

```typescript
"use client";

import { useState, useEffect, useCallback } from "react";
import { useDateRange } from "@/components/analytics/date-range-provider";
import ShowSelector from "@/components/analytics/show-selector";
import StatCard from "@/components/analytics/stat-card";
import TimeSeriesChart from "@/components/analytics/charts/time-series-chart";
import EpisodeTable from "@/components/analytics/episode-table";
import VideoTable from "@/components/analytics/video-table";
import { formatNumber } from "@/lib/analytics/date-utils";
import type {
  AccessibleShow,
  TransistorAnalyticsPoint,
  TransistorEpisode,
  YouTubeVideo,
  YouTubeAnalyticsPoint,
} from "@/lib/analytics/types";

// Server action imports will be added — for now we use fetch to API routes
// We'll create a server actions file for analytics data fetching

export default function AnalyticsOverviewPage() {
  // This page will be implemented as part of the server actions wiring in Task 14
  return (
    <div className="space-y-6">
      <p className="text-muted-foreground">
        Analytics overview — coming in next task.
      </p>
    </div>
  );
}
```

Note: This is a placeholder. Task 14 adds server actions that this page will consume.

- [ ] **Step 2: Verify the page is accessible**

```bash
npm run build 2>&1 | tail -10
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/analytics/page.tsx
git commit -m "feat(analytics): add placeholder overview page"
```

---

### Task 14: Server Actions for Analytics Data

**Files:**
- Create: `src/app/dashboard/analytics/actions.ts`

- [ ] **Step 1: Create server actions for analytics data fetching**

```typescript
"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAccessibleShows } from "@/lib/analytics/access";
import {
  getTransistorEpisodes,
  getTransistorShowAnalytics,
  getTransistorEpisodeAnalytics,
  getTransistorCountryAnalytics,
  getTransistorAppAnalytics,
  getTransistorDeviceAnalytics,
} from "@/lib/analytics/transistor";
import {
  getYouTubeChannelStats,
  getYouTubeVideos,
  getYouTubeChannelAnalytics,
  getYouTubeVideoAnalytics,
  getYouTubeTrafficSources,
  getYouTubeGeoAnalytics,
} from "@/lib/analytics/youtube";
import { bustCachePrefix } from "@/lib/analytics/cache";
import type {
  AccessibleShow,
  DateRange,
  TransistorAnalyticsPoint,
  TransistorEpisode,
  TransistorCountryData,
  TransistorAppData,
  TransistorDeviceData,
  YouTubeChannelStats,
  YouTubeVideo,
  YouTubeAnalyticsPoint,
  YouTubeTrafficSource,
  YouTubeCountryData,
} from "@/lib/analytics/types";

async function requireShowAccess(wpShowId: number): Promise<void> {
  const session = await auth();
  if (!session?.user) throw new Error("Not authenticated");
  if (session.user.role === "admin") return;

  const access = await db.userShowAccess.findUnique({
    where: { userId_wpShowId: { userId: session.user.id, wpShowId } },
  });
  if (!access) throw new Error("Access denied");
}

export async function fetchAccessibleShows(): Promise<AccessibleShow[]> {
  const session = await auth();
  if (!session?.user) return [];
  return getAccessibleShows(session.user.id, session.user.role);
}

// --- Transistor actions ---

export async function fetchPodcastEpisodes(
  wpShowId: number
): Promise<TransistorEpisode[]> {
  await requireShowAccess(wpShowId);
  return getTransistorEpisodes(wpShowId);
}

export async function fetchPodcastAnalytics(
  wpShowId: number,
  dateRange: DateRange
): Promise<TransistorAnalyticsPoint[]> {
  await requireShowAccess(wpShowId);
  return getTransistorShowAnalytics(wpShowId, dateRange);
}

export async function fetchEpisodeAnalytics(
  wpShowId: number,
  episodeId: string,
  dateRange: DateRange
): Promise<TransistorAnalyticsPoint[]> {
  await requireShowAccess(wpShowId);
  return getTransistorEpisodeAnalytics(wpShowId, episodeId, dateRange);
}

export async function fetchPodcastCountries(
  wpShowId: number
): Promise<TransistorCountryData[]> {
  await requireShowAccess(wpShowId);
  return getTransistorCountryAnalytics(wpShowId);
}

export async function fetchPodcastApps(
  wpShowId: number
): Promise<TransistorAppData[]> {
  await requireShowAccess(wpShowId);
  return getTransistorAppAnalytics(wpShowId);
}

export async function fetchPodcastDevices(
  wpShowId: number
): Promise<TransistorDeviceData[]> {
  await requireShowAccess(wpShowId);
  return getTransistorDeviceAnalytics(wpShowId);
}

// --- YouTube actions ---

export async function fetchYouTubeChannel(
  wpShowId: number
): Promise<YouTubeChannelStats> {
  await requireShowAccess(wpShowId);
  return getYouTubeChannelStats(wpShowId);
}

export async function fetchYouTubeVideos(
  wpShowId: number
): Promise<YouTubeVideo[]> {
  await requireShowAccess(wpShowId);
  return getYouTubeVideos(wpShowId);
}

export async function fetchYouTubeAnalytics(
  wpShowId: number,
  dateRange: DateRange
): Promise<YouTubeAnalyticsPoint[]> {
  await requireShowAccess(wpShowId);
  return getYouTubeChannelAnalytics(wpShowId, dateRange);
}

export async function fetchYouTubeVideoAnalytics(
  wpShowId: number,
  videoId: string,
  dateRange: DateRange
): Promise<YouTubeAnalyticsPoint[]> {
  await requireShowAccess(wpShowId);
  return getYouTubeVideoAnalytics(wpShowId, videoId, dateRange);
}

export async function fetchYouTubeTraffic(
  wpShowId: number,
  dateRange: DateRange
): Promise<YouTubeTrafficSource[]> {
  await requireShowAccess(wpShowId);
  return getYouTubeTrafficSources(wpShowId, dateRange);
}

export async function fetchYouTubeGeo(
  wpShowId: number,
  dateRange: DateRange
): Promise<YouTubeCountryData[]> {
  await requireShowAccess(wpShowId);
  return getYouTubeGeoAnalytics(wpShowId, dateRange);
}

// --- Cache management ---

export async function refreshAnalyticsCache(
  wpShowId: number
): Promise<void> {
  await requireShowAccess(wpShowId);
  await bustCachePrefix(`analytics:transistor:${wpShowId}`);
  await bustCachePrefix(`analytics:youtube:${wpShowId}`);
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -10
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/analytics/actions.ts
git commit -m "feat(analytics): add server actions for analytics data fetching"
```

---

### Task 15: Complete Overview Page

**Files:**
- Modify: `src/app/dashboard/analytics/page.tsx`

- [ ] **Step 1: Replace the placeholder with the full implementation**

Read the current file first, then replace its entire content with the full overview page that uses the server actions from Task 14. The overview page fetches podcast downloads and YouTube views/watch hours for the selected show and renders stat cards, time series charts, and top episode/video tables.

The full implementation should follow the pattern from the original analytics dashboard's `src/app/page.tsx`, adapted to use:
- `useDateRange()` from the portal's date range provider
- Server actions (`fetchAccessibleShows`, `fetchPodcastAnalytics`, `fetchPodcastEpisodes`, `fetchYouTubeChannel`, `fetchYouTubeVideos`, `fetchYouTubeAnalytics`, `refreshAnalyticsCache`) instead of fetch calls to API routes
- Portal UI classes (Tailwind semantic tokens like `bg-card`, `border`, `text-muted-foreground`) instead of `swm-*` classes
- `ShowSelector` receiving `AccessibleShow[]` (wpShowId-based) instead of `TransistorShow[]`
- Links to `/dashboard/analytics/podcasts/episodes/[id]` and `/dashboard/analytics/youtube/videos/[id]`

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -10
```

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/analytics/page.tsx
git commit -m "feat(analytics): implement analytics overview page"
```

---

### Task 16: Podcast Analytics Page

**Files:**
- Create: `src/app/dashboard/analytics/podcasts/page.tsx`

- [ ] **Step 1: Create the podcasts page**

Port the content from the original `src/app/podcasts/page.tsx`, adapted to use:
- Server actions (`fetchAccessibleShows`, `fetchPodcastAnalytics`, `fetchPodcastEpisodes`, `fetchPodcastCountries`, `fetchPodcastApps`, `fetchPodcastDevices`)
- `useDateRange()` from the portal's provider
- `ShowSelector` with `AccessibleShow[]`
- Portal UI classes and chart components from `src/components/analytics/`
- Links to `/dashboard/analytics/podcasts/episodes/[id]`

The page shows: stat cards (total downloads, avg per episode, episodes published), downloads time series, listening platforms bar chart, top countries bar chart, devices donut chart, and episode table.

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -10
```

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/analytics/podcasts/page.tsx
git commit -m "feat(analytics): implement podcast analytics page"
```

---

### Task 17: Episode Detail Page

**Files:**
- Create: `src/app/dashboard/analytics/podcasts/episodes/[id]/page.tsx`

- [ ] **Step 1: Create the episode detail page**

Port from original `src/app/podcasts/episodes/[id]/page.tsx`, adapted to use:
- Server action `fetchEpisodeAnalytics(wpShowId, episodeId, dateRange)`
- `useDateRange()` from the portal's provider
- Portal UI classes and TimeSeriesChart component
- The `wpShowId` should be passed via search params (e.g., `?show=5`)
- Shows: stat card for total downloads, downloads over time chart
- Back link to `/dashboard/analytics/podcasts`

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -10
```

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/analytics/podcasts/episodes/
git commit -m "feat(analytics): implement episode detail analytics page"
```

---

### Task 18: YouTube Analytics Page

**Files:**
- Create: `src/app/dashboard/analytics/youtube/page.tsx`

- [ ] **Step 1: Create the YouTube analytics page**

Port from original `src/app/youtube/page.tsx`, adapted to use:
- Server actions (`fetchAccessibleShows`, `fetchYouTubeChannel`, `fetchYouTubeVideos`, `fetchYouTubeAnalytics`, `fetchYouTubeTraffic`, `fetchYouTubeGeo`)
- `useDateRange()` from the portal's provider
- `ShowSelector` with `AccessibleShow[]`
- Portal UI classes and chart components
- Links to `/dashboard/analytics/youtube/videos/[id]`

The page shows: stat cards (subscribers, subs gained/lost, views, watch hours, avg view duration), views time series, watch time time series, traffic sources donut, countries bar chart, subscribers gained vs lost area chart, and video table.

Include the "Data may be 48-72 hours delayed" note.

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -10
```

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/analytics/youtube/page.tsx
git commit -m "feat(analytics): implement YouTube analytics page"
```

---

### Task 19: Video Detail Page

**Files:**
- Create: `src/app/dashboard/analytics/youtube/videos/[id]/page.tsx`

- [ ] **Step 1: Create the video detail page**

Port from original `src/app/youtube/videos/[id]/page.tsx`, adapted to use:
- Server action `fetchYouTubeVideoAnalytics(wpShowId, videoId, dateRange)`
- `useDateRange()` from the portal's provider
- Portal UI classes and TimeSeriesChart component
- The `wpShowId` should be passed via search params (e.g., `?show=5`)
- Shows: stat cards (views, watch hours, avg view duration), views time series
- "View on YouTube" external link
- Back link to `/dashboard/analytics/youtube`

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -10
```

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/analytics/youtube/videos/
git commit -m "feat(analytics): implement video detail analytics page"
```

---

### Task 20: Compare Page

**Files:**
- Create: `src/app/dashboard/analytics/compare/page.tsx`

- [ ] **Step 1: Create the compare page**

Port from original `src/app/compare/page.tsx`, adapted to use:
- Server actions (`fetchAccessibleShows`, `fetchPodcastAnalytics`, `fetchPodcastEpisodes`)
- `useDateRange()` from the portal's provider
- Portal UI classes and chart components (BarChart, AreaChart)
- Only compare shows the user has access to (from `fetchAccessibleShows`)

The page shows: total downloads by show bar chart, stacked area downloads over time, and a summary table (show, total downloads, episodes, avg per episode).

Use colors array for show differentiation:
```typescript
const SHOW_COLORS = [
  "#6366f1", "#8b5cf6", "#a855f7", "#3b82f6",
  "#06b6d4", "#14b8a6", "#22c55e", "#eab308",
];
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -10
```

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/analytics/compare/page.tsx
git commit -m "feat(analytics): implement show comparison page"
```

---

### Task 21: Final Build Verification and Cleanup

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: All tests pass, including new analytics tests.

- [ ] **Step 2: Run production build**

```bash
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

Expected: No lint errors.

- [ ] **Step 4: Manual smoke test**

Start the dev server and verify:
1. Analytics link appears in sidebar
2. Overview page loads (may show "no credentials configured" without API keys — that's expected)
3. Podcasts, YouTube, and Compare tabs navigate correctly
4. Date range picker changes persist across tab navigation

```bash
npm run dev
```

- [ ] **Step 5: Commit any final fixes**

```bash
git add -A
git commit -m "feat(analytics): final build verification and cleanup"
```
