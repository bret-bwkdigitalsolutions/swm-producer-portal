# Network-Level Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin-only network-level analytics views that aggregate Transistor data across shows and display channel-level YouTube data, with YouTube gating at the show level for multi-show networks.

**Architecture:** Static network config maps slugs to member shows and credential sources. A new `/dashboard/analytics/network/[slug]` route serves a combined overview page. The existing analytics landing page branches by role — admins see a network picker, producers see the current show selector. Show-level YouTube is hidden for multi-show network members with a banner.

**Tech Stack:** Next.js App Router, Server Actions, Recharts (existing), Vitest

---

### Task 1: Network Config Module

**Files:**
- Create: `src/lib/analytics/networks.ts`
- Create: `tests/lib/analytics/networks.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import {
  NETWORKS,
  getNetworkBySlug,
  getNetworksForRole,
  getNetworkForShow,
  showHasOwnYouTube,
} from "@/lib/analytics/networks";

describe("NETWORKS config", () => {
  it("has two networks defined", () => {
    expect(NETWORKS).toHaveLength(2);
  });

  it("each network has required fields", () => {
    for (const network of NETWORKS) {
      expect(network.slug).toBeTruthy();
      expect(network.name).toBeTruthy();
      expect(network.wpShowIds.length).toBeGreaterThan(0);
      expect(typeof network.credentialWpShowId).toBe("number");
    }
  });
});

describe("getNetworkBySlug", () => {
  it("returns the network for a valid slug", () => {
    const network = getNetworkBySlug("sunset-lounge-dfw");
    expect(network).toBeDefined();
    expect(network!.name).toBe("Sunset Lounge DFW");
  });

  it("returns undefined for an invalid slug", () => {
    expect(getNetworkBySlug("nonexistent")).toBeUndefined();
  });
});

describe("getNetworksForRole", () => {
  it("returns all networks for admin role", () => {
    expect(getNetworksForRole("admin")).toEqual(NETWORKS);
  });

  it("returns empty array for producer role", () => {
    expect(getNetworksForRole("producer")).toEqual([]);
  });
});

describe("getNetworkForShow", () => {
  it("returns the network containing the given wpShowId", () => {
    const sunsetShowId = NETWORKS[0].wpShowIds[0];
    const network = getNetworkForShow(sunsetShowId);
    expect(network).toBeDefined();
    expect(network!.slug).toBe("sunset-lounge-dfw");
  });

  it("returns undefined for a wpShowId not in any network", () => {
    expect(getNetworkForShow(99999)).toBeUndefined();
  });
});

describe("showHasOwnYouTube", () => {
  it("returns false for a show in a multi-show network", () => {
    const sunsetShowId = NETWORKS[0].wpShowIds[0];
    expect(showHasOwnYouTube(sunsetShowId)).toBe(false);
  });

  it("returns true for a show in a single-show network", () => {
    const ydcShowId = NETWORKS[1].wpShowIds[0];
    expect(showHasOwnYouTube(ydcShowId)).toBe(true);
  });

  it("returns true for a wpShowId not in any network", () => {
    expect(showHasOwnYouTube(99999)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/analytics/networks.test.ts`
Expected: FAIL — module `@/lib/analytics/networks` not found

- [ ] **Step 3: Write the implementation**

```ts
export interface Network {
  slug: string;
  name: string;
  wpShowIds: number[];
  credentialWpShowId: number;
}

// NOTE: The actual wpShowIds must be populated from the WordPress show IDs.
// Check the database (prisma studio or the WP API) for the real IDs before shipping.
export const NETWORKS: Network[] = [
  {
    slug: "sunset-lounge-dfw",
    name: "Sunset Lounge DFW",
    wpShowIds: [], // TODO: populate with real WP show IDs during implementation
    credentialWpShowId: 0,
  },
  {
    slug: "your-dark-companion",
    name: "Your Dark Companion",
    wpShowIds: [], // TODO: populate with real WP show ID during implementation
    credentialWpShowId: 0, // TODO: set to YDC's wpShowId during implementation
  },
];

export function getNetworkBySlug(slug: string): Network | undefined {
  return NETWORKS.find((n) => n.slug === slug);
}

export function getNetworksForRole(role: string): Network[] {
  return role === "admin" ? NETWORKS : [];
}

export function getNetworkForShow(wpShowId: number): Network | undefined {
  return NETWORKS.find((n) => n.wpShowIds.includes(wpShowId));
}

export function showHasOwnYouTube(wpShowId: number): boolean {
  const network = getNetworkForShow(wpShowId);
  if (!network) return true;
  return network.wpShowIds.length === 1;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/analytics/networks.test.ts`
Expected: PASS (all 8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics/networks.ts tests/lib/analytics/networks.test.ts
git commit -m "feat(analytics): add network config module with helpers"
```

---

### Task 2: Network Server Actions

**Files:**
- Create: `src/app/dashboard/analytics/network/actions.ts`
- Create: `tests/app/analytics/network-actions.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/analytics/networks", () => ({
  getNetworkBySlug: vi.fn(),
}));

vi.mock("@/lib/analytics/transistor", () => ({
  getTransistorShowAnalytics: vi.fn(),
  getTransistorEpisodes: vi.fn(),
}));

vi.mock("@/lib/analytics/youtube", () => ({
  getYouTubeChannelStats: vi.fn(),
  getYouTubeChannelAnalytics: vi.fn(),
  getYouTubeVideos: vi.fn(),
}));

vi.mock("@/lib/analytics/cache", () => ({
  bustCachePrefix: vi.fn(),
}));

import { auth } from "@/lib/auth";
import { getNetworkBySlug } from "@/lib/analytics/networks";
import { getTransistorShowAnalytics, getTransistorEpisodes } from "@/lib/analytics/transistor";
import { getYouTubeChannelStats, getYouTubeChannelAnalytics, getYouTubeVideos } from "@/lib/analytics/youtube";
import {
  fetchNetworkPodcastAnalytics,
  fetchNetworkShowBreakdown,
  fetchNetworkYouTubeChannel,
} from "@/app/dashboard/analytics/network/actions";

beforeEach(() => {
  vi.clearAllMocks();
});

const adminSession = { user: { id: "1", role: "admin" } };
const producerSession = { user: { id: "2", role: "producer" } };
const testNetwork = {
  slug: "sunset-lounge-dfw",
  name: "Sunset Lounge DFW",
  wpShowIds: [1, 2],
  credentialWpShowId: 0,
};

describe("fetchNetworkPodcastAnalytics", () => {
  it("aggregates downloads across member shows by date", async () => {
    vi.mocked(auth).mockResolvedValue(adminSession as any);
    vi.mocked(getNetworkBySlug).mockReturnValue(testNetwork);
    vi.mocked(getTransistorShowAnalytics)
      .mockResolvedValueOnce([
        { date: "2026-03-01", downloads: 100 },
        { date: "2026-03-02", downloads: 50 },
      ])
      .mockResolvedValueOnce([
        { date: "2026-03-01", downloads: 200 },
        { date: "2026-03-02", downloads: 75 },
      ]);

    const result = await fetchNetworkPodcastAnalytics("sunset-lounge-dfw", {
      from: "2026-03-01",
      to: "2026-03-02",
    });

    expect(result).toEqual([
      { date: "2026-03-01", downloads: 300 },
      { date: "2026-03-02", downloads: 125 },
    ]);
  });

  it("throws for non-admin users", async () => {
    vi.mocked(auth).mockResolvedValue(producerSession as any);

    await expect(
      fetchNetworkPodcastAnalytics("sunset-lounge-dfw", {
        from: "2026-03-01",
        to: "2026-03-02",
      })
    ).rejects.toThrow();
  });

  it("throws for invalid network slug", async () => {
    vi.mocked(auth).mockResolvedValue(adminSession as any);
    vi.mocked(getNetworkBySlug).mockReturnValue(undefined);

    await expect(
      fetchNetworkPodcastAnalytics("nonexistent", {
        from: "2026-03-01",
        to: "2026-03-02",
      })
    ).rejects.toThrow("Network not found");
  });
});

describe("fetchNetworkShowBreakdown", () => {
  it("returns per-show download totals and episode counts", async () => {
    vi.mocked(auth).mockResolvedValue(adminSession as any);
    vi.mocked(getNetworkBySlug).mockReturnValue(testNetwork);
    vi.mocked(getTransistorShowAnalytics).mockResolvedValue([
      { date: "2026-03-01", downloads: 100 },
    ]);
    vi.mocked(getTransistorEpisodes).mockResolvedValue([
      { id: "1", type: "episode", attributes: { title: "Ep1", summary: "", published_at: "", duration: 0, number: 1, status: "published", share_url: "", media_url: "", image_url: "", formatted_published_at: "" } },
    ]);

    const result = await fetchNetworkShowBreakdown("sunset-lounge-dfw", {
      from: "2026-03-01",
      to: "2026-03-02",
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      wpShowId: expect.any(Number),
      totalDownloads: 100,
      episodeCount: 1,
    });
  });
});

describe("fetchNetworkYouTubeChannel", () => {
  it("fetches channel stats using network credentialWpShowId", async () => {
    vi.mocked(auth).mockResolvedValue(adminSession as any);
    vi.mocked(getNetworkBySlug).mockReturnValue(testNetwork);
    vi.mocked(getYouTubeChannelStats).mockResolvedValue({
      subscriberCount: 1000,
      viewCount: 50000,
      videoCount: 100,
    });

    const result = await fetchNetworkYouTubeChannel("sunset-lounge-dfw");

    expect(result).toEqual({
      subscriberCount: 1000,
      viewCount: 50000,
      videoCount: 100,
    });
    expect(getYouTubeChannelStats).toHaveBeenCalledWith(0); // credentialWpShowId
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/app/analytics/network-actions.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `src/app/dashboard/analytics/network/actions.ts`:

```ts
"use server";

import { auth } from "@/lib/auth";
import { getNetworkBySlug } from "@/lib/analytics/networks";
import {
  getTransistorShowAnalytics,
  getTransistorEpisodes,
} from "@/lib/analytics/transistor";
import {
  getYouTubeChannelStats,
  getYouTubeVideos,
  getYouTubeChannelAnalytics,
} from "@/lib/analytics/youtube";
import { bustCachePrefix } from "@/lib/analytics/cache";
import type {
  DateRange,
  TransistorAnalyticsPoint,
  TransistorEpisode,
  YouTubeChannelStats,
  YouTubeVideo,
  YouTubeAnalyticsPoint,
} from "@/lib/analytics/types";

export interface NetworkShowBreakdown {
  wpShowId: number;
  totalDownloads: number;
  episodeCount: number;
}

async function requireAdminForNetwork(slug: string) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    throw new Error("Admin access required");
  }
  const network = getNetworkBySlug(slug);
  if (!network) {
    throw new Error("Network not found");
  }
  return network;
}

export async function fetchNetworkPodcastAnalytics(
  slug: string,
  dateRange: DateRange
): Promise<TransistorAnalyticsPoint[]> {
  const network = await requireAdminForNetwork(slug);

  const allShowData = await Promise.allSettled(
    network.wpShowIds.map((id) => getTransistorShowAnalytics(id, dateRange))
  );

  const dateMap = new Map<string, number>();
  for (const result of allShowData) {
    if (result.status !== "fulfilled") continue;
    for (const point of result.value) {
      dateMap.set(point.date, (dateMap.get(point.date) ?? 0) + point.downloads);
    }
  }

  return Array.from(dateMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, downloads]) => ({ date, downloads }));
}

export async function fetchNetworkPodcastEpisodes(
  slug: string
): Promise<TransistorEpisode[]> {
  const network = await requireAdminForNetwork(slug);

  const allEpisodes = await Promise.allSettled(
    network.wpShowIds.map((id) => getTransistorEpisodes(id))
  );

  const merged: TransistorEpisode[] = [];
  for (const result of allEpisodes) {
    if (result.status === "fulfilled") {
      merged.push(...result.value);
    }
  }

  return merged.sort(
    (a, b) =>
      new Date(b.attributes.published_at).getTime() -
      new Date(a.attributes.published_at).getTime()
  );
}

export async function fetchNetworkShowBreakdown(
  slug: string,
  dateRange: DateRange
): Promise<NetworkShowBreakdown[]> {
  const network = await requireAdminForNetwork(slug);

  const results = await Promise.all(
    network.wpShowIds.map(async (wpShowId) => {
      const [analytics, episodes] = await Promise.allSettled([
        getTransistorShowAnalytics(wpShowId, dateRange),
        getTransistorEpisodes(wpShowId),
      ]);

      const totalDownloads =
        analytics.status === "fulfilled"
          ? analytics.value.reduce((sum, p) => sum + p.downloads, 0)
          : 0;
      const episodeCount =
        episodes.status === "fulfilled" ? episodes.value.length : 0;

      return { wpShowId, totalDownloads, episodeCount };
    })
  );

  return results.sort((a, b) => b.totalDownloads - a.totalDownloads);
}

export async function fetchNetworkYouTubeChannel(
  slug: string
): Promise<YouTubeChannelStats> {
  const network = await requireAdminForNetwork(slug);
  return getYouTubeChannelStats(network.credentialWpShowId);
}

export async function fetchNetworkYouTubeVideos(
  slug: string
): Promise<YouTubeVideo[]> {
  const network = await requireAdminForNetwork(slug);
  return getYouTubeVideos(network.credentialWpShowId);
}

export async function fetchNetworkYouTubeAnalytics(
  slug: string,
  dateRange: DateRange
): Promise<YouTubeAnalyticsPoint[]> {
  const network = await requireAdminForNetwork(slug);
  return getYouTubeChannelAnalytics(network.credentialWpShowId, dateRange);
}

export async function refreshNetworkAnalyticsCache(
  slug: string
): Promise<void> {
  const network = await requireAdminForNetwork(slug);
  const busts = network.wpShowIds.map((id) =>
    bustCachePrefix(`analytics:transistor:${id}`)
  );
  busts.push(bustCachePrefix(`analytics:youtube:${network.credentialWpShowId}`));
  await Promise.all(busts);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/app/analytics/network-actions.test.ts`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/analytics/network/actions.ts tests/app/analytics/network-actions.test.ts
git commit -m "feat(analytics): add network-level server actions"
```

---

### Task 3: YouTube Banner Component

**Files:**
- Create: `src/components/analytics/youtube-network-banner.tsx`

- [ ] **Step 1: Create the banner component**

```tsx
import Link from "next/link";
import { getNetworkForShow } from "@/lib/analytics/networks";

interface YouTubeNetworkBannerProps {
  wpShowId: number;
  isAdmin: boolean;
}

export default function YouTubeNetworkBanner({
  wpShowId,
  isAdmin,
}: YouTubeNetworkBannerProps) {
  const network = getNetworkForShow(wpShowId);
  if (!network) return null;

  const networkUrl = `/dashboard/analytics/network/${network.slug}`;

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950">
      <p className="text-sm text-blue-800 dark:text-blue-200">
        YouTube analytics for {network.name} shows are available at the network
        level, since all shows share one channel.
        {isAdmin && (
          <>
            {" "}
            <Link href={networkUrl} className="font-medium underline">
              View network analytics
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/analytics/youtube-network-banner.tsx
git commit -m "feat(analytics): add YouTube network banner component"
```

---

### Task 4: Network Picker Component

**Files:**
- Create: `src/components/analytics/network-picker.tsx`

- [ ] **Step 1: Create the network picker component**

```tsx
import Link from "next/link";
import type { Network } from "@/lib/analytics/networks";

interface NetworkPickerProps {
  networks: Network[];
}

export default function NetworkPicker({ networks }: NetworkPickerProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {networks.map((network) => (
        <Link
          key={network.slug}
          href={`/dashboard/analytics/network/${network.slug}`}
          className="group rounded-lg border bg-card p-6 transition-colors hover:bg-muted"
        >
          <h3 className="text-lg font-semibold group-hover:text-primary">
            {network.name}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {network.wpShowIds.length}{" "}
            {network.wpShowIds.length === 1 ? "show" : "shows"}
          </p>
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/analytics/network-picker.tsx
git commit -m "feat(analytics): add network picker component"
```

---

### Task 5: Show Breakdown Table Component

**Files:**
- Create: `src/components/analytics/show-breakdown-table.tsx`

- [ ] **Step 1: Create the show breakdown table**

```tsx
import Link from "next/link";
import { formatNumber } from "@/lib/analytics/date-utils";
import type { NetworkShowBreakdown } from "@/app/dashboard/analytics/network/actions";
import type { AccessibleShow } from "@/lib/analytics/types";

interface ShowBreakdownTableProps {
  breakdown: NetworkShowBreakdown[];
  shows: AccessibleShow[];
}

export default function ShowBreakdownTable({
  breakdown,
  shows,
}: ShowBreakdownTableProps) {
  const showTitleMap = new Map(shows.map((s) => [s.wpShowId, s.title]));

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th className="px-4 py-3 font-medium">Show</th>
            <th className="px-4 py-3 font-medium">Downloads</th>
            <th className="px-4 py-3 font-medium">Episodes</th>
          </tr>
        </thead>
        <tbody>
          {breakdown.map((row) => (
            <tr key={row.wpShowId} className="border-b hover:bg-muted/50">
              <td className="px-4 py-3">
                <Link
                  href={`/dashboard/analytics?show=${row.wpShowId}`}
                  className="text-primary hover:underline"
                >
                  {showTitleMap.get(row.wpShowId) ?? `Show #${row.wpShowId}`}
                </Link>
              </td>
              <td className="px-4 py-3">{formatNumber(row.totalDownloads)}</td>
              <td className="px-4 py-3">{formatNumber(row.episodeCount)}</td>
            </tr>
          ))}
          {breakdown.length === 0 && (
            <tr>
              <td
                colSpan={3}
                className="py-8 text-center text-muted-foreground"
              >
                No show data available.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/analytics/show-breakdown-table.tsx
git commit -m "feat(analytics): add show breakdown table component"
```

---

### Task 6: Network Overview Page

**Files:**
- Create: `src/app/dashboard/analytics/network/[slug]/page.tsx`

- [ ] **Step 1: Create the network overview page**

```tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useDateRange } from "@/components/analytics/date-range-provider";
import StatCard from "@/components/analytics/stat-card";
import TimeSeriesChart from "@/components/analytics/charts/time-series-chart";
import EpisodeTable from "@/components/analytics/episode-table";
import VideoTable from "@/components/analytics/video-table";
import ShowBreakdownTable from "@/components/analytics/show-breakdown-table";
import { formatNumber } from "@/lib/analytics/date-utils";
import { getNetworkBySlug } from "@/lib/analytics/networks";
import { fetchAccessibleShows } from "@/app/dashboard/analytics/actions";
import {
  fetchNetworkPodcastAnalytics,
  fetchNetworkPodcastEpisodes,
  fetchNetworkShowBreakdown,
  fetchNetworkYouTubeChannel,
  fetchNetworkYouTubeVideos,
  fetchNetworkYouTubeAnalytics,
  refreshNetworkAnalyticsCache,
} from "@/app/dashboard/analytics/network/actions";
import type {
  AccessibleShow,
  TransistorAnalyticsPoint,
  TransistorEpisode,
  YouTubeChannelStats,
  YouTubeVideo,
  YouTubeAnalyticsPoint,
} from "@/lib/analytics/types";
import type { NetworkShowBreakdown } from "@/app/dashboard/analytics/network/actions";

export default function NetworkOverviewPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const network = getNetworkBySlug(slug);
  const { from, to } = useDateRange();

  const [shows, setShows] = useState<AccessibleShow[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // Podcast state
  const [podcastData, setPodcastData] = useState<TransistorAnalyticsPoint[]>([]);
  const [podcastEpisodes, setPodcastEpisodes] = useState<TransistorEpisode[]>([]);
  const [showBreakdown, setShowBreakdown] = useState<NetworkShowBreakdown[]>([]);
  const [podcastLoading, setPodcastLoading] = useState(false);
  const [podcastError, setPodcastError] = useState(false);

  // YouTube state
  const [ytChannel, setYtChannel] = useState<YouTubeChannelStats | null>(null);
  const [ytVideos, setYtVideos] = useState<YouTubeVideo[]>([]);
  const [ytAnalytics, setYtAnalytics] = useState<YouTubeAnalyticsPoint[]>([]);
  const [ytLoading, setYtLoading] = useState(false);
  const [ytError, setYtError] = useState(false);

  // Load show titles for breakdown table
  useEffect(() => {
    fetchAccessibleShows().then(setShows);
  }, []);

  const loadPodcastData = useCallback(async () => {
    setPodcastLoading(true);
    setPodcastError(false);
    try {
      const dateRange = { from, to };
      const [analytics, episodes, breakdown] = await Promise.all([
        fetchNetworkPodcastAnalytics(slug, dateRange),
        fetchNetworkPodcastEpisodes(slug),
        fetchNetworkShowBreakdown(slug, dateRange),
      ]);
      setPodcastData(analytics);
      setPodcastEpisodes(episodes);
      setShowBreakdown(breakdown);
    } catch {
      setPodcastError(true);
    } finally {
      setPodcastLoading(false);
    }
  }, [slug, from, to]);

  const loadYouTubeData = useCallback(async () => {
    setYtLoading(true);
    setYtError(false);
    try {
      const [channel, videos, analytics] = await Promise.all([
        fetchNetworkYouTubeChannel(slug),
        fetchNetworkYouTubeVideos(slug),
        fetchNetworkYouTubeAnalytics(slug, { from, to }),
      ]);
      setYtChannel(channel);
      setYtVideos(videos);
      setYtAnalytics(analytics);
    } catch {
      setYtError(true);
    } finally {
      setYtLoading(false);
    }
  }, [slug, from, to]);

  useEffect(() => {
    if (!network) return;
    loadPodcastData();
    loadYouTubeData();
  }, [network, loadPodcastData, loadYouTubeData]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await refreshNetworkAnalyticsCache(slug);
      await Promise.all([loadPodcastData(), loadYouTubeData()]);
    } finally {
      setRefreshing(false);
    }
  }

  if (!network) {
    return (
      <div className="space-y-4">
        <p className="text-muted-foreground">Network not found.</p>
        <Link href="/dashboard/analytics" className="text-primary hover:underline">
          Back to analytics
        </Link>
      </div>
    );
  }

  const totalDownloads = podcastData.reduce((sum, p) => sum + p.downloads, 0);
  const ytTotalViews = ytAnalytics.reduce((sum, p) => sum + p.views, 0);
  const watchHours = Math.round(
    ytAnalytics.reduce((sum, p) => sum + p.estimatedMinutesWatched, 0) / 60
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="mb-1">
            <Link
              href="/dashboard/analytics"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              All Networks
            </Link>
          </div>
          <h1 className="text-2xl font-bold">{network.name}</h1>
          <p className="text-sm text-muted-foreground">
            Network overview &middot; {network.wpShowIds.length}{" "}
            {network.wpShowIds.length === 1 ? "show" : "shows"}
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="rounded-lg border bg-background px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          {refreshing ? "Refreshing\u2026" : "Refresh Data"}
        </button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Downloads"
          value={podcastLoading ? "" : formatNumber(totalDownloads)}
          subtitle={`${from} \u2013 ${to}`}
          loading={podcastLoading}
        />
        <StatCard
          title="YouTube Views"
          value={ytLoading ? "" : formatNumber(ytTotalViews)}
          subtitle={`${from} \u2013 ${to}`}
          loading={ytLoading}
        />
        <StatCard
          title="Watch Hours"
          value={ytLoading ? "" : formatNumber(watchHours)}
          subtitle={`${from} \u2013 ${to}`}
          loading={ytLoading}
        />
        <StatCard
          title="Subscribers"
          value={ytLoading ? "" : formatNumber(ytChannel?.subscriberCount ?? 0)}
          subtitle="All time"
          loading={ytLoading}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border bg-card p-4">
          <h2 className="mb-4 text-base font-semibold">Podcast Downloads</h2>
          {podcastError ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Failed to load podcast data.
            </p>
          ) : podcastLoading ? (
            <div className="h-[300px] animate-pulse rounded bg-muted" />
          ) : (
            <TimeSeriesChart
              data={podcastData as unknown as Record<string, unknown>[]}
              xKey="date"
              series={[
                { dataKey: "downloads", name: "Downloads", color: "#6366f1" },
              ]}
              height={300}
            />
          )}
        </div>

        <div className="rounded-lg border bg-card p-4">
          <h2 className="mb-4 text-base font-semibold">YouTube Views</h2>
          {ytError ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Failed to load YouTube data.
            </p>
          ) : ytLoading ? (
            <div className="h-[300px] animate-pulse rounded bg-muted" />
          ) : (
            <TimeSeriesChart
              data={ytAnalytics as unknown as Record<string, unknown>[]}
              xKey="date"
              series={[
                { dataKey: "views", name: "Views", color: "#f43f5e" },
              ]}
              height={300}
            />
          )}
        </div>
      </div>

      {/* Per-Show Breakdown */}
      <div className="rounded-lg border bg-card p-4">
        <h2 className="mb-4 text-base font-semibold">Shows</h2>
        {podcastError ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Failed to load show data.
          </p>
        ) : podcastLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : (
          <ShowBreakdownTable breakdown={showBreakdown} shows={shows} />
        )}
      </div>

      {/* Top Content */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border bg-card p-4">
          <h2 className="mb-4 text-base font-semibold">Recent Episodes</h2>
          {podcastError ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Failed to load episodes.
            </p>
          ) : podcastLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-muted" />
              ))}
            </div>
          ) : (
            <EpisodeTable episodes={podcastEpisodes} limit={10} />
          )}
        </div>

        <div className="rounded-lg border bg-card p-4">
          <h2 className="mb-4 text-base font-semibold">Top Videos</h2>
          {ytError ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Failed to load videos.
            </p>
          ) : ytLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-muted" />
              ))}
            </div>
          ) : (
            <VideoTable videos={ytVideos} limit={10} />
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboard/analytics/network/[slug]/page.tsx
git commit -m "feat(analytics): add network overview page"
```

---

### Task 7: Hide AnalyticsNav on Network Pages

**Files:**
- Modify: `src/components/analytics/analytics-nav.tsx`

- [ ] **Step 1: Update AnalyticsNav to hide on network routes**

The component already uses `usePathname()`. Add a check to return null when on a network page:

```tsx
// Add after: const pathname = usePathname();
if (pathname.startsWith("/dashboard/analytics/network")) return null;
```

- [ ] **Step 2: Verify manually**

Run: `npm run dev`
Navigate to `/dashboard/analytics/network/sunset-lounge-dfw` — tabs should not appear.
Navigate to `/dashboard/analytics` — tabs should appear as before.

- [ ] **Step 3: Commit**

```bash
git add src/components/analytics/analytics-nav.tsx
git commit -m "feat(analytics): hide nav tabs on network pages"
```

---

### Task 8: Admin Landing Page with Network Picker

**Files:**
- Modify: `src/app/dashboard/analytics/page.tsx`

- [ ] **Step 1: Add role detection and network picker to the overview page**

The current page is a `"use client"` component. It needs to:
1. Fetch the user's role (add a new server action)
2. If admin, show the NetworkPicker instead of the show-level overview
3. If producer, show the existing show-level overview unchanged

Add a server action to `src/app/dashboard/analytics/actions.ts`:

```ts
export async function fetchCurrentUserRole(): Promise<string> {
  const session = await auth();
  if (!session?.user) return "producer";
  return session.user.role;
}
```

Then modify `src/app/dashboard/analytics/page.tsx`. At the top of the component, add state for role and networks. Wrap the existing content in a conditional:

```tsx
// Add imports at top:
import NetworkPicker from "@/components/analytics/network-picker";
import { getNetworksForRole } from "@/lib/analytics/networks";
import { fetchCurrentUserRole } from "./actions";

// Add inside component, after existing state declarations:
const [role, setRole] = useState<string | null>(null);

// Replace the existing useEffect that loads shows with:
useEffect(() => {
  Promise.all([fetchAccessibleShows(), fetchCurrentUserRole()]).then(
    ([showsResult, userRole]) => {
      setShows(showsResult);
      setRole(userRole);
      if (showsResult.length > 0) {
        setSelectedShowId(showsResult[0].wpShowId);
      }
    }
  );
}, []);

// Before the return statement, add:
if (role === null) {
  return <p className="text-muted-foreground">Loading...</p>;
}

const networks = getNetworksForRole(role);

if (networks.length > 0) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Select a network to view analytics
        </p>
      </div>
      <NetworkPicker networks={networks} />
    </div>
  );
}

// ... existing return for producers continues below unchanged
```

- [ ] **Step 2: Verify manually**

Run: `npm run dev`
- Log in as admin — should see network picker cards
- Log in as producer — should see existing show-level overview

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/analytics/page.tsx src/app/dashboard/analytics/actions.ts
git commit -m "feat(analytics): show network picker for admins on landing page"
```

---

### Task 9: Gate YouTube on Show-Level Pages

**Files:**
- Modify: `src/app/dashboard/analytics/page.tsx` (overview — hide YouTube section)
- Modify: `src/app/dashboard/analytics/youtube/page.tsx` (full page banner)

- [ ] **Step 1: Add YouTube gating to the Overview page**

In `src/app/dashboard/analytics/page.tsx`, import the banner and the helper:

```tsx
import YouTubeNetworkBanner from "@/components/analytics/youtube-network-banner";
import { showHasOwnYouTube } from "@/lib/analytics/networks";
```

In the component, derive whether YouTube should show:

```tsx
// Add after selectedShowId state is set:
const hasYouTube = selectedShowId !== null ? showHasOwnYouTube(selectedShowId) : true;
```

Skip YouTube data fetching when gated. In `loadYouTubeData`, add an early return:

```tsx
const loadYouTubeData = useCallback(
  async (wpShowId: number) => {
    if (!showHasOwnYouTube(wpShowId)) {
      setYtChannel(null);
      setYtVideos([]);
      setYtAnalytics([]);
      return;
    }
    // ... existing fetch logic
  },
  [from, to]
);
```

Replace the YouTube stat card, chart, and video table sections with conditional rendering:

```tsx
{/* In the stat cards grid, wrap YouTube-related cards */}
{hasYouTube && (
  <StatCard
    title="YouTube Views (All Time)"
    value={loading ? "" : formatNumber(ytTotalViews)}
    subtitle="Channel lifetime"
    loading={ytLoading}
  />
)}
{hasYouTube && (
  <StatCard
    title="Watch Hours"
    value={loading ? "" : formatNumber(Math.round(watchHours / 60))}
    subtitle={`${from} – ${to}`}
    loading={ytLoading}
  />
)}

{/* In the charts grid, replace YouTube chart with conditional */}
{hasYouTube ? (
  <div className="rounded-lg border bg-card p-4">
    {/* ... existing YouTube chart ... */}
  </div>
) : selectedShowId !== null ? (
  <YouTubeNetworkBanner wpShowId={selectedShowId} isAdmin={role === "admin"} />
) : null}

{/* In the tables grid, replace YouTube table with conditional */}
{hasYouTube ? (
  <div className="rounded-lg border bg-card p-4">
    {/* ... existing video table ... */}
  </div>
) : null}
```

- [ ] **Step 2: Add YouTube gating to the YouTube page**

In `src/app/dashboard/analytics/youtube/page.tsx`, import the same utilities:

```tsx
import YouTubeNetworkBanner from "@/components/analytics/youtube-network-banner";
import { showHasOwnYouTube } from "@/lib/analytics/networks";
import { fetchCurrentUserRole } from "@/app/dashboard/analytics/actions";
```

Add role state and fetch it alongside shows:

```tsx
const [role, setRole] = useState<string>("producer");

// Update the show-loading useEffect:
useEffect(() => {
  Promise.all([fetchAccessibleShows(), fetchCurrentUserRole()]).then(
    ([result, userRole]) => {
      setShows(result);
      setRole(userRole);
      if (result.length > 0) {
        setSelectedShowId(result[0].wpShowId);
      }
      setLoading(false);
    }
  );
}, []);
```

After the loading/empty checks, add a gating check:

```tsx
if (selectedShowId !== null && !showHasOwnYouTube(selectedShowId)) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">YouTube Analytics</h2>
        <ShowSelector
          shows={shows}
          selectedShowId={selectedShowId}
          onChange={setSelectedShowId}
        />
      </div>
      <YouTubeNetworkBanner wpShowId={selectedShowId} isAdmin={role === "admin"} />
    </div>
  );
}
```

- [ ] **Step 3: Verify manually**

Run: `npm run dev`
- Select a Sunset Lounge show — YouTube tab should show banner, overview should hide YouTube sections
- Select Your Dark Companion show — YouTube should display normally

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/analytics/page.tsx src/app/dashboard/analytics/youtube/page.tsx
git commit -m "feat(analytics): gate YouTube data for multi-show network members"
```

---

### Task 10: Populate Network Config with Real Show IDs

**Files:**
- Modify: `src/lib/analytics/networks.ts`
- Modify: `tests/lib/analytics/networks.test.ts`

- [ ] **Step 1: Look up real WordPress show IDs**

Run: `npx prisma studio` or query the WordPress API to get the actual show IDs for each network.

Alternatively, check the `ShowPlatformLink` and `PlatformCredential` tables:

```bash
npx prisma db execute --stdin <<< "SELECT DISTINCT \"wpShowId\" FROM show_platform_links ORDER BY \"wpShowId\";"
```

- [ ] **Step 2: Update NETWORKS config with real IDs**

Replace the placeholder arrays in `src/lib/analytics/networks.ts` with the actual IDs found in step 1.

- [ ] **Step 3: Update test assertions**

Update the test file to reference the real IDs (replace `NETWORKS[0].wpShowIds[0]` references if any hardcoded values were used).

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/lib/analytics/networks.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics/networks.ts tests/lib/analytics/networks.test.ts
git commit -m "feat(analytics): populate network config with real show IDs"
```

---

### Task 11: Build Verification

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 2: Run production build**

Run: `npm run build`
Expected: Build succeeds with no type errors

- [ ] **Step 3: Manual smoke test**

Run: `npm run dev`

Test the following flows:
1. Admin lands on `/dashboard/analytics` — sees network picker
2. Click "Sunset Lounge DFW" — sees network overview with aggregated podcast + YouTube data
3. Click a show in the breakdown table — navigates to show-level analytics
4. On show-level overview for a Sunset Lounge show — YouTube section is replaced with banner
5. On YouTube tab for a Sunset Lounge show — banner shown instead of data
6. Your Dark Companion show — YouTube displays normally at show level
7. Producer login — sees show selector, no network picker, banner on YouTube for Sunset shows

- [ ] **Step 4: Commit any fixes from smoke testing**
