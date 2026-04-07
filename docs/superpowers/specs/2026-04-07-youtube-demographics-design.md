# YouTube Demographics & Audience Analytics

## Overview

Add demographic and audience breakdowns to the YouTube analytics tab: age/gender, subscription status, device types, content types (Shorts vs VOD vs Live), and thumbnail performance metrics. All sections are date-range aware and support both single-show and multi-show aggregated views.

## Data Layer

### New API Functions (`src/lib/analytics/youtube.ts`)

All follow the existing `fetchAnalyticsApi` pattern with 6-hour cache TTL.

**1. `getYouTubeDemographics(wpShowId, dateRange)`**
- Endpoint: YouTube Analytics API
- Dimensions: `ageGroup,gender`
- Metrics: `viewerPercentage`
- Returns: `YouTubeDemographic[]`
- Cache key: `analytics:youtube:{wpShowId}:demographics:{from}:{to}`

**2. `getYouTubeSubscriptionStatus(wpShowId, dateRange)`**
- Dimensions: `subscribedStatus`
- Metrics: `views,estimatedMinutesWatched`
- Returns: `YouTubeSubscriptionStatus[]`
- Cache key: `analytics:youtube:{wpShowId}:subscription:{from}:{to}`

**3. `getYouTubeDeviceTypes(wpShowId, dateRange)`**
- Dimensions: `deviceType`
- Metrics: `views,estimatedMinutesWatched`
- Returns: `YouTubeDeviceType[]`
- Cache key: `analytics:youtube:{wpShowId}:devices:{from}:{to}`

**4. `getYouTubeContentTypes(wpShowId, dateRange)`**
- Dimensions: `creatorContentType`
- Metrics: `views,estimatedMinutesWatched`
- Returns: `YouTubeContentType[]`
- Cache key: `analytics:youtube:{wpShowId}:content-types:{from}:{to}`

**5. Thumbnail metrics** — added to existing `getYouTubeChannelAnalytics`:
- Add metrics: `videoThumbnailImpressions,videoThumbnailImpressionsClickRate`
- These are returned as additional fields on the existing `YouTubeAnalyticsPoint` interface.

### New Type Definitions (`src/lib/analytics/types.ts`)

```typescript
export interface YouTubeDemographic {
  ageGroup: string;   // "age13-17", "age18-24", "age25-34", "age35-44", "age45-54", "age55-64", "age65-"
  gender: string;     // "female", "male", "user_specified"
  viewerPercentage: number;
}

export interface YouTubeSubscriptionStatus {
  status: string;     // "SUBSCRIBED", "UNSUBSCRIBED"
  views: number;
  estimatedMinutesWatched: number;
}

export interface YouTubeDeviceType {
  deviceType: string; // "DESKTOP", "MOBILE", "TABLET", "TV", "GAME_CONSOLE", etc.
  views: number;
  estimatedMinutesWatched: number;
}

export interface YouTubeContentType {
  contentType: string; // "SHORTS", "VIDEO_ON_DEMAND", "LIVE_STREAM", etc.
  views: number;
  estimatedMinutesWatched: number;
}
```

Extend existing `YouTubeAnalyticsPoint`:
```typescript
export interface YouTubeAnalyticsPoint {
  // ... existing fields ...
  thumbnailImpressions?: number;
  thumbnailClickRate?: number;
}
```

### Aggregation (`src/lib/analytics/aggregation.ts`)

**Demographics**: Weighted average — when aggregating across shows, average the `viewerPercentage` values by ageGroup+gender key. Since each show's percentages sum to 100%, a simple average across shows gives a reasonable approximation.

**Subscription status, device types, content types**: Sum `views` and `estimatedMinutesWatched` by key, same pattern as existing `aggregateYouTubeGeo`.

**Thumbnail metrics**: Sum impressions across shows. Average CTR weighted by impressions.

### Server Actions (`src/app/dashboard/analytics/actions.ts`)

Add 4 new single-show fetch functions + 4 aggregated fetch functions following the existing pattern:

- `fetchYouTubeDemographics(wpShowId, dateRange)` / `fetchAggregatedYouTubeDemographics(wpShowIds, dateRange)`
- `fetchYouTubeSubscription(wpShowId, dateRange)` / `fetchAggregatedYouTubeSubscription(wpShowIds, dateRange)`
- `fetchYouTubeDevices(wpShowId, dateRange)` / `fetchAggregatedYouTubeDevices(wpShowIds, dateRange)`
- `fetchYouTubeContentTypes(wpShowId, dateRange)` / `fetchAggregatedYouTubeContentTypes(wpShowIds, dateRange)`

Thumbnail metrics come through the existing analytics fetch (no new action needed).

## UI Components

### YouTube Tab (`src/app/dashboard/analytics/youtube/page.tsx`)

New sections added below existing content, in this order:

**1. Thumbnail Performance** — 2 stat cards in a row
- "Impressions" — total `thumbnailImpressions` for the period
- "Click-Through Rate" — average `thumbnailClickRate` formatted as percentage

**2. Audience Demographics** — Stacked bar chart
- X-axis: age groups (labeled "13-17", "18-24", "25-34", "35-44", "45-54", "55-64", "65+")
- Stacked bars: male, female, other segments per age group
- Colors: 3 distinct colors for gender segments
- Y-axis: viewer percentage
- Uses existing `BarChart` component with `stacked={true}`

**3. Subscription Status** — Donut chart
- Two segments: Subscribed vs Unsubscribed
- Values: view counts (not percentages — let the donut show the proportion)
- Uses existing `DonutChart` component

**4. Device Types** — Donut chart
- Segments: Desktop, Mobile, Tablet, TV, Other (collapse rare types into "Other")
- Values: view counts
- Uses existing `DonutChart` component

**5. Content Types** — Donut chart
- Segments: Shorts, Video on Demand, Live Stream (only show segments with data)
- Values: view counts
- Human-readable labels: "SHORTS" → "Shorts", "VIDEO_ON_DEMAND" → "Videos", "LIVE_STREAM" → "Live"
- Uses existing `DonutChart` component

### Layout

All new sections use the same card styling as existing sections (`rounded-lg border bg-card p-4` with `h2` heading). The three donut charts sit in a 3-column grid row. Demographics stacked bar chart gets a full-width row. Thumbnail stat cards sit in a 2-column row.

### State Management

Add new state variables to the YouTube page component:
- `demographics: YouTubeDemographic[]`
- `subscriptionStatus: YouTubeSubscriptionStatus[]`
- `deviceTypes: YouTubeDeviceType[]`
- `contentTypes: YouTubeContentType[]`

These load alongside the existing date-dependent data (analytics, traffic, geo) in the same `useEffect`, using the same single-show vs aggregated branching logic.

### Error Handling

Each new API call is non-fatal. If demographics or device data fails to load, the section shows "Data not available" rather than breaking the page. This matches how traffic sources already handle errors (single-show only, hidden when aggregated).

## Files Modified

| File | Change |
|---|---|
| `src/lib/analytics/youtube.ts` | Add 4 new API functions, extend channel analytics metrics |
| `src/lib/analytics/types.ts` | Add 4 new interfaces, extend `YouTubeAnalyticsPoint` |
| `src/lib/analytics/aggregation.ts` | Add 4 new aggregation functions |
| `src/app/dashboard/analytics/actions.ts` | Add 8 new server actions (4 single + 4 aggregated) |
| `src/app/dashboard/analytics/youtube/page.tsx` | Add state, data loading, and 5 new UI sections |

No new files needed. No database changes. No new dependencies.
