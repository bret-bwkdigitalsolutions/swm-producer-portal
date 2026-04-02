# Analytics Hierarchy Redesign

Replace the current "select a network" landing page with a full analytics dashboard that works at three levels: All Networks, single Network, and single Show. A unified selector dropdown controls the active level, and all tabs (Overview, Podcasts, YouTube, Compare) respect it.

## Current State

- Admin landing on Overview sees a `NetworkPicker` (two cards) with no analytics data
- Analytics only render after selecting an individual show
- Network detail pages exist at `/dashboard/analytics/network/[slug]` but are separate from the tab flow
- Podcasts, YouTube, and Compare tabs only work at the show level
- Producers see only their assigned shows and skip the network picker

## Design

### Selection Hierarchy

Three levels, controlled by a single enhanced dropdown:

1. **All Networks** (default for admins) — aggregates all shows across both networks
2. **Network** — aggregates all shows within the selected network
3. **Show** — current single-show view

The URL parameter `?show=<wpShowId>` extends to support `?level=all`, `?level=network&network=<slug>`, and `?show=<wpShowId>` for show level.

### Enhanced Show Selector

Replace the current `ShowSelector` dropdown with a hierarchical selector:

```
┌─────────────────────────────┐
│ All Networks            ✓   │
├─────────────────────────────┤
│ SUNSET LOUNGE DFW           │  ← clickable, selects network
│   Show A                    │  ← clickable, selects show
│   Show B                    │
│   Show C                    │
│   ...                       │
├─────────────────────────────┤
│ YOUR DARK COMPANION         │  ← clickable, selects network
│   Show D                    │
└─────────────────────────────┘
```

- "All Networks" at the top as its own option
- Network names as selectable items (styled as group headers but clickable)
- Shows indented under their network
- Current selection shown in the trigger button
- Selection persists across tab navigation via URL params

### Overview Tab

At **All Networks** and **Network** levels, display the same rich dashboard that individual shows get:

1. **Stat cards (4):** Total Downloads, Est. Subscribers, YouTube Views, Watch Hours — aggregated across all shows in scope
2. **Time series charts (2):** Podcast Downloads Over Time, YouTube Views Over Time — combined series
3. **Content tables (2):** Top Episodes, Top Videos — merged from all shows in scope, sorted by downloads/views
4. **Audience section:** Combined subscriber counts
5. **Geo section:** Merged podcast + YouTube geography across all shows
6. **Platforms section:** Combined app/platform distribution across all shows

Data aggregation: fetch data for each show in scope (with throttling to avoid rate limits), then merge/sum the results client-side.

### Podcasts Tab

At **All Networks** level: aggregated podcast stats, combined downloads time series, top episodes across all shows.

At **Network** level: same, filtered to that network's shows.

At **Show** level: current behavior (unchanged).

### YouTube Tab

At **All Networks** level: aggregated YouTube stats, combined views/watch time series, top videos across all shows, merged geo and traffic sources.

At **Network** level: same, filtered to that network's shows.

At **Show** level: current behavior (unchanged).

### Compare Tab

At **All Networks** level: compare the two networks against each other (total downloads, views, time series by network).

At **Network** level: compare shows within that network (current compare behavior but scoped to the network's shows).

At **Show** level: not applicable — redirect to network level or hide tab.

### Producer Experience

Producers only see shows they have access to. If a producer has shows in multiple networks, they see the same hierarchy but limited to their accessible shows. If all their shows are in one network, "All Networks" and the network level would show the same data — still fine to show both for consistency.

## Architecture

### URL Scheme

```
/dashboard/analytics?level=all                         → All Networks
/dashboard/analytics?level=network&network=sunset-lounge-dfw  → Network
/dashboard/analytics?show=22                            → Show
/dashboard/analytics/podcasts?level=all                 → All Networks, Podcasts tab
/dashboard/analytics/youtube?level=network&network=sunset-lounge-dfw → Network, YouTube tab
/dashboard/analytics/compare?level=all                  → Compare networks
/dashboard/analytics/compare?level=network&network=sunset-lounge-dfw → Compare shows in network
```

### Selection Context

Create an `AnalyticsSelectionProvider` (or extend the existing date range context) that parses URL params and exposes:

```typescript
type AnalyticsSelection =
  | { level: "all" }
  | { level: "network"; network: Network }
  | { level: "show"; wpShowId: number; showName: string }

// Hook
function useAnalyticsSelection(): {
  selection: AnalyticsSelection
  setSelection: (selection: AnalyticsSelection) => void
  showsInScope: number[]  // wpShowIds for the current selection
}
```

`showsInScope` returns all show IDs matching the current level — used by data fetching to know which shows to aggregate.

### Data Aggregation

New utility functions in `src/lib/analytics/aggregation.ts`:

- `aggregateAnalyticsPoints(points: TransistorAnalyticsPoint[][])` — merge time series by date, summing downloads
- `aggregateYouTubeAnalytics(points: YouTubeAnalyticsPoint[][])` — merge by date, summing views/minutes/subs
- `aggregateGeo(geoArrays: ScrapedGeoEntry[][])` — merge by country name, summing downloads
- `aggregateApps(appArrays: ScrapedAppEntry[][])` — merge by app name, summing downloads
- `mergeEpisodes(episodes: TransistorEpisode[][])` — flatten and sort by downloads descending
- `mergeVideos(videos: YouTubeVideo[][])` — flatten and sort by views descending

These are pure functions that combine per-show data into aggregated views.

### Server Actions

Add new actions in `actions.ts` that accept an array of show IDs and fetch + aggregate:

- `fetchAggregatedPodcastAnalytics(wpShowIds: number[], dateRange)` — calls existing `fetchPodcastAnalytics` for each show, aggregates
- `fetchAggregatedYouTubeAnalytics(wpShowIds: number[], dateRange)` — same pattern for YouTube
- `fetchAggregatedScrapedData(wpShowIds: number[])` — fetches and merges geo, apps, overview for all shows

Throttle parallel requests (existing 200ms pattern from network actions) to avoid API rate limits.

### Network Page Deprecation

The existing `/dashboard/analytics/network/[slug]` route becomes unnecessary since network-level views are now handled inline. Remove or redirect to the main analytics page with the appropriate network param.

## Files to Create

- `src/components/analytics/analytics-selection-provider.tsx` — selection context + hook
- `src/components/analytics/hierarchical-show-selector.tsx` — new dropdown component
- `src/lib/analytics/aggregation.ts` — pure aggregation functions

## Files to Modify

- `src/app/dashboard/analytics/page.tsx` — use selection context, fetch aggregated data at all/network levels
- `src/app/dashboard/analytics/podcasts/page.tsx` — respect selection level
- `src/app/dashboard/analytics/youtube/page.tsx` — respect selection level
- `src/app/dashboard/analytics/compare/page.tsx` — compare networks at all level, shows at network level
- `src/app/dashboard/analytics/layout.tsx` — wrap with `AnalyticsSelectionProvider`
- `src/app/dashboard/analytics/actions.ts` — add aggregated fetch actions
- `src/components/analytics/analytics-nav.tsx` — preserve selection params in tab links

## Files to Remove

- `src/app/dashboard/analytics/network/` — entire directory (functionality absorbed into main flow)
- `src/components/analytics/network-picker.tsx` — replaced by hierarchical selector

## Deployment

Push to staging first for validation before going live to production.
