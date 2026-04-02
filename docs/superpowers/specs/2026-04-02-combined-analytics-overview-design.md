# Combined Analytics Overview

Expand the Analytics Overview page into a comprehensive cross-platform dashboard by adding geography, platform distribution, and audience summary sections below the existing content.

## Current State

The Overview page shows:
1. Header with show selector and refresh button
2. Four stat cards (Total Downloads, Est. Subscribers, YouTube Views, Watch Hours)
3. Two time series charts (Podcast Downloads, YouTube Views) side-by-side
4. Two content tables (Top Episodes, Top Videos) side-by-side

## New Sections

Three new sections added below the existing content.

### Section 5: Audience Geography

A card showing combined reach across podcast and YouTube by country.

**Chart:** Horizontal stacked bar chart, top 10 countries by total reach. Each bar segmented into podcast downloads (indigo) and YouTube views (rose) so the platform contribution is visible at a glance.

**Table:** Below the chart, a scrollable table showing all countries with columns: Country, Downloads, Views, Total, % of Total. Sorted by total descending.

**Data merge logic:**
- Podcast geo comes from `fetchScrapedGeo` with full country names ("United States")
- YouTube geo comes from `fetchYouTubeGeo` with ISO codes ("US")
- Normalize YouTube codes to full names using `Intl.DisplayNames` for matching
- Merged shape: `{ country: string, downloads: number, views: number, total: number }`
- Countries appearing in only one source get 0 for the other

**Freshness:** Show `ScrapedDataBadge` for the podcast data timestamp. YouTube data is date-range-dependent (already reflected in the date picker).

### Section 6: Where People Experience the Show

A card showing audience distribution across all platforms/apps as a single donut chart.

**Chart:** Donut chart using the existing `DonutChart` component. Slices represent each platform where people consume the show.

**Data merge logic:**
- Podcast app entries from `fetchScrapedApps` (Spotify, Apple Podcasts, Overcast, etc.) with their download counts
- One synthetic "YouTube" entry added with value = total YouTube views for the selected date range
- All entries combined into a single array, sorted by value descending, top 8 shown in the donut
- Metric label: "Listens / Views"

**Table:** Below the donut, a table with columns: Platform, Listens/Views, %. Showing all entries.

### Section 7: Audience Summary

A card with combined subscriber and engagement metrics.

**Top row:** Three values displayed as compact stats:
- Est. Podcast Subscribers (from `scrapedOverview.estimatedSubscribers`)
- YouTube Subscribers (from `ytChannel.subscriberCount`)
- Combined Audience (sum of both)

**Bottom row:** Scraped average download metrics as small stat indicators:
- Avg Downloads 7d, 30d, 60d, 90d (from `scrapedOverview.avgDownloads7d/30d/60d/90d`)

## Architecture

### New Components

Three new files in `src/components/analytics/`:

1. **`overview-geo-section.tsx`** — Receives podcast geo data, YouTube geo data, and loading states. Handles the country name normalization and merge. Renders the stacked bar chart and table.

2. **`overview-platforms-section.tsx`** — Receives podcast app data, YouTube total views, and loading states. Merges into a single platform distribution. Renders the donut chart and table.

3. **`overview-audience-section.tsx`** — Receives scraped overview data, YouTube channel stats, and loading states. Renders the subscriber counts and average download stats.

### Data Flow

The Overview page (`src/app/dashboard/analytics/page.tsx`) is responsible for fetching all data. Changes:

- Add `fetchScrapedGeo`, `fetchScrapedApps` to the `loadPodcastData` callback (alongside existing `fetchScrapedOverview`)
- Pass fetched data as props to the three new section components
- No new server actions needed; all required actions already exist

### Country Name Normalization

YouTube returns ISO 3166-1 alpha-2 codes. Use the browser's `Intl.DisplayNames` API to convert:

```typescript
const displayNames = new Intl.DisplayNames(["en"], { type: "region" });
const name = displayNames.of("US"); // "United States"
```

This runs client-side in the geo section component. No external dependency needed.

### Stacked Bar Chart

The existing `BarChart` component renders a single series per bar. For stacked bars (downloads + views segments), pass two series entries. Recharts supports stacking via `stackId` on `<Bar>`. Add an optional `stacked` prop to the existing `BarChart` component.

## Files to Create

- `src/components/analytics/overview-geo-section.tsx`
- `src/components/analytics/overview-platforms-section.tsx`
- `src/components/analytics/overview-audience-section.tsx`

## Files to Modify

- `src/app/dashboard/analytics/page.tsx` — fetch additional scraped data, render new sections
- `src/components/analytics/charts/bar-chart.tsx` — add optional `stacked` prop for stacked bar support
