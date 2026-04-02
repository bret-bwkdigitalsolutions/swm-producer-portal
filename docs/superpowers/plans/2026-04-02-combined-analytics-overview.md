# Combined Analytics Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the Analytics Overview page with cross-platform geography, platform distribution, and audience summary sections.

**Architecture:** Three new section components receive pre-fetched data as props from the Overview page. Country name normalization uses the browser's `Intl.DisplayNames` API. The existing `BarChart` component gains a `stacked` prop for the geo chart.

**Tech Stack:** React, Recharts (existing), Intl.DisplayNames API (built-in)

---

### Task 1: Add `stacked` prop to BarChart component

**Files:**
- Modify: `src/components/analytics/charts/bar-chart.tsx`

- [ ] **Step 1: Add `stacked` prop to the interface and apply `stackId` to Bar elements**

```tsx
// In bar-chart.tsx, update the interface:
interface BarChartProps {
  data: Record<string, unknown>[];
  xKey: string;
  series: Series[];
  layout?: "horizontal" | "vertical";
  height?: number;
  stacked?: boolean;
}

// Update the component signature to destructure:
export default function BarChart({
  data,
  xKey,
  series,
  layout = "vertical",
  height = 300,
  stacked = false,
}: BarChartProps) {

// Update the Bar rendering to add stackId when stacked:
{series.map((s) => (
  <Bar
    key={s.dataKey}
    dataKey={s.dataKey}
    name={s.name}
    fill={s.color}
    {...(stacked ? { stackId: "stack" } : {})}
  />
))}

// Also show Legend when stacked (change the condition):
{(series.length > 1 || stacked) && <Legend />}
```

- [ ] **Step 2: Verify the build passes**

Run: `npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/analytics/charts/bar-chart.tsx
git commit -m "feat: add stacked prop to BarChart component"
```

---

### Task 2: Create overview-geo-section component

**Files:**
- Create: `src/components/analytics/overview-geo-section.tsx`

- [ ] **Step 1: Create the component file**

This component receives podcast geo data (country names + downloads) and YouTube geo data (ISO codes + views), merges them by country, and renders a stacked horizontal bar chart + table.

```tsx
"use client";

import BarChart from "@/components/analytics/charts/bar-chart";
import ScrapedDataBadge from "@/components/analytics/scraped-data-badge";
import type { ScrapedGeoEntry } from "@/app/dashboard/analytics/actions";
import type { YouTubeCountryData } from "@/lib/analytics/types";

interface OverviewGeoSectionProps {
  podcastGeo: { data: ScrapedGeoEntry[]; scrapedAt: string | null };
  youtubeGeo: YouTubeCountryData[];
  podcastLoading: boolean;
  youtubeLoading: boolean;
}

function countryCodeToName(code: string): string {
  try {
    const displayNames = new Intl.DisplayNames(["en"], { type: "region" });
    return displayNames.of(code) ?? code;
  } catch {
    return code;
  }
}

interface MergedGeoRow {
  country: string;
  downloads: number;
  views: number;
  total: number;
}

function mergeGeoData(
  podcast: ScrapedGeoEntry[],
  youtube: YouTubeCountryData[]
): MergedGeoRow[] {
  const map = new Map<string, MergedGeoRow>();

  for (const entry of podcast) {
    const key = entry.country;
    const existing = map.get(key);
    if (existing) {
      existing.downloads += entry.downloads;
    } else {
      map.set(key, { country: key, downloads: entry.downloads, views: 0, total: 0 });
    }
  }

  for (const entry of youtube) {
    const name = countryCodeToName(entry.country);
    const existing = map.get(name);
    if (existing) {
      existing.views += entry.views;
    } else {
      map.set(name, { country: name, downloads: 0, views: entry.views, total: 0 });
    }
  }

  const rows = Array.from(map.values());
  for (const row of rows) {
    row.total = row.downloads + row.views;
  }
  return rows.sort((a, b) => b.total - a.total);
}

export default function OverviewGeoSection({
  podcastGeo,
  youtubeGeo,
  podcastLoading,
  youtubeLoading,
}: OverviewGeoSectionProps) {
  const loading = podcastLoading || youtubeLoading;

  if (!loading && podcastGeo.data.length === 0 && youtubeGeo.length === 0) {
    return null;
  }

  const merged = mergeGeoData(podcastGeo.data, youtubeGeo);
  const grandTotal = merged.reduce((sum, r) => sum + r.total, 0);
  const top10 = merged.slice(0, 10);

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold">Audience Geography</h2>
        <ScrapedDataBadge scrapedAt={podcastGeo.scrapedAt} />
      </div>

      {loading ? (
        <div className="h-[300px] animate-pulse rounded bg-muted" />
      ) : (
        <div className="space-y-4">
          <BarChart
            data={top10 as unknown as Record<string, unknown>[]}
            xKey="country"
            series={[
              { dataKey: "downloads", name: "Podcast Downloads", color: "#6366f1" },
              { dataKey: "views", name: "YouTube Views", color: "#f43f5e" },
            ]}
            layout="horizontal"
            height={Math.max(200, top10.length * 40)}
            stacked
          />
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 font-medium">Country</th>
                  <th className="pb-2 text-right font-medium">Downloads</th>
                  <th className="pb-2 text-right font-medium">Views</th>
                  <th className="pb-2 text-right font-medium">Total</th>
                  <th className="pb-2 text-right font-medium">%</th>
                </tr>
              </thead>
              <tbody>
                {merged.map((row, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-1.5">{row.country}</td>
                    <td className="py-1.5 text-right">
                      {row.downloads.toLocaleString()}
                    </td>
                    <td className="py-1.5 text-right">
                      {row.views.toLocaleString()}
                    </td>
                    <td className="py-1.5 text-right font-medium">
                      {row.total.toLocaleString()}
                    </td>
                    <td className="py-1.5 text-right text-muted-foreground">
                      {grandTotal > 0
                        ? `${((row.total / grandTotal) * 100).toFixed(1)}%`
                        : "\u2014"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify the build passes**

Run: `npm run build`
Expected: Build succeeds (component is not yet imported anywhere, but should compile).

- [ ] **Step 3: Commit**

```bash
git add src/components/analytics/overview-geo-section.tsx
git commit -m "feat: add OverviewGeoSection component for cross-platform geography"
```

---

### Task 3: Create overview-platforms-section component

**Files:**
- Create: `src/components/analytics/overview-platforms-section.tsx`

- [ ] **Step 1: Create the component file**

This component combines podcast app data with a synthetic YouTube entry into a single donut chart showing "where people experience the show."

```tsx
"use client";

import DonutChart from "@/components/analytics/charts/donut-chart";
import ScrapedDataBadge from "@/components/analytics/scraped-data-badge";
import type { ScrapedAppEntry } from "@/app/dashboard/analytics/actions";

interface OverviewPlatformsSectionProps {
  podcastApps: { data: ScrapedAppEntry[]; scrapedAt: string | null };
  youtubeTotalViews: number;
  podcastLoading: boolean;
  youtubeLoading: boolean;
}

interface PlatformRow {
  name: string;
  value: number;
}

function mergePlatformData(
  apps: ScrapedAppEntry[],
  ytViews: number
): PlatformRow[] {
  const rows: PlatformRow[] = apps.map((a) => ({
    name: a.appName,
    value: a.downloads,
  }));

  if (ytViews > 0) {
    rows.push({ name: "YouTube", value: ytViews });
  }

  return rows.sort((a, b) => b.value - a.value);
}

export default function OverviewPlatformsSection({
  podcastApps,
  youtubeTotalViews,
  podcastLoading,
  youtubeLoading,
}: OverviewPlatformsSectionProps) {
  const loading = podcastLoading || youtubeLoading;

  if (!loading && podcastApps.data.length === 0 && youtubeTotalViews === 0) {
    return null;
  }

  const merged = mergePlatformData(podcastApps.data, youtubeTotalViews);
  const grandTotal = merged.reduce((sum, r) => sum + r.value, 0);
  const donutData = merged.slice(0, 8);

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold">
          Where People Experience the Show
        </h2>
        <ScrapedDataBadge scrapedAt={podcastApps.scrapedAt} />
      </div>

      {loading ? (
        <div className="h-[300px] animate-pulse rounded bg-muted" />
      ) : (
        <div className="space-y-4">
          <DonutChart data={donutData} />
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 font-medium">Platform</th>
                  <th className="pb-2 text-right font-medium">
                    Listens / Views
                  </th>
                  <th className="pb-2 text-right font-medium">%</th>
                </tr>
              </thead>
              <tbody>
                {merged.map((row, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-1.5">{row.name}</td>
                    <td className="py-1.5 text-right">
                      {row.value.toLocaleString()}
                    </td>
                    <td className="py-1.5 text-right text-muted-foreground">
                      {grandTotal > 0
                        ? `${((row.value / grandTotal) * 100).toFixed(1)}%`
                        : "\u2014"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify the build passes**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/analytics/overview-platforms-section.tsx
git commit -m "feat: add OverviewPlatformsSection for cross-platform app distribution"
```

---

### Task 4: Create overview-audience-section component

**Files:**
- Create: `src/components/analytics/overview-audience-section.tsx`

- [ ] **Step 1: Create the component file**

This component displays combined subscriber counts and scraped average download metrics.

```tsx
"use client";

import { formatNumber } from "@/lib/analytics/date-utils";
import type { ScrapedOverviewData } from "@/app/dashboard/analytics/actions";
import type { YouTubeChannelStats } from "@/lib/analytics/types";

interface OverviewAudienceSectionProps {
  scrapedOverview: ScrapedOverviewData | null;
  ytChannel: YouTubeChannelStats | null;
  podcastLoading: boolean;
  youtubeLoading: boolean;
}

export default function OverviewAudienceSection({
  scrapedOverview,
  ytChannel,
  podcastLoading,
  youtubeLoading,
}: OverviewAudienceSectionProps) {
  const podSubs = scrapedOverview?.estimatedSubscribers ?? null;
  const ytSubs = ytChannel?.subscriberCount ?? null;
  const combinedAudience =
    podSubs != null || ytSubs != null ? (podSubs ?? 0) + (ytSubs ?? 0) : null;

  const loading = podcastLoading || youtubeLoading;

  const avgDownloads = [
    { label: "7-day avg", value: scrapedOverview?.avgDownloads7d },
    { label: "30-day avg", value: scrapedOverview?.avgDownloads30d },
    { label: "60-day avg", value: scrapedOverview?.avgDownloads60d },
    { label: "90-day avg", value: scrapedOverview?.avgDownloads90d },
  ];

  const hasAvgData = avgDownloads.some((d) => d.value != null);

  if (!loading && podSubs == null && ytSubs == null && !hasAvgData) {
    return null;
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <h2 className="mb-4 text-base font-semibold">Audience Summary</h2>

      {loading ? (
        <div className="h-24 animate-pulse rounded bg-muted" />
      ) : (
        <div className="space-y-4">
          {/* Subscriber counts */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">
                Podcast Subscribers
              </p>
              <p className="mt-1 text-2xl font-bold">
                {podSubs != null ? formatNumber(podSubs) : "\u2014"}
              </p>
              <p className="text-xs text-muted-foreground">Estimated</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">
                YouTube Subscribers
              </p>
              <p className="mt-1 text-2xl font-bold">
                {ytSubs != null ? formatNumber(ytSubs) : "\u2014"}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Combined Audience</p>
              <p className="mt-1 text-2xl font-bold">
                {combinedAudience != null
                  ? formatNumber(combinedAudience)
                  : "\u2014"}
              </p>
            </div>
          </div>

          {/* Average downloads */}
          {hasAvgData && (
            <div>
              <p className="mb-2 text-sm text-muted-foreground">
                Avg Downloads per Episode
              </p>
              <div className="grid grid-cols-4 gap-4">
                {avgDownloads.map((d) => (
                  <div
                    key={d.label}
                    className="rounded-lg border bg-muted/30 px-3 py-2 text-center"
                  >
                    <p className="text-lg font-semibold">
                      {d.value != null ? formatNumber(d.value) : "\u2014"}
                    </p>
                    <p className="text-xs text-muted-foreground">{d.label}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify the build passes**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/analytics/overview-audience-section.tsx
git commit -m "feat: add OverviewAudienceSection for combined subscriber metrics"
```

---

### Task 5: Wire up the Overview page to fetch additional data and render new sections

**Files:**
- Modify: `src/app/dashboard/analytics/page.tsx`

- [ ] **Step 1: Add imports for new components and actions**

Add these imports at the top of the file:

```tsx
import OverviewGeoSection from "@/components/analytics/overview-geo-section";
import OverviewPlatformsSection from "@/components/analytics/overview-platforms-section";
import OverviewAudienceSection from "@/components/analytics/overview-audience-section";
```

Add `fetchScrapedGeo`, `fetchScrapedApps`, and `fetchYouTubeGeo` to the existing actions import:

```tsx
import {
  fetchAccessibleShows,
  fetchCurrentUserRole,
  fetchPodcastAnalytics,
  fetchPodcastEpisodes,
  fetchYouTubeChannel,
  fetchYouTubeVideos,
  fetchYouTubeAnalytics,
  refreshAnalyticsCache,
  fetchScrapedOverview,
  fetchScrapedGeo,
  fetchScrapedApps,
  fetchYouTubeGeo,
} from "./actions";
import type { ScrapedOverviewData, ScrapedGeoEntry, ScrapedAppEntry } from "./actions";
```

Also import `YouTubeCountryData` from the types:

```tsx
import type {
  AccessibleShow,
  TransistorAnalyticsPoint,
  TransistorEpisode,
  YouTubeChannelStats,
  YouTubeVideo,
  YouTubeAnalyticsPoint,
  YouTubeCountryData,
} from "@/lib/analytics/types";
```

- [ ] **Step 2: Add state for geo, apps, and YouTube geo data**

Add after the existing `scrapedOverview` state:

```tsx
const [scrapedGeo, setScrapedGeo] = useState<{ data: ScrapedGeoEntry[]; scrapedAt: string | null }>({ data: [], scrapedAt: null });
const [scrapedApps, setScrapedApps] = useState<{ data: ScrapedAppEntry[]; scrapedAt: string | null }>({ data: [], scrapedAt: null });
const [ytGeo, setYtGeo] = useState<YouTubeCountryData[]>([]);
```

- [ ] **Step 3: Fetch scraped geo and apps in `loadPodcastData`**

Update the `loadPodcastData` callback to also fetch geo and apps. Replace the existing `loadPodcastData` with:

```tsx
const loadPodcastData = useCallback(
  async (wpShowId: number) => {
    setPodcastLoading(true);
    setPodcastError(false);
    try {
      const [analytics, episodes, overview] = await Promise.all([
        fetchPodcastAnalytics(wpShowId, { from, to }),
        fetchPodcastEpisodes(wpShowId),
        fetchScrapedOverview(wpShowId),
      ]);
      setPodcastData(analytics);
      setPodcastEpisodes(episodes);
      setScrapedOverview(overview);
    } catch {
      setPodcastError(true);
    } finally {
      setPodcastLoading(false);
    }

    // Fetch scraped geo/apps independently (don't block core analytics)
    fetchScrapedGeo(wpShowId).then(setScrapedGeo).catch(() => {});
    fetchScrapedApps(wpShowId).then(setScrapedApps).catch(() => {});
  },
  [from, to]
);
```

- [ ] **Step 4: Fetch YouTube geo in `loadYouTubeData`**

Update the `loadYouTubeData` callback to also fetch geo. Replace the existing `loadYouTubeData` with:

```tsx
const loadYouTubeData = useCallback(
  async (wpShowId: number) => {
    setYtLoading(true);
    setYtError(false);
    try {
      const [channel, videos, analytics, geo] = await Promise.all([
        fetchYouTubeChannel(wpShowId),
        fetchYouTubeVideos(wpShowId),
        fetchYouTubeAnalytics(wpShowId, { from, to }),
        fetchYouTubeGeo(wpShowId, { from, to }),
      ]);
      setYtChannel(channel);
      setYtVideos(videos);
      setYtAnalytics(analytics);
      setYtGeo(geo);
    } catch {
      setYtError(true);
    } finally {
      setYtLoading(false);
    }
  },
  [from, to]
);
```

- [ ] **Step 5: Render the three new sections below the existing tables**

Add after the closing `</div>` of the "Tables" grid (after the Top Videos card), before the final closing `</div>`:

```tsx
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
```

- [ ] **Step 6: Verify the build passes**

Run: `npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 7: Verify in the browser**

Run: `npm run dev`
Navigate to `/dashboard/analytics?show=<a valid wpShowId>` and verify:
- Audience Summary card shows podcast + YouTube subscriber counts and avg download stats
- Geography card shows stacked bar chart and merged table
- Platforms card shows donut chart combining podcast apps with YouTube

- [ ] **Step 8: Commit**

```bash
git add src/app/dashboard/analytics/page.tsx
git commit -m "feat: wire up combined analytics sections on Overview page"
```
