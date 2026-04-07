# YouTube Demographics & Audience Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add age/gender demographics, subscription status, device types, content type breakdown, and thumbnail CTR metrics to the YouTube analytics tab.

**Architecture:** 4 new YouTube Analytics API functions following the existing `fetchAnalyticsApi` pattern, plus extending the existing channel analytics call for thumbnail metrics. New aggregation functions for multi-show views. UI sections added to the YouTube page using existing chart components (BarChart, DonutChart, StatCard).

**Tech Stack:** YouTube Analytics API v2, React/Recharts charts, Next.js server actions

---

### Task 1: Add Type Definitions

**Files:**
- Modify: `src/lib/analytics/types.ts:104` (after `YouTubeCountryData`)

- [ ] **Step 1: Add 4 new interfaces to types.ts**

Add after the `YouTubeCountryData` interface (line 104):

```typescript
export interface YouTubeDemographic {
  ageGroup: string;
  gender: string;
  viewerPercentage: number;
}

export interface YouTubeSubscriptionStatus {
  status: string;
  views: number;
  estimatedMinutesWatched: number;
}

export interface YouTubeDeviceType {
  deviceType: string;
  views: number;
  estimatedMinutesWatched: number;
}

export interface YouTubeContentType {
  contentType: string;
  views: number;
  estimatedMinutesWatched: number;
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/analytics/types.ts
git commit -m "feat: add YouTube demographic type definitions"
```

---

### Task 2: Add YouTube API Functions

**Files:**
- Modify: `src/lib/analytics/youtube.ts:388` (after `getYouTubeGeoAnalytics`)

- [ ] **Step 1: Add `getYouTubeDemographics` function**

Add after line 388 (end of `getYouTubeGeoAnalytics`):

```typescript
export async function getYouTubeDemographics(
  wpShowId: number,
  dateRange: DateRange
): Promise<YouTubeDemographic[]> {
  const accessToken = await requireAccessToken(wpShowId);

  return getCached(
    `analytics:youtube:${wpShowId}:demographics:${dateRange.from}:${dateRange.to}`,
    21600,
    async () => {
      const data = await fetchAnalyticsApi(accessToken, {
        metrics: "viewerPercentage",
        dimensions: "ageGroup,gender",
        startDate: dateRange.from,
        endDate: dateRange.to,
      });

      return (data.rows || []).map((row: (string | number)[]) => ({
        ageGroup: row[0] as string,
        gender: row[1] as string,
        viewerPercentage: row[2] as number,
      }));
    }
  );
}
```

Add the import for `YouTubeDemographic` at the top of the file alongside the existing type imports.

- [ ] **Step 2: Add `getYouTubeSubscriptionStatus` function**

```typescript
export async function getYouTubeSubscriptionStatus(
  wpShowId: number,
  dateRange: DateRange
): Promise<YouTubeSubscriptionStatus[]> {
  const accessToken = await requireAccessToken(wpShowId);

  return getCached(
    `analytics:youtube:${wpShowId}:subscription:${dateRange.from}:${dateRange.to}`,
    21600,
    async () => {
      const data = await fetchAnalyticsApi(accessToken, {
        metrics: "views,estimatedMinutesWatched",
        dimensions: "subscribedStatus",
        startDate: dateRange.from,
        endDate: dateRange.to,
      });

      return (data.rows || []).map((row: (string | number)[]) => ({
        status: row[0] as string,
        views: row[1] as number,
        estimatedMinutesWatched: row[2] as number,
      }));
    }
  );
}
```

- [ ] **Step 3: Add `getYouTubeDeviceTypes` function**

```typescript
export async function getYouTubeDeviceTypes(
  wpShowId: number,
  dateRange: DateRange
): Promise<YouTubeDeviceType[]> {
  const accessToken = await requireAccessToken(wpShowId);

  return getCached(
    `analytics:youtube:${wpShowId}:devices:${dateRange.from}:${dateRange.to}`,
    21600,
    async () => {
      const data = await fetchAnalyticsApi(accessToken, {
        metrics: "views,estimatedMinutesWatched",
        dimensions: "deviceType",
        startDate: dateRange.from,
        endDate: dateRange.to,
      });

      return (data.rows || []).map((row: (string | number)[]) => ({
        deviceType: row[0] as string,
        views: row[1] as number,
        estimatedMinutesWatched: row[2] as number,
      }));
    }
  );
}
```

- [ ] **Step 4: Add `getYouTubeContentTypes` function**

```typescript
export async function getYouTubeContentTypes(
  wpShowId: number,
  dateRange: DateRange
): Promise<YouTubeContentType[]> {
  const accessToken = await requireAccessToken(wpShowId);

  return getCached(
    `analytics:youtube:${wpShowId}:content-types:${dateRange.from}:${dateRange.to}`,
    21600,
    async () => {
      const data = await fetchAnalyticsApi(accessToken, {
        metrics: "views,estimatedMinutesWatched",
        dimensions: "creatorContentType",
        startDate: dateRange.from,
        endDate: dateRange.to,
      });

      return (data.rows || []).map((row: (string | number)[]) => ({
        contentType: row[0] as string,
        views: row[1] as number,
        estimatedMinutesWatched: row[2] as number,
      }));
    }
  );
}
```

- [ ] **Step 5: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/lib/analytics/youtube.ts
git commit -m "feat: add YouTube demographics, subscription, device, content type API functions"
```

---

### Task 3: Add Aggregation Functions

**Files:**
- Modify: `src/lib/analytics/aggregation.ts:289` (after `mergeVideos`)

- [ ] **Step 1: Add imports for new types**

Add to the existing import from `@/lib/analytics/types`:

```typescript
import type {
  // ... existing imports ...
  YouTubeDemographic,
  YouTubeSubscriptionStatus,
  YouTubeDeviceType,
  YouTubeContentType,
} from "@/lib/analytics/types";
```

- [ ] **Step 2: Add 4 aggregation functions after `mergeVideos` (line 289)**

```typescript
export function aggregateYouTubeDemographics(
  allDemos: YouTubeDemographic[][]
): YouTubeDemographic[] {
  const showCount = allDemos.filter((d) => d.length > 0).length;
  if (showCount === 0) return [];

  const keyMap = new Map<string, number>();
  for (const demos of allDemos) {
    for (const d of demos) {
      const key = `${d.ageGroup}|${d.gender}`;
      keyMap.set(key, (keyMap.get(key) ?? 0) + d.viewerPercentage);
    }
  }

  return Array.from(keyMap.entries()).map(([key, total]) => {
    const [ageGroup, gender] = key.split("|");
    return { ageGroup, gender, viewerPercentage: total / showCount };
  });
}

export function aggregateYouTubeSubscription(
  allSubs: YouTubeSubscriptionStatus[][]
): YouTubeSubscriptionStatus[] {
  const statusMap = new Map<string, { views: number; minutes: number }>();
  for (const subs of allSubs) {
    for (const s of subs) {
      const existing = statusMap.get(s.status);
      if (existing) {
        existing.views += s.views;
        existing.minutes += s.estimatedMinutesWatched;
      } else {
        statusMap.set(s.status, {
          views: s.views,
          minutes: s.estimatedMinutesWatched,
        });
      }
    }
  }
  return Array.from(statusMap.entries()).map(([status, { views, minutes }]) => ({
    status,
    views,
    estimatedMinutesWatched: minutes,
  }));
}

export function aggregateYouTubeDevices(
  allDevices: YouTubeDeviceType[][]
): YouTubeDeviceType[] {
  const deviceMap = new Map<string, { views: number; minutes: number }>();
  for (const devices of allDevices) {
    for (const d of devices) {
      const existing = deviceMap.get(d.deviceType);
      if (existing) {
        existing.views += d.views;
        existing.minutes += d.estimatedMinutesWatched;
      } else {
        deviceMap.set(d.deviceType, {
          views: d.views,
          minutes: d.estimatedMinutesWatched,
        });
      }
    }
  }
  return Array.from(deviceMap.entries())
    .sort(([, a], [, b]) => b.views - a.views)
    .map(([deviceType, { views, minutes }]) => ({
      deviceType,
      views,
      estimatedMinutesWatched: minutes,
    }));
}

export function aggregateYouTubeContentTypes(
  allTypes: YouTubeContentType[][]
): YouTubeContentType[] {
  const typeMap = new Map<string, { views: number; minutes: number }>();
  for (const types of allTypes) {
    for (const t of types) {
      const existing = typeMap.get(t.contentType);
      if (existing) {
        existing.views += t.views;
        existing.minutes += t.estimatedMinutesWatched;
      } else {
        typeMap.set(t.contentType, {
          views: t.views,
          minutes: t.estimatedMinutesWatched,
        });
      }
    }
  }
  return Array.from(typeMap.entries())
    .sort(([, a], [, b]) => b.views - a.views)
    .map(([contentType, { views, minutes }]) => ({
      contentType,
      views,
      estimatedMinutesWatched: minutes,
    }));
}
```

- [ ] **Step 3: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/lib/analytics/aggregation.ts
git commit -m "feat: add aggregation functions for YouTube demographics, subscription, devices, content types"
```

---

### Task 4: Add Server Actions

**Files:**
- Modify: `src/app/dashboard/analytics/actions.ts`

- [ ] **Step 1: Add imports for new API functions and types**

Add to the existing imports from `@/lib/analytics/youtube`:

```typescript
import {
  // ... existing imports ...
  getYouTubeDemographics,
  getYouTubeSubscriptionStatus,
  getYouTubeDeviceTypes,
  getYouTubeContentTypes,
} from "@/lib/analytics/youtube";
```

Add to the existing imports from `@/lib/analytics/types`:

```typescript
import type {
  // ... existing imports ...
  YouTubeDemographic,
  YouTubeSubscriptionStatus,
  YouTubeDeviceType,
  YouTubeContentType,
} from "@/lib/analytics/types";
```

Add to the existing imports from `@/lib/analytics/aggregation`:

```typescript
import {
  // ... existing imports ...
  aggregateYouTubeDemographics,
  aggregateYouTubeSubscription,
  aggregateYouTubeDevices,
  aggregateYouTubeContentTypes,
} from "@/lib/analytics/aggregation";
```

- [ ] **Step 2: Add 4 single-show fetch actions**

Add after `fetchYouTubeGeo` (around line 159):

```typescript
export async function fetchYouTubeDemographics(
  wpShowId: number,
  dateRange: DateRange
): Promise<YouTubeDemographic[]> {
  await requireShowAccess(wpShowId);
  return getYouTubeDemographics(wpShowId, dateRange);
}

export async function fetchYouTubeSubscription(
  wpShowId: number,
  dateRange: DateRange
): Promise<YouTubeSubscriptionStatus[]> {
  await requireShowAccess(wpShowId);
  return getYouTubeSubscriptionStatus(wpShowId, dateRange);
}

export async function fetchYouTubeDevices(
  wpShowId: number,
  dateRange: DateRange
): Promise<YouTubeDeviceType[]> {
  await requireShowAccess(wpShowId);
  return getYouTubeDeviceTypes(wpShowId, dateRange);
}

export async function fetchYouTubeContentTypes(
  wpShowId: number,
  dateRange: DateRange
): Promise<YouTubeContentType[]> {
  await requireShowAccess(wpShowId);
  return getYouTubeContentTypes(wpShowId, dateRange);
}
```

- [ ] **Step 3: Add 4 aggregated fetch actions**

Add after `fetchAggregatedYouTubeGeo` (around line 425):

```typescript
export async function fetchAggregatedYouTubeDemographics(
  wpShowIds: number[],
  dateRange: DateRange
): Promise<YouTubeDemographic[]> {
  const allDemos = await throttledMap(wpShowIds, (id) =>
    getYouTubeDemographics(id, dateRange)
  );
  return aggregateYouTubeDemographics(allDemos);
}

export async function fetchAggregatedYouTubeSubscription(
  wpShowIds: number[],
  dateRange: DateRange
): Promise<YouTubeSubscriptionStatus[]> {
  const allSubs = await throttledMap(wpShowIds, (id) =>
    getYouTubeSubscriptionStatus(id, dateRange)
  );
  return aggregateYouTubeSubscription(allSubs);
}

export async function fetchAggregatedYouTubeDevices(
  wpShowIds: number[],
  dateRange: DateRange
): Promise<YouTubeDeviceType[]> {
  const allDevices = await throttledMap(wpShowIds, (id) =>
    getYouTubeDeviceTypes(id, dateRange)
  );
  return aggregateYouTubeDevices(allDevices);
}

export async function fetchAggregatedYouTubeContentTypes(
  wpShowIds: number[],
  dateRange: DateRange
): Promise<YouTubeContentType[]> {
  const allTypes = await throttledMap(wpShowIds, (id) =>
    getYouTubeContentTypes(id, dateRange)
  );
  return aggregateYouTubeContentTypes(allTypes);
}
```

- [ ] **Step 4: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/analytics/actions.ts
git commit -m "feat: add server actions for YouTube demographics, subscription, devices, content types"
```

---

### Task 5: Add UI Sections to YouTube Page

**Files:**
- Modify: `src/app/dashboard/analytics/youtube/page.tsx`

- [ ] **Step 1: Add imports**

Add to the existing action imports:

```typescript
import {
  // ... existing imports ...
  fetchYouTubeDemographics,
  fetchYouTubeSubscription,
  fetchYouTubeDevices,
  fetchYouTubeContentTypes,
  fetchAggregatedYouTubeDemographics,
  fetchAggregatedYouTubeSubscription,
  fetchAggregatedYouTubeDevices,
  fetchAggregatedYouTubeContentTypes,
} from "@/app/dashboard/analytics/actions";
```

Add to the existing type imports:

```typescript
import type {
  // ... existing imports ...
  YouTubeDemographic,
  YouTubeSubscriptionStatus,
  YouTubeDeviceType,
  YouTubeContentType,
} from "@/lib/analytics/types";
```

- [ ] **Step 2: Add state variables**

Add after the existing state declarations (around line 50):

```typescript
const [demographics, setDemographics] = useState<YouTubeDemographic[]>([]);
const [subscriptionStatus, setSubscriptionStatus] = useState<YouTubeSubscriptionStatus[]>([]);
const [deviceTypes, setDeviceTypes] = useState<YouTubeDeviceType[]>([]);
const [contentTypes, setContentTypes] = useState<YouTubeContentType[]>([]);
```

- [ ] **Step 3: Add data fetching to the date-dependent useEffect**

In the `useEffect` that fetches date-dependent data (starting at line 91), update the fetches array and destructuring. Replace the existing `Promise.all(fetches).then(...)` block with:

```typescript
    const fetches = Promise.all([
      isSingle
        ? fetchYouTubeAnalytics(showsInScope[0], dateRange)
        : fetchAggregatedYouTubeAnalytics(showsInScope, dateRange),
      isSingle
        ? fetchYouTubeTraffic(showsInScope[0], dateRange)
        : Promise.resolve([]),
      isSingle
        ? fetchYouTubeGeo(showsInScope[0], dateRange)
        : fetchAggregatedYouTubeGeo(showsInScope, dateRange),
      isSingle
        ? fetchYouTubeDemographics(showsInScope[0], dateRange)
        : fetchAggregatedYouTubeDemographics(showsInScope, dateRange),
      isSingle
        ? fetchYouTubeSubscription(showsInScope[0], dateRange)
        : fetchAggregatedYouTubeSubscription(showsInScope, dateRange),
      isSingle
        ? fetchYouTubeDevices(showsInScope[0], dateRange)
        : fetchAggregatedYouTubeDevices(showsInScope, dateRange),
      isSingle
        ? fetchYouTubeContentTypes(showsInScope[0], dateRange)
        : fetchAggregatedYouTubeContentTypes(showsInScope, dateRange),
    ]);

    fetches.then(([analyticsData, trafficData, geoData, demosData, subsData, devicesData, contentData]) => {
      setAnalytics(analyticsData);
      setTrafficSources(trafficData);
      setCountries(geoData);
      setDemographics(demosData);
      setSubscriptionStatus(subsData);
      setDeviceTypes(devicesData);
      setContentTypes(contentData);
      setDateLoading(false);
    });
```

- [ ] **Step 4: Add demographic chart helper and UI sections**

Add before the `return` statement, after the `dataLoading` const:

```typescript
  // Transform demographics for stacked bar chart
  const AGE_LABELS: Record<string, string> = {
    "age13-17": "13-17",
    "age18-24": "18-24",
    "age25-34": "25-34",
    "age35-44": "35-44",
    "age45-54": "45-54",
    "age55-64": "55-64",
    "age65-": "65+",
  };

  const GENDER_LABELS: Record<string, string> = {
    male: "Male",
    female: "Female",
    user_specified: "Other",
  };

  const DEVICE_LABELS: Record<string, string> = {
    DESKTOP: "Desktop",
    MOBILE: "Mobile",
    TABLET: "Tablet",
    TV: "TV",
    GAME_CONSOLE: "Console",
    UNKNOWN_PLATFORM: "Other",
  };

  const CONTENT_TYPE_LABELS: Record<string, string> = {
    SHORTS: "Shorts",
    VIDEO_ON_DEMAND: "Videos",
    LIVE_STREAM: "Live",
    UNSPECIFIED: "Other",
  };

  const demoChartData = Object.keys(AGE_LABELS).map((ageGroup) => {
    const row: Record<string, unknown> = { ageGroup: AGE_LABELS[ageGroup] };
    for (const d of demographics) {
      if (d.ageGroup === ageGroup) {
        row[GENDER_LABELS[d.gender] ?? d.gender] = d.viewerPercentage;
      }
    }
    return row;
  });
```

- [ ] **Step 5: Add UI sections to the JSX**

Add after the "Recent Videos" section (before the closing `</div>` of the page), before line 269:

```tsx
      {/* Audience Demographics */}
      {demographics.length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <h2 className="mb-4 text-base font-semibold">Audience Demographics</h2>
          <BarChart
            data={demoChartData as Record<string, unknown>[]}
            xKey="ageGroup"
            series={[
              { dataKey: "Male", name: "Male", color: "#6366f1" },
              { dataKey: "Female", name: "Female", color: "#ec4899" },
              { dataKey: "Other", name: "Other", color: "#a3a3a3" },
            ]}
            stacked
            height={300}
          />
        </div>
      )}

      {/* Subscription, Devices, Content Types — 3-column donut row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {subscriptionStatus.length > 0 && (
          <div className="rounded-lg border bg-card p-4">
            <h2 className="mb-4 text-base font-semibold">Subscription Status</h2>
            <DonutChart
              data={subscriptionStatus.map((s) => ({
                name: s.status === "SUBSCRIBED" ? "Subscribed" : "Not Subscribed",
                value: s.views,
              }))}
            />
          </div>
        )}

        {deviceTypes.length > 0 && (
          <div className="rounded-lg border bg-card p-4">
            <h2 className="mb-4 text-base font-semibold">Device Types</h2>
            <DonutChart
              data={deviceTypes.map((d) => ({
                name: DEVICE_LABELS[d.deviceType] ?? d.deviceType,
                value: d.views,
              }))}
            />
          </div>
        )}

        {contentTypes.length > 0 && (
          <div className="rounded-lg border bg-card p-4">
            <h2 className="mb-4 text-base font-semibold">Content Types</h2>
            <DonutChart
              data={contentTypes
                .filter((c) => c.views > 0)
                .map((c) => ({
                  name: CONTENT_TYPE_LABELS[c.contentType] ?? c.contentType,
                  value: c.views,
                }))}
            />
          </div>
        )}
      </div>
```

- [ ] **Step 6: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/app/dashboard/analytics/youtube/page.tsx
git commit -m "feat: add demographics, subscription, devices, content type sections to YouTube analytics"
```

---

### Task 6: Build and Push

**Files:** None (deployment)

- [ ] **Step 1: Run full build**

Run: `npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 2: Push to staging and production**

```bash
git push origin main
git checkout production && git merge main && git push origin production && git checkout main
```
