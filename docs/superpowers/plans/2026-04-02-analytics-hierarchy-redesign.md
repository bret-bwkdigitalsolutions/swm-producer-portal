# Analytics Hierarchy Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the network-picker landing page with a three-level analytics hierarchy (All Networks / Network / Show) controlled by a unified selector, with aggregated data flowing through all tabs.

**Architecture:** A new `AnalyticsSelectionProvider` context manages the current selection level and exposes `showsInScope` (the wpShowIds to aggregate). A `HierarchicalShowSelector` dropdown replaces the existing `ShowSelector` on all tab pages. Pure aggregation utilities merge per-show data. Each tab page reads the selection context and fetches/aggregates accordingly.

**Tech Stack:** Next.js App Router, React context, existing Transistor + YouTube server actions, existing chart components (recharts-based).

---

### Task 1: Aggregation Utility Functions

**Files:**
- Create: `src/lib/analytics/aggregation.ts`
- Create: `src/lib/analytics/__tests__/aggregation.test.ts`

These are pure functions with no dependencies on React or server actions — easiest to build and test first.

- [ ] **Step 1: Write failing tests for aggregation functions**

Create `src/lib/analytics/__tests__/aggregation.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  aggregateAnalyticsPoints,
  aggregateYouTubeAnalytics,
  aggregateGeo,
  aggregateApps,
  aggregateScrapedOverviews,
  mergeEpisodes,
  mergeVideos,
} from "../aggregation";

describe("aggregateAnalyticsPoints", () => {
  it("sums downloads by date across multiple shows", () => {
    const result = aggregateAnalyticsPoints([
      [
        { date: "2026-03-01", downloads: 10 },
        { date: "2026-03-02", downloads: 20 },
      ],
      [
        { date: "2026-03-01", downloads: 5 },
        { date: "2026-03-02", downloads: 15 },
        { date: "2026-03-03", downloads: 8 },
      ],
    ]);
    expect(result).toEqual([
      { date: "2026-03-01", downloads: 15 },
      { date: "2026-03-02", downloads: 35 },
      { date: "2026-03-03", downloads: 8 },
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(aggregateAnalyticsPoints([])).toEqual([]);
  });

  it("passes through single show unchanged", () => {
    const data = [{ date: "2026-03-01", downloads: 42 }];
    expect(aggregateAnalyticsPoints([data])).toEqual(data);
  });
});

describe("aggregateYouTubeAnalytics", () => {
  it("sums all fields by date", () => {
    const result = aggregateYouTubeAnalytics([
      [{ date: "2026-03-01", views: 100, estimatedMinutesWatched: 50, subscribersGained: 3, subscribersLost: 1 }],
      [{ date: "2026-03-01", views: 200, estimatedMinutesWatched: 80, subscribersGained: 5, subscribersLost: 2 }],
    ]);
    expect(result).toEqual([
      { date: "2026-03-01", views: 300, estimatedMinutesWatched: 130, subscribersGained: 8, subscribersLost: 3 },
    ]);
  });
});

describe("aggregateGeo", () => {
  it("sums downloads by country", () => {
    const result = aggregateGeo([
      { data: [{ country: "United States", region: null, downloads: 100, percentage: null }], scrapedAt: "2026-03-01T00:00:00Z" },
      { data: [{ country: "United States", region: null, downloads: 50, percentage: null }, { country: "Canada", region: null, downloads: 20, percentage: null }], scrapedAt: "2026-03-01T00:00:00Z" },
    ]);
    expect(result.data).toEqual([
      { country: "United States", region: null, downloads: 150, percentage: null },
      { country: "Canada", region: null, downloads: 20, percentage: null },
    ]);
  });
});

describe("aggregateApps", () => {
  it("sums downloads by app name", () => {
    const result = aggregateApps([
      { data: [{ appName: "Spotify", downloads: 200, percentage: null }], scrapedAt: "2026-03-01T00:00:00Z" },
      { data: [{ appName: "Spotify", downloads: 100, percentage: null }, { appName: "Apple Podcasts", downloads: 80, percentage: null }], scrapedAt: "2026-03-01T00:00:00Z" },
    ]);
    expect(result.data).toEqual([
      { appName: "Spotify", downloads: 300, percentage: null },
      { appName: "Apple Podcasts", downloads: 80, percentage: null },
    ]);
  });
});

describe("aggregateScrapedOverviews", () => {
  it("sums subscriber counts and averages", () => {
    const result = aggregateScrapedOverviews([
      { estimatedSubscribers: 1000, avgDownloads7d: 50, avgDownloads30d: 40, avgDownloads60d: 35, avgDownloads90d: 30, monthlyDownloads: null, yearlyDownloads: null, scrapedAt: "2026-03-01T00:00:00Z" },
      { estimatedSubscribers: 500, avgDownloads7d: 25, avgDownloads30d: 20, avgDownloads60d: 15, avgDownloads90d: 10, monthlyDownloads: null, yearlyDownloads: null, scrapedAt: "2026-03-02T00:00:00Z" },
    ]);
    expect(result.estimatedSubscribers).toBe(1500);
    expect(result.avgDownloads7d).toBe(75);
    expect(result.avgDownloads30d).toBe(60);
  });

  it("handles null values", () => {
    const result = aggregateScrapedOverviews([
      { estimatedSubscribers: null, avgDownloads7d: null, avgDownloads30d: null, avgDownloads60d: null, avgDownloads90d: null, monthlyDownloads: null, yearlyDownloads: null, scrapedAt: null },
    ]);
    expect(result.estimatedSubscribers).toBeNull();
  });
});

describe("mergeEpisodes", () => {
  it("flattens and sorts by published_at descending", () => {
    const result = mergeEpisodes([
      [{ id: "1", type: "episode", attributes: { title: "Ep 1", summary: "", published_at: "2026-03-01", duration: 100, number: 1, status: "published", share_url: "", media_url: "", image_url: "", formatted_published_at: "" } }],
      [{ id: "2", type: "episode", attributes: { title: "Ep 2", summary: "", published_at: "2026-03-05", duration: 200, number: 1, status: "published", share_url: "", media_url: "", image_url: "", formatted_published_at: "" } }],
    ]);
    expect(result[0].id).toBe("2");
    expect(result[1].id).toBe("1");
  });
});

describe("mergeVideos", () => {
  it("flattens and sorts by viewCount descending", () => {
    const result = mergeVideos([
      [{ id: "a", title: "V1", description: "", publishedAt: "", thumbnailUrl: "", duration: "", viewCount: 100, likeCount: 0, commentCount: 0 }],
      [{ id: "b", title: "V2", description: "", publishedAt: "", thumbnailUrl: "", duration: "", viewCount: 500, likeCount: 0, commentCount: 0 }],
    ]);
    expect(result[0].id).toBe("b");
    expect(result[1].id).toBe("a");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/analytics/__tests__/aggregation.test.ts`
Expected: FAIL — module `../aggregation` not found

- [ ] **Step 3: Implement aggregation functions**

Create `src/lib/analytics/aggregation.ts`:

```typescript
import type {
  TransistorAnalyticsPoint,
  TransistorEpisode,
  YouTubeAnalyticsPoint,
  YouTubeVideo,
  YouTubeChannelStats,
  YouTubeCountryData,
} from "./types";
import type { ScrapedOverviewData, ScrapedGeoEntry, ScrapedAppEntry } from "@/app/dashboard/analytics/actions";

export function aggregateAnalyticsPoints(
  allPoints: TransistorAnalyticsPoint[][]
): TransistorAnalyticsPoint[] {
  const dateMap = new Map<string, number>();
  for (const points of allPoints) {
    for (const p of points) {
      dateMap.set(p.date, (dateMap.get(p.date) ?? 0) + p.downloads);
    }
  }
  return Array.from(dateMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, downloads]) => ({ date, downloads }));
}

export function aggregateYouTubeAnalytics(
  allPoints: YouTubeAnalyticsPoint[][]
): YouTubeAnalyticsPoint[] {
  const dateMap = new Map<string, YouTubeAnalyticsPoint>();
  for (const points of allPoints) {
    for (const p of points) {
      const existing = dateMap.get(p.date);
      if (existing) {
        existing.views += p.views;
        existing.estimatedMinutesWatched += p.estimatedMinutesWatched;
        existing.subscribersGained += p.subscribersGained;
        existing.subscribersLost += p.subscribersLost;
      } else {
        dateMap.set(p.date, { ...p });
      }
    }
  }
  return Array.from(dateMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );
}

export function aggregateGeo(
  allGeo: { data: ScrapedGeoEntry[]; scrapedAt: string | null }[]
): { data: ScrapedGeoEntry[]; scrapedAt: string | null } {
  const countryMap = new Map<string, number>();
  let latestScrapedAt: string | null = null;

  for (const geo of allGeo) {
    if (geo.scrapedAt && (!latestScrapedAt || geo.scrapedAt > latestScrapedAt)) {
      latestScrapedAt = geo.scrapedAt;
    }
    for (const entry of geo.data) {
      countryMap.set(entry.country, (countryMap.get(entry.country) ?? 0) + entry.downloads);
    }
  }

  const data = Array.from(countryMap.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([country, downloads]) => ({
      country,
      region: null,
      downloads,
      percentage: null,
    }));

  return { data, scrapedAt: latestScrapedAt };
}

export function aggregateApps(
  allApps: { data: ScrapedAppEntry[]; scrapedAt: string | null }[]
): { data: ScrapedAppEntry[]; scrapedAt: string | null } {
  const appMap = new Map<string, number>();
  let latestScrapedAt: string | null = null;

  for (const apps of allApps) {
    if (apps.scrapedAt && (!latestScrapedAt || apps.scrapedAt > latestScrapedAt)) {
      latestScrapedAt = apps.scrapedAt;
    }
    for (const entry of apps.data) {
      appMap.set(entry.appName, (appMap.get(entry.appName) ?? 0) + entry.downloads);
    }
  }

  const data = Array.from(appMap.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([appName, downloads]) => ({
      appName,
      downloads,
      percentage: null,
    }));

  return { data, scrapedAt: latestScrapedAt };
}

export function aggregateScrapedOverviews(
  overviews: ScrapedOverviewData[]
): ScrapedOverviewData {
  const nonNull = overviews.filter((o) => o.estimatedSubscribers !== null);

  if (nonNull.length === 0) {
    return {
      estimatedSubscribers: null,
      avgDownloads7d: null,
      avgDownloads30d: null,
      avgDownloads60d: null,
      avgDownloads90d: null,
      monthlyDownloads: null,
      yearlyDownloads: null,
      scrapedAt: null,
    };
  }

  const sum = (key: keyof ScrapedOverviewData) =>
    overviews.reduce((acc, o) => acc + ((o[key] as number) ?? 0), 0) || null;

  const latestScrapedAt = overviews
    .map((o) => o.scrapedAt)
    .filter(Boolean)
    .sort()
    .pop() ?? null;

  return {
    estimatedSubscribers: sum("estimatedSubscribers"),
    avgDownloads7d: sum("avgDownloads7d"),
    avgDownloads30d: sum("avgDownloads30d"),
    avgDownloads60d: sum("avgDownloads60d"),
    avgDownloads90d: sum("avgDownloads90d"),
    monthlyDownloads: null,
    yearlyDownloads: null,
    scrapedAt: latestScrapedAt,
  };
}

export function aggregateYouTubeChannels(
  channels: YouTubeChannelStats[]
): YouTubeChannelStats {
  return channels.reduce(
    (acc, ch) => ({
      subscriberCount: acc.subscriberCount + ch.subscriberCount,
      viewCount: acc.viewCount + ch.viewCount,
      videoCount: acc.videoCount + ch.videoCount,
    }),
    { subscriberCount: 0, viewCount: 0, videoCount: 0 }
  );
}

export function aggregateYouTubeGeo(
  allGeo: YouTubeCountryData[][]
): YouTubeCountryData[] {
  const countryMap = new Map<string, { views: number; minutes: number }>();
  for (const geo of allGeo) {
    for (const entry of geo) {
      const existing = countryMap.get(entry.country);
      if (existing) {
        existing.views += entry.views;
        existing.minutes += entry.estimatedMinutesWatched;
      } else {
        countryMap.set(entry.country, {
          views: entry.views,
          minutes: entry.estimatedMinutesWatched,
        });
      }
    }
  }
  return Array.from(countryMap.entries())
    .sort(([, a], [, b]) => b.views - a.views)
    .map(([country, { views, minutes }]) => ({
      country,
      views,
      estimatedMinutesWatched: minutes,
    }));
}

export function mergeEpisodes(
  allEpisodes: TransistorEpisode[][]
): TransistorEpisode[] {
  return allEpisodes
    .flat()
    .sort(
      (a, b) =>
        new Date(b.attributes.published_at).getTime() -
        new Date(a.attributes.published_at).getTime()
    );
}

export function mergeVideos(allVideos: YouTubeVideo[][]): YouTubeVideo[] {
  return allVideos.flat().sort((a, b) => b.viewCount - a.viewCount);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/analytics/__tests__/aggregation.test.ts`
Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics/aggregation.ts src/lib/analytics/__tests__/aggregation.test.ts
git commit -m "feat: add analytics aggregation utility functions with tests"
```

---

### Task 2: Analytics Selection Provider

**Files:**
- Create: `src/components/analytics/analytics-selection-provider.tsx`

This context manages which level (all/network/show) is active and computes `showsInScope`.

- [ ] **Step 1: Create the selection provider**

Create `src/components/analytics/analytics-selection-provider.tsx`:

```typescript
"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { NETWORKS, type Network } from "@/lib/analytics/networks";
import type { AccessibleShow } from "@/lib/analytics/types";

export type AnalyticsSelection =
  | { level: "all" }
  | { level: "network"; network: Network }
  | { level: "show"; wpShowId: number; showName: string };

interface AnalyticsSelectionContextType {
  selection: AnalyticsSelection;
  setSelection: (selection: AnalyticsSelection) => void;
  showsInScope: number[];
  accessibleShows: AccessibleShow[];
  setAccessibleShows: (shows: AccessibleShow[]) => void;
  role: string | null;
  setRole: (role: string | null) => void;
}

const AnalyticsSelectionContext =
  createContext<AnalyticsSelectionContextType | null>(null);

export function useAnalyticsSelection() {
  const ctx = useContext(AnalyticsSelectionContext);
  if (!ctx)
    throw new Error(
      "useAnalyticsSelection must be used within AnalyticsSelectionProvider"
    );
  return ctx;
}

function selectionToParams(selection: AnalyticsSelection): string {
  const params = new URLSearchParams();
  if (selection.level === "all") {
    params.set("level", "all");
  } else if (selection.level === "network") {
    params.set("level", "network");
    params.set("network", selection.network.slug);
  } else {
    params.set("show", String(selection.wpShowId));
  }
  return params.toString();
}

function parseSelection(searchParams: URLSearchParams): AnalyticsSelection {
  const showParam = searchParams.get("show");
  if (showParam) {
    const wpShowId = parseInt(showParam, 10);
    if (!isNaN(wpShowId)) {
      return { level: "show", wpShowId, showName: "" };
    }
  }

  const levelParam = searchParams.get("level");
  const networkParam = searchParams.get("network");

  if (levelParam === "network" && networkParam) {
    const network = NETWORKS.find((n) => n.slug === networkParam);
    if (network) {
      return { level: "network", network };
    }
  }

  return { level: "all" };
}

function getShowsInScope(
  selection: AnalyticsSelection,
  accessibleShows: AccessibleShow[]
): number[] {
  if (selection.level === "show") {
    return [selection.wpShowId];
  }
  if (selection.level === "network") {
    const networkIds = new Set(selection.network.wpShowIds);
    return accessibleShows
      .filter((s) => networkIds.has(s.wpShowId))
      .map((s) => s.wpShowId);
  }
  // "all" — return all accessible shows
  return accessibleShows.map((s) => s.wpShowId);
}

export default function AnalyticsSelectionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [accessibleShows, setAccessibleShows] = useState<AccessibleShow[]>([]);
  const [role, setRole] = useState<string | null>(null);

  const [selection, setSelectionState] = useState<AnalyticsSelection>(() =>
    parseSelection(searchParams)
  );

  // Sync selection from URL when searchParams change externally
  useEffect(() => {
    const parsed = parseSelection(searchParams);
    setSelectionState((prev) => {
      // Avoid unnecessary re-renders if selection hasn't changed
      if (prev.level === parsed.level) {
        if (parsed.level === "all") return prev;
        if (
          parsed.level === "network" &&
          prev.level === "network" &&
          prev.network.slug === parsed.network.slug
        )
          return prev;
        if (
          parsed.level === "show" &&
          prev.level === "show" &&
          prev.wpShowId === parsed.wpShowId
        )
          return prev;
      }
      return parsed;
    });
  }, [searchParams]);

  const setSelection = useCallback(
    (newSelection: AnalyticsSelection) => {
      setSelectionState(newSelection);
      const paramString = selectionToParams(newSelection);
      router.replace(`?${paramString}`);
    },
    [router]
  );

  const showsInScope = getShowsInScope(selection, accessibleShows);

  return (
    <AnalyticsSelectionContext.Provider
      value={{
        selection,
        setSelection,
        showsInScope,
        accessibleShows,
        setAccessibleShows,
        role,
        setRole,
      }}
    >
      {children}
    </AnalyticsSelectionContext.Provider>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to analytics-selection-provider

- [ ] **Step 3: Commit**

```bash
git add src/components/analytics/analytics-selection-provider.tsx
git commit -m "feat: add AnalyticsSelectionProvider context for hierarchy levels"
```

---

### Task 3: Hierarchical Show Selector

**Files:**
- Create: `src/components/analytics/hierarchical-show-selector.tsx`
- Delete: `src/components/analytics/network-picker.tsx` (deferred to Task 7)

Replaces the flat `ShowSelector` and `NetworkPicker` with a grouped dropdown.

- [ ] **Step 1: Create the hierarchical selector component**

Create `src/components/analytics/hierarchical-show-selector.tsx`:

```typescript
"use client";

import { NETWORKS, getNetworkForShow } from "@/lib/analytics/networks";
import {
  useAnalyticsSelection,
  type AnalyticsSelection,
} from "./analytics-selection-provider";
import type { AccessibleShow } from "@/lib/analytics/types";

function getSelectionLabel(
  selection: AnalyticsSelection,
  accessibleShows: AccessibleShow[]
): string {
  if (selection.level === "all") return "All Networks";
  if (selection.level === "network") return selection.network.name;
  const show = accessibleShows.find(
    (s) => s.wpShowId === selection.wpShowId
  );
  return show?.title ?? selection.showName ?? `Show #${selection.wpShowId}`;
}

export default function HierarchicalShowSelector() {
  const { selection, setSelection, accessibleShows, role } =
    useAnalyticsSelection();

  if (accessibleShows.length === 0) return null;

  const isAdmin = role === "admin";

  // Group accessible shows by network
  const networkGroups = NETWORKS.map((network) => ({
    network,
    shows: accessibleShows.filter((s) =>
      network.wpShowIds.includes(s.wpShowId)
    ),
  })).filter((g) => g.shows.length > 0);

  // Shows not in any network
  const ungrouped = accessibleShows.filter(
    (s) => !getNetworkForShow(s.wpShowId)
  );

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;

    if (val === "all") {
      setSelection({ level: "all" });
      return;
    }

    if (val.startsWith("network:")) {
      const slug = val.replace("network:", "");
      const network = NETWORKS.find((n) => n.slug === slug);
      if (network) setSelection({ level: "network", network });
      return;
    }

    if (val.startsWith("show:")) {
      const wpShowId = parseInt(val.replace("show:", ""), 10);
      const show = accessibleShows.find((s) => s.wpShowId === wpShowId);
      if (show) {
        setSelection({
          level: "show",
          wpShowId,
          showName: show.title,
        });
      }
      return;
    }
  };

  const currentValue =
    selection.level === "all"
      ? "all"
      : selection.level === "network"
        ? `network:${selection.network.slug}`
        : `show:${selection.wpShowId}`;

  return (
    <select
      value={currentValue}
      onChange={handleChange}
      className="rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
    >
      {isAdmin && <option value="all">All Networks</option>}

      {networkGroups.map(({ network, shows }) => (
        <optgroup key={network.slug} label={network.name}>
          {isAdmin && (
            <option value={`network:${network.slug}`}>
              {network.name} (All Shows)
            </option>
          )}
          {shows.map((show) => (
            <option key={show.wpShowId} value={`show:${show.wpShowId}`}>
              {show.title}
            </option>
          ))}
        </optgroup>
      ))}

      {ungrouped.map((show) => (
        <option key={show.wpShowId} value={`show:${show.wpShowId}`}>
          {show.title}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to hierarchical-show-selector

- [ ] **Step 3: Commit**

```bash
git add src/components/analytics/hierarchical-show-selector.tsx
git commit -m "feat: add HierarchicalShowSelector dropdown for All/Network/Show levels"
```

---

### Task 4: Wire Layout and Nav

**Files:**
- Modify: `src/app/dashboard/analytics/layout.tsx`
- Modify: `src/components/analytics/analytics-nav.tsx`

Wrap the analytics layout with `AnalyticsSelectionProvider` and update nav to preserve selection params.

- [ ] **Step 1: Update layout.tsx**

Replace the full contents of `src/app/dashboard/analytics/layout.tsx`:

```typescript
import { requireAuth } from "@/lib/auth-guard";
import AnalyticsNav from "@/components/analytics/analytics-nav";
import DateRangeProvider from "@/components/analytics/date-range-provider";
import AnalyticsSelectionProvider from "@/components/analytics/analytics-selection-provider";
import DateRangePicker from "@/components/analytics/date-range-picker";

export default async function AnalyticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAuth();

  return (
    <DateRangeProvider>
      <AnalyticsSelectionProvider>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold">Analytics</h1>
            <DateRangePicker />
          </div>
          <AnalyticsNav />
          {children}
        </div>
      </AnalyticsSelectionProvider>
    </DateRangeProvider>
  );
}
```

- [ ] **Step 2: Update analytics-nav.tsx**

Replace the full contents of `src/components/analytics/analytics-nav.tsx`:

```typescript
"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

const tabs = [
  { label: "Overview", href: "/dashboard/analytics" },
  { label: "Podcasts", href: "/dashboard/analytics/podcasts" },
  { label: "YouTube", href: "/dashboard/analytics/youtube" },
  { label: "Compare", href: "/dashboard/analytics/compare" },
];

export default function AnalyticsNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Build query string preserving selection params
  const preservedParams = new URLSearchParams();
  const level = searchParams.get("level");
  const network = searchParams.get("network");
  const show = searchParams.get("show");
  if (show) {
    preservedParams.set("show", show);
  } else if (level) {
    preservedParams.set("level", level);
    if (network) preservedParams.set("network", network);
  }
  const queryString = preservedParams.toString();

  return (
    <nav className="flex gap-1 border-b">
      {tabs.map((tab) => {
        const isActive =
          tab.href === "/dashboard/analytics"
            ? pathname === tab.href
            : pathname.startsWith(tab.href);

        const href = queryString ? `${tab.href}?${queryString}` : tab.href;

        return (
          <Link
            key={tab.href}
            href={href}
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

- [ ] **Step 3: Verify the dev server renders without errors**

Run: `npm run build 2>&1 | tail -20`
Expected: Build succeeds (or only pre-existing warnings)

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/analytics/layout.tsx src/components/analytics/analytics-nav.tsx
git commit -m "feat: wire AnalyticsSelectionProvider into layout and update nav params"
```

---

### Task 5: Aggregated Server Actions

**Files:**
- Modify: `src/app/dashboard/analytics/actions.ts`

Add new server actions that fetch data for multiple shows and aggregate using the utilities from Task 1.

- [ ] **Step 1: Add aggregated actions to actions.ts**

Append the following to the end of `src/app/dashboard/analytics/actions.ts` (before the closing cache management section, or at the very end):

```typescript
// --- Aggregated multi-show actions ---

import {
  aggregateAnalyticsPoints,
  aggregateYouTubeAnalytics,
  aggregateYouTubeChannels,
  aggregateYouTubeGeo,
  aggregateGeo,
  aggregateApps,
  aggregateScrapedOverviews,
  mergeEpisodes,
  mergeVideos,
} from "@/lib/analytics/aggregation";

const THROTTLE_MS = 200;

async function throttledMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i++) {
    try {
      results.push(await fn(items[i]));
    } catch {
      // Skip failed shows, don't break the aggregate
    }
    if (i < items.length - 1) {
      await new Promise((r) => setTimeout(r, THROTTLE_MS));
    }
  }
  return results;
}

export async function fetchAggregatedPodcastAnalytics(
  wpShowIds: number[],
  dateRange: DateRange
): Promise<TransistorAnalyticsPoint[]> {
  const allData = await throttledMap(wpShowIds, (id) =>
    getTransistorShowAnalytics(id, dateRange)
  );
  return aggregateAnalyticsPoints(allData);
}

export async function fetchAggregatedPodcastEpisodes(
  wpShowIds: number[]
): Promise<TransistorEpisode[]> {
  const allEpisodes = await throttledMap(wpShowIds, (id) =>
    getTransistorEpisodes(id)
  );
  return mergeEpisodes(allEpisodes);
}

export async function fetchAggregatedYouTubeChannel(
  wpShowIds: number[]
): Promise<YouTubeChannelStats> {
  const allChannels = await throttledMap(wpShowIds, (id) =>
    getYouTubeChannelStats(id)
  );
  return aggregateYouTubeChannels(allChannels);
}

export async function fetchAggregatedYouTubeVideos(
  wpShowIds: number[]
): Promise<YouTubeVideo[]> {
  const allVideos = await throttledMap(wpShowIds, (id) =>
    getYouTubeVideos(id)
  );
  return mergeVideos(allVideos);
}

export async function fetchAggregatedYouTubeAnalytics(
  wpShowIds: number[],
  dateRange: DateRange
): Promise<YouTubeAnalyticsPoint[]> {
  const allData = await throttledMap(wpShowIds, (id) =>
    getYouTubeChannelAnalytics(id, dateRange)
  );
  return aggregateYouTubeAnalytics(allData);
}

export async function fetchAggregatedYouTubeGeo(
  wpShowIds: number[],
  dateRange: DateRange
): Promise<YouTubeCountryData[]> {
  const allGeo = await throttledMap(wpShowIds, (id) =>
    getYouTubeGeoAnalytics(id, dateRange)
  );
  return aggregateYouTubeGeo(allGeo);
}

export async function fetchAggregatedScrapedOverview(
  wpShowIds: number[]
): Promise<ScrapedOverviewData> {
  const allOverviews = await throttledMap(wpShowIds, (id) =>
    fetchScrapedOverview(id)
  );
  return aggregateScrapedOverviews(allOverviews);
}

export async function fetchAggregatedScrapedGeo(
  wpShowIds: number[]
): Promise<{ data: ScrapedGeoEntry[]; scrapedAt: string | null }> {
  const allGeo = await throttledMap(wpShowIds, (id) => fetchScrapedGeo(id));
  return aggregateGeo(allGeo);
}

export async function fetchAggregatedScrapedApps(
  wpShowIds: number[]
): Promise<{ data: ScrapedAppEntry[]; scrapedAt: string | null }> {
  const allApps = await throttledMap(wpShowIds, (id) => fetchScrapedApps(id));
  return aggregateApps(allApps);
}

export async function refreshAggregatedCache(
  wpShowIds: number[]
): Promise<void> {
  for (const id of wpShowIds) {
    await bustCachePrefix(`analytics:transistor:${id}`);
    await bustCachePrefix(`analytics:youtube:${id}`);
  }
}
```

**Note:** The aggregated actions call the underlying library functions directly (e.g., `getTransistorShowAnalytics`) rather than the existing exported server actions to avoid redundant `requireShowAccess` checks per show. The caller is responsible for ensuring the user has access to the requested shows (which the selection provider handles by filtering through `accessibleShows`).

**Important:** The `fetchAggregatedYouTubeAnalytics` and `fetchAggregatedYouTubeVideos` actions use `getYouTubeChannelAnalytics`/`getYouTubeVideos` directly. Shows with playlist-based YouTube scoping (resolved via `resolvePlaylistId`) will fall back to channel-level data in aggregate views. This is acceptable since aggregation is approximate — if playlist-level accuracy is needed later, the aggregated actions can be enhanced to check for playlist IDs per show.

- [ ] **Step 2: Also add the import for `getYouTubeChannelAnalytics`**

At the top of `actions.ts`, ensure the YouTube import includes `getYouTubeChannelAnalytics` (it may already be imported but not used directly — check and add if missing):

The existing import at line 12-20 already imports `getYouTubeChannelAnalytics` — verify this is present.

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/analytics/actions.ts
git commit -m "feat: add aggregated multi-show server actions"
```

---

### Task 6: Rewrite Overview Page

**Files:**
- Modify: `src/app/dashboard/analytics/page.tsx`

Replace the current overview page to use the selection context and fetch aggregated data at all/network levels.

- [ ] **Step 1: Rewrite page.tsx**

Replace the full contents of `src/app/dashboard/analytics/page.tsx`:

```typescript
"use client";

import { useState, useEffect, useCallback } from "react";
import HierarchicalShowSelector from "@/components/analytics/hierarchical-show-selector";
import StatCard from "@/components/analytics/stat-card";
import TimeSeriesChart from "@/components/analytics/charts/time-series-chart";
import EpisodeTable from "@/components/analytics/episode-table";
import VideoTable from "@/components/analytics/video-table";
import OverviewGeoSection from "@/components/analytics/overview-geo-section";
import OverviewPlatformsSection from "@/components/analytics/overview-platforms-section";
import OverviewAudienceSection from "@/components/analytics/overview-audience-section";
import { useDateRange } from "@/components/analytics/date-range-provider";
import { useAnalyticsSelection } from "@/components/analytics/analytics-selection-provider";
import { formatNumber } from "@/lib/analytics/date-utils";
import {
  fetchAccessibleShows,
  fetchCurrentUserRole,
  fetchPodcastAnalytics,
  fetchPodcastEpisodes,
  fetchYouTubeChannel,
  fetchYouTubeVideos,
  fetchYouTubeAnalytics,
  fetchYouTubeGeo,
  fetchScrapedOverview,
  fetchScrapedGeo,
  fetchScrapedApps,
  refreshAnalyticsCache,
  fetchAggregatedPodcastAnalytics,
  fetchAggregatedPodcastEpisodes,
  fetchAggregatedYouTubeChannel,
  fetchAggregatedYouTubeVideos,
  fetchAggregatedYouTubeAnalytics,
  fetchAggregatedYouTubeGeo,
  fetchAggregatedScrapedOverview,
  fetchAggregatedScrapedGeo,
  fetchAggregatedScrapedApps,
  refreshAggregatedCache,
} from "./actions";
import type {
  ScrapedOverviewData,
  ScrapedGeoEntry,
  ScrapedAppEntry,
} from "./actions";
import type {
  TransistorAnalyticsPoint,
  TransistorEpisode,
  YouTubeChannelStats,
  YouTubeVideo,
  YouTubeAnalyticsPoint,
  YouTubeCountryData,
} from "@/lib/analytics/types";

export default function AnalyticsOverviewPage() {
  const { from, to } = useDateRange();
  const {
    selection,
    showsInScope,
    accessibleShows,
    setAccessibleShows,
    role,
    setRole,
  } = useAnalyticsSelection();

  const [refreshing, setRefreshing] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Podcast state
  const [podcastData, setPodcastData] = useState<TransistorAnalyticsPoint[]>(
    []
  );
  const [podcastEpisodes, setPodcastEpisodes] = useState<TransistorEpisode[]>(
    []
  );
  const [podcastLoading, setPodcastLoading] = useState(false);
  const [podcastError, setPodcastError] = useState(false);

  // Scraped data state
  const [scrapedOverview, setScrapedOverview] =
    useState<ScrapedOverviewData | null>(null);
  const [scrapedGeo, setScrapedGeo] = useState<{
    data: ScrapedGeoEntry[];
    scrapedAt: string | null;
  }>({ data: [], scrapedAt: null });
  const [scrapedApps, setScrapedApps] = useState<{
    data: ScrapedAppEntry[];
    scrapedAt: string | null;
  }>({ data: [], scrapedAt: null });

  // YouTube state
  const [ytGeo, setYtGeo] = useState<YouTubeCountryData[]>([]);
  const [ytChannel, setYtChannel] = useState<YouTubeChannelStats | null>(null);
  const [ytVideos, setYtVideos] = useState<YouTubeVideo[]>([]);
  const [ytAnalytics, setYtAnalytics] = useState<YouTubeAnalyticsPoint[]>([]);
  const [ytLoading, setYtLoading] = useState(false);
  const [ytError, setYtError] = useState(false);

  // Initialize shows and role
  useEffect(() => {
    Promise.all([fetchAccessibleShows(), fetchCurrentUserRole()]).then(
      ([shows, userRole]) => {
        setAccessibleShows(shows);
        setRole(userRole);
        setInitialized(true);
      }
    );
  }, [setAccessibleShows, setRole]);

  const loadPodcastData = useCallback(
    async (wpShowIds: number[]) => {
      setPodcastLoading(true);
      setPodcastError(false);
      try {
        if (wpShowIds.length === 1) {
          const [analytics, episodes, overview] = await Promise.all([
            fetchPodcastAnalytics(wpShowIds[0], { from, to }),
            fetchPodcastEpisodes(wpShowIds[0]),
            fetchScrapedOverview(wpShowIds[0]),
          ]);
          setPodcastData(analytics);
          setPodcastEpisodes(episodes);
          setScrapedOverview(overview);
        } else {
          const [analytics, episodes, overview] = await Promise.all([
            fetchAggregatedPodcastAnalytics(wpShowIds, { from, to }),
            fetchAggregatedPodcastEpisodes(wpShowIds),
            fetchAggregatedScrapedOverview(wpShowIds),
          ]);
          setPodcastData(analytics);
          setPodcastEpisodes(episodes);
          setScrapedOverview(overview);
        }
      } catch {
        setPodcastError(true);
      } finally {
        setPodcastLoading(false);
      }

      // Fetch scraped geo/apps independently
      if (wpShowIds.length === 1) {
        fetchScrapedGeo(wpShowIds[0]).then(setScrapedGeo).catch(() => {});
        fetchScrapedApps(wpShowIds[0]).then(setScrapedApps).catch(() => {});
      } else {
        fetchAggregatedScrapedGeo(wpShowIds).then(setScrapedGeo).catch(() => {});
        fetchAggregatedScrapedApps(wpShowIds).then(setScrapedApps).catch(() => {});
      }
    },
    [from, to]
  );

  const loadYouTubeData = useCallback(
    async (wpShowIds: number[]) => {
      setYtLoading(true);
      setYtError(false);
      try {
        if (wpShowIds.length === 1) {
          const [channel, videos, analytics, geo] = await Promise.all([
            fetchYouTubeChannel(wpShowIds[0]),
            fetchYouTubeVideos(wpShowIds[0]),
            fetchYouTubeAnalytics(wpShowIds[0], { from, to }),
            fetchYouTubeGeo(wpShowIds[0], { from, to }),
          ]);
          setYtChannel(channel);
          setYtVideos(videos);
          setYtAnalytics(analytics);
          setYtGeo(geo);
        } else {
          const [channel, videos, analytics, geo] = await Promise.all([
            fetchAggregatedYouTubeChannel(wpShowIds),
            fetchAggregatedYouTubeVideos(wpShowIds),
            fetchAggregatedYouTubeAnalytics(wpShowIds, { from, to }),
            fetchAggregatedYouTubeGeo(wpShowIds, { from, to }),
          ]);
          setYtChannel(channel);
          setYtVideos(videos);
          setYtAnalytics(analytics);
          setYtGeo(geo);
        }
      } catch {
        setYtError(true);
      } finally {
        setYtLoading(false);
      }
    },
    [from, to]
  );

  // Fetch data when selection or date range changes
  useEffect(() => {
    if (!initialized || showsInScope.length === 0) return;
    loadPodcastData(showsInScope);
    loadYouTubeData(showsInScope);
  }, [initialized, showsInScope, from, to, loadPodcastData, loadYouTubeData]);

  async function handleRefresh() {
    if (showsInScope.length === 0) return;
    setRefreshing(true);
    try {
      if (showsInScope.length === 1) {
        await refreshAnalyticsCache(showsInScope[0]);
      } else {
        await refreshAggregatedCache(showsInScope);
      }
      await Promise.all([
        loadPodcastData(showsInScope),
        loadYouTubeData(showsInScope),
      ]);
    } finally {
      setRefreshing(false);
    }
  }

  if (!initialized) {
    return <p className="text-muted-foreground">Loading...</p>;
  }

  // Derived stats
  const totalDownloads = podcastData.reduce((sum, p) => sum + p.downloads, 0);
  const ytTotalViews = ytAnalytics.reduce((sum, p) => sum + p.views, 0);
  const watchHours = ytAnalytics.reduce(
    (sum, p) => sum + p.estimatedMinutesWatched,
    0
  );
  const loading = podcastLoading || ytLoading;

  // Selection label for subtitle
  const subtitle =
    selection.level === "all"
      ? "All networks combined"
      : selection.level === "network"
        ? selection.network.name
        : "Performance across podcast and YouTube";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Analytics Overview</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          <HierarchicalShowSelector />
          <button
            onClick={handleRefresh}
            disabled={refreshing || showsInScope.length === 0}
            className="rounded-lg border bg-background px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            {refreshing ? "Refreshing\u2026" : "Refresh Data"}
          </button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatCard
          title="Total Downloads"
          value={loading ? "" : formatNumber(totalDownloads)}
          subtitle={`${from} \u2013 ${to}`}
          loading={podcastLoading}
        />
        <StatCard
          title="Est. Subscribers"
          value={
            scrapedOverview?.estimatedSubscribers != null
              ? formatNumber(scrapedOverview.estimatedSubscribers)
              : "\u2014"
          }
          subtitle={
            scrapedOverview?.scrapedAt
              ? `Updated ${new Date(scrapedOverview.scrapedAt).toLocaleDateString()}`
              : "No data yet"
          }
          loading={podcastLoading}
        />
        <StatCard
          title="YouTube Views"
          value={loading ? "" : formatNumber(ytTotalViews)}
          subtitle={`${from} \u2013 ${to}`}
          loading={ytLoading}
        />
        <StatCard
          title="Watch Hours"
          value={loading ? "" : formatNumber(Math.round(watchHours / 60))}
          subtitle={`${from} \u2013 ${to}`}
          loading={ytLoading}
        />
      </div>

      {/* Time Series Charts */}
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

      {/* Tables */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border bg-card p-4">
          <h2 className="mb-4 text-base font-semibold">Top Episodes</h2>
          {podcastError ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Failed to load episodes.
            </p>
          ) : podcastLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="h-10 animate-pulse rounded bg-muted"
                />
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
                <div
                  key={i}
                  className="h-10 animate-pulse rounded bg-muted"
                />
              ))}
            </div>
          ) : (
            <VideoTable videos={ytVideos} limit={10} />
          )}
        </div>
      </div>

      {/* Audience Summary */}
      <OverviewAudienceSection
        scrapedOverview={scrapedOverview}
        ytChannel={ytChannel}
        podcastLoading={podcastLoading}
        youtubeLoading={ytLoading}
      />

      {/* Cross-Platform Geography */}
      <OverviewGeoSection
        podcastGeo={scrapedGeo}
        youtubeGeo={ytGeo}
        podcastLoading={podcastLoading}
        youtubeLoading={ytLoading}
      />

      {/* Where People Experience the Show */}
      <OverviewPlatformsSection
        podcastApps={scrapedApps}
        youtubeTotalViews={ytTotalViews}
        podcastLoading={podcastLoading}
        youtubeLoading={ytLoading}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 3: Manual test — open `/dashboard/analytics` in browser**

Expected: Admin sees "All Networks" selected by default, full dashboard with aggregated data from all shows. Selector dropdown shows All Networks, network groups, and individual shows. Changing selection updates data.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/analytics/page.tsx
git commit -m "feat: rewrite Overview page with three-level hierarchy support"
```

---

### Task 7: Update Podcasts Tab

**Files:**
- Modify: `src/app/dashboard/analytics/podcasts/page.tsx`

Replace `ShowSelector` with `HierarchicalShowSelector` and use selection context for aggregated data.

- [ ] **Step 1: Rewrite podcasts/page.tsx**

Replace the full contents of `src/app/dashboard/analytics/podcasts/page.tsx`:

```typescript
"use client";

import { useEffect, useState, useCallback } from "react";
import { useDateRange } from "@/components/analytics/date-range-provider";
import { useAnalyticsSelection } from "@/components/analytics/analytics-selection-provider";
import HierarchicalShowSelector from "@/components/analytics/hierarchical-show-selector";
import StatCard from "@/components/analytics/stat-card";
import TimeSeriesChart from "@/components/analytics/charts/time-series-chart";
import EpisodeTable from "@/components/analytics/episode-table";
import ListenersSection from "@/components/analytics/listeners-section";
import {
  fetchAccessibleShows,
  fetchCurrentUserRole,
  fetchPodcastAnalytics,
  fetchPodcastEpisodes,
  fetchScrapedOverview,
  fetchScrapedGeo,
  fetchScrapedApps,
  fetchScrapedDevices,
  fetchAggregatedPodcastAnalytics,
  fetchAggregatedPodcastEpisodes,
  fetchAggregatedScrapedOverview,
  fetchAggregatedScrapedGeo,
  fetchAggregatedScrapedApps,
} from "@/app/dashboard/analytics/actions";
import type {
  TransistorAnalyticsPoint,
  TransistorEpisode,
} from "@/lib/analytics/types";
import type {
  ScrapedOverviewData,
  ScrapedGeoEntry,
  ScrapedAppEntry,
  ScrapedDeviceEntry,
} from "@/app/dashboard/analytics/actions";

export default function PodcastAnalyticsPage() {
  const { from, to } = useDateRange();
  const {
    selection,
    showsInScope,
    accessibleShows,
    setAccessibleShows,
    setRole,
  } = useAnalyticsSelection();

  const [initialized, setInitialized] = useState(false);
  const [downloads, setDownloads] = useState<TransistorAnalyticsPoint[]>([]);
  const [episodes, setEpisodes] = useState<TransistorEpisode[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [scrapedOverview, setScrapedOverview] =
    useState<ScrapedOverviewData | null>(null);
  const [scrapedGeo, setScrapedGeo] = useState<{
    data: ScrapedGeoEntry[];
    scrapedAt: string | null;
  }>({ data: [], scrapedAt: null });
  const [scrapedApps, setScrapedApps] = useState<{
    data: ScrapedAppEntry[];
    scrapedAt: string | null;
  }>({ data: [], scrapedAt: null });
  const [scrapedDevices, setScrapedDevices] = useState<{
    data: ScrapedDeviceEntry[];
    scrapedAt: string | null;
  }>({ data: [], scrapedAt: null });

  // Initialize shows and role
  useEffect(() => {
    if (accessibleShows.length > 0) {
      setInitialized(true);
      return;
    }
    Promise.all([fetchAccessibleShows(), fetchCurrentUserRole()]).then(
      ([shows, userRole]) => {
        setAccessibleShows(shows);
        setRole(userRole);
        setInitialized(true);
      }
    );
  }, [accessibleShows, setAccessibleShows, setRole]);

  // Fetch data when selection or date range changes
  useEffect(() => {
    if (!initialized || showsInScope.length === 0) return;

    setDataLoading(true);
    const dateRange = { from, to };
    const isSingle = showsInScope.length === 1;

    // Core analytics
    Promise.all([
      isSingle
        ? fetchPodcastAnalytics(showsInScope[0], dateRange)
        : fetchAggregatedPodcastAnalytics(showsInScope, dateRange),
      isSingle
        ? fetchPodcastEpisodes(showsInScope[0])
        : fetchAggregatedPodcastEpisodes(showsInScope),
    ])
      .then(([analyticsData, episodesData]) => {
        setDownloads(analyticsData);
        setEpisodes(episodesData);
        setDataLoading(false);
      })
      .catch(() => setDataLoading(false));

    // Scraped data
    if (isSingle) {
      fetchScrapedOverview(showsInScope[0])
        .then(setScrapedOverview)
        .catch(() => {});
      fetchScrapedGeo(showsInScope[0])
        .then(setScrapedGeo)
        .catch(() => {});
      fetchScrapedApps(showsInScope[0])
        .then(setScrapedApps)
        .catch(() => {});
      fetchScrapedDevices(showsInScope[0])
        .then(setScrapedDevices)
        .catch(() => {});
    } else {
      fetchAggregatedScrapedOverview(showsInScope)
        .then(setScrapedOverview)
        .catch(() => {});
      fetchAggregatedScrapedGeo(showsInScope)
        .then(setScrapedGeo)
        .catch(() => {});
      fetchAggregatedScrapedApps(showsInScope)
        .then(setScrapedApps)
        .catch(() => {});
      // No aggregated devices action — reset
      setScrapedDevices({ data: [], scrapedAt: null });
    }
  }, [initialized, showsInScope, from, to]);

  const totalDownloads = downloads.reduce((sum, d) => sum + d.downloads, 0);
  const avgPerEpisode =
    episodes.length > 0 ? Math.round(totalDownloads / episodes.length) : 0;

  if (!initialized) {
    return <p className="text-muted-foreground">Loading shows...</p>;
  }

  if (accessibleShows.length === 0) {
    return <p className="text-muted-foreground">No shows available.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Podcast Analytics</h2>
        <HierarchicalShowSelector />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatCard
          title="Total Downloads"
          value={totalDownloads.toLocaleString()}
          loading={dataLoading}
        />
        <StatCard
          title="Avg per Episode"
          value={avgPerEpisode.toLocaleString()}
          loading={dataLoading}
        />
        <StatCard
          title="Episodes Published"
          value={episodes.length.toLocaleString()}
          loading={dataLoading}
        />
        <StatCard
          title="Est. Subscribers"
          value={
            scrapedOverview?.estimatedSubscribers?.toLocaleString() ?? "\u2014"
          }
          subtitle={
            scrapedOverview?.scrapedAt
              ? `Updated ${new Date(scrapedOverview.scrapedAt).toLocaleDateString()}`
              : undefined
          }
          loading={dataLoading}
        />
      </div>

      <div className="rounded-lg border bg-card p-4">
        <h2 className="mb-4 text-base font-semibold">Downloads Over Time</h2>
        <TimeSeriesChart
          data={downloads as unknown as Record<string, unknown>[]}
          xKey="date"
          series={[
            { dataKey: "downloads", name: "Downloads", color: "#6366f1" },
          ]}
        />
      </div>

      <div className="rounded-lg border bg-card p-4">
        <h2 className="mb-4 text-base font-semibold">Episodes</h2>
        <EpisodeTable episodes={episodes} />
      </div>

      <ListenersSection
        geo={scrapedGeo}
        apps={scrapedApps}
        devices={scrapedDevices}
        loading={dataLoading}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/analytics/podcasts/page.tsx
git commit -m "feat: update Podcasts tab to use hierarchy selection with aggregation"
```

---

### Task 8: Update YouTube Tab

**Files:**
- Modify: `src/app/dashboard/analytics/youtube/page.tsx`

Same pattern as Task 7 — use selection context and aggregated actions.

- [ ] **Step 1: Rewrite youtube/page.tsx**

Replace the full contents of `src/app/dashboard/analytics/youtube/page.tsx`:

```typescript
"use client";

import { useEffect, useState } from "react";
import { useDateRange } from "@/components/analytics/date-range-provider";
import { useAnalyticsSelection } from "@/components/analytics/analytics-selection-provider";
import HierarchicalShowSelector from "@/components/analytics/hierarchical-show-selector";
import StatCard from "@/components/analytics/stat-card";
import TimeSeriesChart from "@/components/analytics/charts/time-series-chart";
import BarChart from "@/components/analytics/charts/bar-chart";
import DonutChart from "@/components/analytics/charts/donut-chart";
import AreaChart from "@/components/analytics/charts/area-chart";
import VideoTable from "@/components/analytics/video-table";
import {
  fetchAccessibleShows,
  fetchCurrentUserRole,
  fetchYouTubeChannel,
  fetchYouTubeVideos,
  fetchYouTubeAnalytics,
  fetchYouTubeTraffic,
  fetchYouTubeGeo,
  fetchAggregatedYouTubeChannel,
  fetchAggregatedYouTubeVideos,
  fetchAggregatedYouTubeAnalytics,
  fetchAggregatedYouTubeGeo,
} from "@/app/dashboard/analytics/actions";
import type {
  YouTubeChannelStats,
  YouTubeVideo,
  YouTubeAnalyticsPoint,
  YouTubeTrafficSource,
  YouTubeCountryData,
} from "@/lib/analytics/types";

export default function YouTubeAnalyticsPage() {
  const { from, to } = useDateRange();
  const {
    showsInScope,
    accessibleShows,
    setAccessibleShows,
    setRole,
  } = useAnalyticsSelection();

  const [initialized, setInitialized] = useState(false);
  const [channel, setChannel] = useState<YouTubeChannelStats | null>(null);
  const [videos, setVideos] = useState<YouTubeVideo[]>([]);
  const [analytics, setAnalytics] = useState<YouTubeAnalyticsPoint[]>([]);
  const [trafficSources, setTrafficSources] = useState<YouTubeTrafficSource[]>(
    []
  );
  const [countries, setCountries] = useState<YouTubeCountryData[]>([]);
  const [staticLoading, setStaticLoading] = useState(false);
  const [dateLoading, setDateLoading] = useState(false);

  // Initialize
  useEffect(() => {
    if (accessibleShows.length > 0) {
      setInitialized(true);
      return;
    }
    Promise.all([fetchAccessibleShows(), fetchCurrentUserRole()]).then(
      ([shows, userRole]) => {
        setAccessibleShows(shows);
        setRole(userRole);
        setInitialized(true);
      }
    );
  }, [accessibleShows, setAccessibleShows, setRole]);

  // Fetch channel + videos when selection changes
  useEffect(() => {
    if (!initialized || showsInScope.length === 0) return;

    setStaticLoading(true);
    const isSingle = showsInScope.length === 1;

    Promise.all([
      isSingle
        ? fetchYouTubeChannel(showsInScope[0])
        : fetchAggregatedYouTubeChannel(showsInScope),
      isSingle
        ? fetchYouTubeVideos(showsInScope[0])
        : fetchAggregatedYouTubeVideos(showsInScope),
    ]).then(([channelData, videosData]) => {
      setChannel(channelData);
      setVideos(videosData);
      setStaticLoading(false);
    });
  }, [initialized, showsInScope]);

  // Fetch date-dependent data
  useEffect(() => {
    if (!initialized || showsInScope.length === 0) return;

    setDateLoading(true);
    const dateRange = { from, to };
    const isSingle = showsInScope.length === 1;

    const fetches: [
      Promise<YouTubeAnalyticsPoint[]>,
      Promise<YouTubeTrafficSource[]>,
      Promise<YouTubeCountryData[]>,
    ] = [
      isSingle
        ? fetchYouTubeAnalytics(showsInScope[0], dateRange)
        : fetchAggregatedYouTubeAnalytics(showsInScope, dateRange),
      // Traffic sources only available at show level
      isSingle
        ? fetchYouTubeTraffic(showsInScope[0], dateRange)
        : Promise.resolve([]),
      isSingle
        ? fetchYouTubeGeo(showsInScope[0], dateRange)
        : fetchAggregatedYouTubeGeo(showsInScope, dateRange),
    ];

    Promise.all(fetches).then(([analyticsData, trafficData, geoData]) => {
      setAnalytics(analyticsData);
      setTrafficSources(trafficData);
      setCountries(geoData);
      setDateLoading(false);
    });
  }, [initialized, showsInScope, from, to]);

  const totalViews = analytics.reduce((sum, d) => sum + d.views, 0);
  const totalMinutes = analytics.reduce(
    (sum, d) => sum + d.estimatedMinutesWatched,
    0
  );
  const watchHours = Math.round(totalMinutes / 60);
  const subsGained = analytics.reduce(
    (sum, d) => sum + d.subscribersGained,
    0
  );
  const subsLost = analytics.reduce((sum, d) => sum + d.subscribersLost, 0);
  const avgViewDuration =
    totalViews > 0 ? Math.round(totalMinutes / totalViews) : 0;
  const dataLoading = staticLoading || dateLoading;

  if (!initialized) {
    return <p className="text-muted-foreground">Loading shows...</p>;
  }

  if (accessibleShows.length === 0) {
    return <p className="text-muted-foreground">No shows available.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">YouTube Analytics</h2>
          <p className="text-sm text-muted-foreground">
            Data may be 48\u201372 hours delayed
          </p>
        </div>
        <HierarchicalShowSelector />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Subscribers"
          value={channel ? channel.subscriberCount.toLocaleString() : "\u2014"}
          loading={staticLoading}
        />
        <StatCard
          title="Subs Gained"
          value={subsGained.toLocaleString()}
          loading={dateLoading}
        />
        <StatCard
          title="Subs Lost"
          value={subsLost.toLocaleString()}
          loading={dateLoading}
        />
        <StatCard
          title="Views"
          value={totalViews.toLocaleString()}
          loading={dateLoading}
        />
        <StatCard
          title="Watch Hours"
          value={watchHours.toLocaleString()}
          loading={dateLoading}
        />
        <StatCard
          title="Avg View Duration"
          value={`${avgViewDuration} min`}
          loading={dateLoading}
        />
      </div>

      <div className="rounded-lg border bg-card p-4">
        <h2 className="mb-4 text-base font-semibold">Views Over Time</h2>
        <TimeSeriesChart
          data={analytics as unknown as Record<string, unknown>[]}
          xKey="date"
          series={[{ dataKey: "views", name: "Views", color: "#6366f1" }]}
        />
      </div>

      <div className="rounded-lg border bg-card p-4">
        <h2 className="mb-4 text-base font-semibold">Watch Time Over Time</h2>
        <TimeSeriesChart
          data={analytics as unknown as Record<string, unknown>[]}
          xKey="date"
          series={[
            {
              dataKey: "estimatedMinutesWatched",
              name: "Minutes Watched",
              color: "#8b5cf6",
            },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {trafficSources.length > 0 && (
          <div className="rounded-lg border bg-card p-4">
            <h2 className="mb-4 text-base font-semibold">Traffic Sources</h2>
            <DonutChart
              data={trafficSources.map((t) => ({
                name: t.source,
                value: t.views,
              }))}
            />
          </div>
        )}
        <div className="rounded-lg border bg-card p-4">
          <h2 className="mb-4 text-base font-semibold">Top Countries</h2>
          <BarChart
            data={
              countries
                .sort((a, b) => b.views - a.views)
                .slice(0, 10) as unknown as Record<string, unknown>[]
            }
            xKey="country"
            series={[{ dataKey: "views", name: "Views", color: "#8b5cf6" }]}
            layout="horizontal"
            height={350}
          />
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <h2 className="mb-4 text-base font-semibold">
          Subscribers Gained vs Lost
        </h2>
        <AreaChart
          data={analytics as unknown as Record<string, unknown>[]}
          xKey="date"
          series={[
            {
              dataKey: "subscribersGained",
              name: "Gained",
              color: "#22c55e",
            },
            { dataKey: "subscribersLost", name: "Lost", color: "#ef4444" },
          ]}
        />
      </div>

      <div className="rounded-lg border bg-card p-4">
        <h2 className="mb-4 text-base font-semibold">Recent Videos</h2>
        {dataLoading ? (
          <div className="h-48 animate-pulse rounded bg-muted" />
        ) : (
          <VideoTable videos={videos} />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/analytics/youtube/page.tsx
git commit -m "feat: update YouTube tab to use hierarchy selection with aggregation"
```

---

### Task 9: Update Compare Tab

**Files:**
- Modify: `src/app/dashboard/analytics/compare/page.tsx`

At All Networks level, compare networks. At Network level, compare shows within that network.

- [ ] **Step 1: Rewrite compare/page.tsx**

Replace the full contents of `src/app/dashboard/analytics/compare/page.tsx`:

```typescript
"use client";

import { useEffect, useState } from "react";
import { useDateRange } from "@/components/analytics/date-range-provider";
import { useAnalyticsSelection } from "@/components/analytics/analytics-selection-provider";
import HierarchicalShowSelector from "@/components/analytics/hierarchical-show-selector";
import BarChart from "@/components/analytics/charts/bar-chart";
import AreaChart from "@/components/analytics/charts/area-chart";
import {
  fetchAccessibleShows,
  fetchCurrentUserRole,
  fetchPodcastAnalytics,
  fetchPodcastEpisodes,
  fetchAggregatedPodcastAnalytics,
  fetchAggregatedPodcastEpisodes,
} from "@/app/dashboard/analytics/actions";
import { formatNumber } from "@/lib/analytics/date-utils";
import { NETWORKS } from "@/lib/analytics/networks";
import type {
  TransistorAnalyticsPoint,
} from "@/lib/analytics/types";

const COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#a855f7",
  "#3b82f6",
  "#06b6d4",
  "#14b8a6",
  "#22c55e",
  "#eab308",
];

interface CompareItem {
  key: string;
  title: string;
  totalDownloads: number;
  episodeCount: number;
  avgPerEpisode: number;
  dailyData: TransistorAnalyticsPoint[];
}

export default function ComparePage() {
  const { from, to } = useDateRange();
  const {
    selection,
    showsInScope,
    accessibleShows,
    setAccessibleShows,
    setRole,
  } = useAnalyticsSelection();

  const [initialized, setInitialized] = useState(false);
  const [items, setItems] = useState<CompareItem[]>([]);
  const [dataLoading, setDataLoading] = useState(false);

  // Initialize
  useEffect(() => {
    if (accessibleShows.length > 0) {
      setInitialized(true);
      return;
    }
    Promise.all([fetchAccessibleShows(), fetchCurrentUserRole()]).then(
      ([shows, userRole]) => {
        setAccessibleShows(shows);
        setRole(userRole);
        setInitialized(true);
      }
    );
  }, [accessibleShows, setAccessibleShows, setRole]);

  // Fetch comparison data
  useEffect(() => {
    if (!initialized || showsInScope.length === 0) return;

    setDataLoading(true);
    const dateRange = { from, to };

    if (selection.level === "all") {
      // Compare networks against each other
      const networkTasks = NETWORKS.map(async (network) => {
        const networkShowIds = network.wpShowIds.filter((id) =>
          showsInScope.includes(id)
        );
        if (networkShowIds.length === 0)
          return null;

        const [dailyData, episodes] = await Promise.all([
          networkShowIds.length === 1
            ? fetchPodcastAnalytics(networkShowIds[0], dateRange)
            : fetchAggregatedPodcastAnalytics(networkShowIds, dateRange),
          networkShowIds.length === 1
            ? fetchPodcastEpisodes(networkShowIds[0])
            : fetchAggregatedPodcastEpisodes(networkShowIds),
        ]);

        const totalDownloads = dailyData.reduce(
          (sum, d) => sum + d.downloads,
          0
        );
        const episodeCount = episodes.length;

        return {
          key: network.slug,
          title: network.name,
          totalDownloads,
          episodeCount,
          avgPerEpisode:
            episodeCount > 0 ? Math.round(totalDownloads / episodeCount) : 0,
          dailyData,
        } satisfies CompareItem;
      });

      Promise.all(networkTasks).then((results) => {
        setItems(results.filter((r): r is CompareItem => r !== null));
        setDataLoading(false);
      });
    } else {
      // Compare individual shows (network level or show level fallback)
      const showIds =
        selection.level === "network"
          ? showsInScope
          : showsInScope;

      const showTasks = showIds.map(async (wpShowId) => {
        const show = accessibleShows.find((s) => s.wpShowId === wpShowId);
        const [dailyData, episodes] = await Promise.allSettled([
          fetchPodcastAnalytics(wpShowId, dateRange),
          fetchPodcastEpisodes(wpShowId),
        ]).then(([aResult, eResult]) => [
          aResult.status === "fulfilled" ? aResult.value : [],
          eResult.status === "fulfilled" ? eResult.value : [],
        ] as [TransistorAnalyticsPoint[], { length: number }[]]);

        const totalDownloads = dailyData.reduce(
          (sum, d) => sum + d.downloads,
          0
        );
        const episodeCount = (episodes as unknown[]).length;

        return {
          key: String(wpShowId),
          title: show?.title ?? `Show #${wpShowId}`,
          totalDownloads,
          episodeCount,
          avgPerEpisode:
            episodeCount > 0 ? Math.round(totalDownloads / episodeCount) : 0,
          dailyData,
        } satisfies CompareItem;
      });

      Promise.all(showTasks).then((results) => {
        setItems(results);
        setDataLoading(false);
      });
    }
  }, [initialized, selection, showsInScope, accessibleShows, from, to]);

  const buildBarData = () =>
    items.map((item) => ({
      name: item.title,
      downloads: item.totalDownloads,
    }));

  const buildStackedData = () => {
    const dateMap: Record<string, Record<string, number>> = {};
    items.forEach((item) => {
      item.dailyData.forEach((point) => {
        if (!dateMap[point.date]) dateMap[point.date] = {};
        dateMap[point.date][item.title] = point.downloads;
      });
    });

    return Object.entries(dateMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, values]) => {
        const entry: Record<string, string | number> = { date };
        items.forEach((item) => {
          entry[item.title] = values[item.title] || 0;
        });
        return entry;
      });
  };

  if (!initialized) {
    return <p className="text-muted-foreground">Loading...</p>;
  }

  const compareLabel =
    selection.level === "all" ? "Network Comparison" : "Show Comparison";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">{compareLabel}</h2>
        <HierarchicalShowSelector />
      </div>

      <div className="rounded-lg border bg-card p-4">
        <h3 className="mb-4 text-base font-semibold">Total Downloads</h3>
        {dataLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <BarChart
            data={buildBarData() as unknown as Record<string, unknown>[]}
            xKey="name"
            series={items.map((item, i) => ({
              dataKey: "downloads",
              name: item.title,
              color: COLORS[i % COLORS.length],
            }))}
            layout="vertical"
            height={Math.max(300, items.length * 60)}
          />
        )}
      </div>

      <div className="rounded-lg border bg-card p-4">
        <h3 className="mb-4 text-base font-semibold">Downloads Over Time</h3>
        {dataLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <AreaChart
            data={buildStackedData() as unknown as Record<string, unknown>[]}
            xKey="date"
            series={items.map((item, i) => ({
              dataKey: item.title,
              name: item.title,
              color: COLORS[i % COLORS.length],
            }))}
            stacked
            height={350}
          />
        )}
      </div>

      <div className="rounded-lg border bg-card p-4">
        <h3 className="mb-4 text-base font-semibold">Summary</h3>
        {dataLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="pb-2 font-medium">
                  {selection.level === "all" ? "Network" : "Show"}
                </th>
                <th className="pb-2 font-medium">Total Downloads</th>
                <th className="pb-2 font-medium">Episodes</th>
                <th className="pb-2 font-medium">Avg per Episode</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={item.key} className="border-b hover:bg-muted/50">
                  <td className="py-2">
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-block h-3 w-3 rounded-full shrink-0"
                        style={{
                          backgroundColor: COLORS[i % COLORS.length],
                        }}
                      />
                      {item.title}
                    </span>
                  </td>
                  <td className="py-2">{formatNumber(item.totalDownloads)}</td>
                  <td className="py-2">{formatNumber(item.episodeCount)}</td>
                  <td className="py-2">{formatNumber(item.avgPerEpisode)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/analytics/compare/page.tsx
git commit -m "feat: update Compare tab to compare networks at All level, shows at Network level"
```

---

### Task 10: Clean Up Deprecated Files

**Files:**
- Delete: `src/app/dashboard/analytics/network/` (entire directory)
- Delete: `src/components/analytics/network-picker.tsx`
- Delete: `src/components/analytics/show-selector.tsx`
- Modify: remove any remaining imports of deleted components

- [ ] **Step 1: Search for remaining imports of deleted components**

Run: `grep -r "network-picker\|NetworkPicker\|show-selector\|ShowSelector" src/ --include="*.tsx" --include="*.ts" -l`

This should show only files within the `network/` directory and possibly any we missed. All tab pages were rewritten in previous tasks and no longer import these.

- [ ] **Step 2: Delete the network directory and deprecated components**

```bash
rm -rf src/app/dashboard/analytics/network/
rm src/components/analytics/network-picker.tsx
rm src/components/analytics/show-selector.tsx
```

- [ ] **Step 3: Verify build still passes**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors from missing imports

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove deprecated network pages, NetworkPicker, and ShowSelector"
```

---

### Task 11: Build Verification and Manual Testing

**Files:** None (verification only)

- [ ] **Step 1: Run full build**

Run: `npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: All tests pass (including the new aggregation tests)

- [ ] **Step 3: Manual smoke test**

Start dev server (`npm run dev`) and verify:

1. `/dashboard/analytics` — Admin sees "All Networks" selected, full dashboard with aggregated data
2. Change selector to "Sunset Lounge DFW" — data filters to that network
3. Change selector to an individual show — existing single-show behavior
4. Navigate between tabs (Overview, Podcasts, YouTube, Compare) — selection persists
5. Compare tab at "All Networks" — shows network-vs-network comparison
6. Compare tab at a network — shows show-vs-show within network
7. Date range changes apply correctly at all levels

- [ ] **Step 4: Commit any fixes from smoke testing**

Only if issues were found in Step 3.
