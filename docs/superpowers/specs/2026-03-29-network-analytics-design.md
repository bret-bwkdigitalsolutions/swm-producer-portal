# Network-Level Analytics Views

## Overview

Add a network tier above the existing show-level analytics. SWM operates two podcast networks — Sunset Lounge DFW (7 shows) and Your Dark Companion (1 show) — each with separate Transistor and YouTube accounts. The network view gives admins aggregated podcast downloads and channel-level YouTube stats in a single page, with the ability to drill into individual shows.

## Decisions

- **Network as config, not DB model** — two networks that rarely change don't warrant a migration. A typed config object provides slugs, display names, and show membership.
- **Admin-only network views** — producers see only their assigned shows. No filtered/partial network view (would be misleading).
- **Hybrid routing** — network overview is its own page; drilling into a show reuses the existing tabbed show-level pages.
- **Single combined page** — network overview shows both Transistor and YouTube data on one page (no tabs).
- **YouTube gated at show level** — multi-show network members hide YouTube data with a banner directing to the network view.

## Network Config

New file: `src/lib/analytics/networks.ts`

```ts
export interface Network {
  slug: string;
  name: string;
  wpShowIds: number[];
  credentialWpShowId: number;
}

export const NETWORKS: Network[] = [
  {
    slug: "sunset-lounge-dfw",
    name: "Sunset Lounge DFW",
    wpShowIds: [/* 7 show IDs */],
    credentialWpShowId: 0,
  },
  {
    slug: "your-dark-companion",
    name: "Your Dark Companion",
    wpShowIds: [/* 1 show ID */],
    credentialWpShowId: /* show's wpShowId */,
  },
];
```

Helpers: `getNetworkBySlug(slug)`, `getNetworksForUser(role)` (all for admins, empty for producers), `getNetworkForShow(wpShowId)`, `showHasOwnYouTube(wpShowId)`.

`showHasOwnYouTube` returns true when the show's network has `wpShowIds.length === 1`.

## Routing

### New route

`/dashboard/analytics/network/[slug]` — network overview page (admin-only).

### Admin flow

1. Admin lands on `/dashboard/analytics`
2. Sees a network picker (cards for each network) instead of the show selector
3. Clicks a network, navigates to `/dashboard/analytics/network/sunset-lounge-dfw`
4. Network overview page with combined Transistor + YouTube data
5. "Shows" section at the bottom links to show-level pages

### Producer flow

Unchanged. Show selector (or auto-select) on `/dashboard/analytics`. No network routes visible.

### Layout

The network page inherits the analytics layout (`DateRangeProvider`, date picker). The `AnalyticsNav` tabs are hidden on network pages. A breadcrumb/back link lets admins return to the network picker.

## Network Overview Page Content

### Stat cards (top row)

| Card | Source | Scope |
|------|--------|-------|
| Total Downloads | Transistor (aggregated across member shows) | Date range |
| YouTube Views | YouTube Analytics API (channel-level) | Date range |
| Watch Hours | YouTube Analytics API (channel-level) | Date range |
| Subscribers | YouTube Data API (channel stats) | All-time |

### Charts (two columns)

- **Left:** Podcast Downloads over time — aggregated across all member shows (sum per day)
- **Right:** YouTube Views over time — channel-level

### Per-show breakdown (table)

One row per show. Columns: Show Name, Downloads (date range), Episode Count. Sorted by downloads descending. Each row links to show-level analytics.

### Top content (two columns)

- **Left:** Top Episodes across all shows (merged, sorted by published date)
- **Right:** Top Videos from the YouTube channel

## Data Fetching

### Network server actions

New file: `src/app/dashboard/analytics/network/actions.ts`

All actions call `requireAdmin()` for access control.

| Action | Description |
|--------|-------------|
| `fetchNetworkPodcastAnalytics(slug, dateRange)` | Fetch Transistor analytics for each member show in parallel, sum download points by date |
| `fetchNetworkPodcastEpisodes(slug)` | Fetch episodes for all member shows, merge and sort by published date |
| `fetchNetworkShowBreakdown(slug, dateRange)` | Per-show download totals: `{ wpShowId, title, totalDownloads, episodeCount }[]` |
| `fetchNetworkYouTubeAnalytics(slug, dateRange)` | Channel-level YouTube analytics via `credentialWpShowId` |
| `fetchNetworkYouTubeChannel(slug)` | Channel stats via `credentialWpShowId` |
| `fetchNetworkYouTubeVideos(slug)` | Video list via `credentialWpShowId` |

### Credential resolution

Uses `network.credentialWpShowId` directly with existing `resolveCredential()` and `resolvePlatformId()`. No changes to credential layer.

### Caching

Same TTLs as show-level (4h Transistor, 6h YouTube). Cache keys prefixed with `network:{slug}:` to avoid collisions.

## Show-Level YouTube Gating

For shows in multi-show networks, YouTube data is hidden at the show level.

### Affected pages

- **Overview** (`/dashboard/analytics/page.tsx`) — hide YouTube charts/stats, show banner
- **YouTube tab** (`/dashboard/analytics/youtube/page.tsx`) — show banner, skip data fetch
- **Compare page** (`/dashboard/analytics/compare/page.tsx`) — hide YouTube columns

### Banner

**Admin version:** "YouTube analytics for Sunset Lounge DFW shows are available at the network level, since all shows share one channel." Links to `/dashboard/analytics/network/sunset-lounge-dfw`.

**Producer version:** Same text, no link (producers can't access network views).

### Logic

`showHasOwnYouTube(wpShowId)` checks if the show belongs to a network with only one member. If so, YouTube data is shown normally. Otherwise, it's gated.

## Components

### New components

- **`NetworkPicker`** — card grid for selecting a network (admin landing page)
- **`ShowBreakdownTable`** — per-show download table with links to show-level pages
- **`YouTubeBanner`** — info banner explaining YouTube is at network level

### Reused components

- `StatCard`, `TimeSeriesChart`, `EpisodeTable`, `VideoTable` — used as-is on the network overview page
- `DateRangePicker` — inherited from layout

## Access Control

- Network pages: `requireAdmin()` at the action level
- Show-level pages: unchanged (`requireShowAccess()`)
- `getNetworksForUser("admin")` returns all networks; `getNetworksForUser("producer")` returns empty array
