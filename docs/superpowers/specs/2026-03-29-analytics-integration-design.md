# Analytics Integration Design

Integrate Transistor (podcast) and YouTube analytics into the SWM Producer Portal, replacing the standalone `stolen-water-media-analytics` dashboard. Producers see analytics for their assigned shows; admins see all shows.

## Decisions

| Decision | Choice |
|----------|--------|
| Platforms | Transistor + YouTube only (no Patreon) |
| Scoping | Producers see assigned shows, admins see all |
| Compare view | Available to all users, scoped to accessible shows |
| Caching | Upstash Redis (new dependency) |
| Navigation | Top-level "Analytics" sidebar item |
| Drill-down | Keep episode + video detail pages |
| Approach | Direct port — rewrite API layer to use portal credentials |

## Routes

| Route | Purpose | Access |
|-------|---------|--------|
| `/dashboard/analytics` | Overview — aggregated stats across user's shows | All authenticated |
| `/dashboard/analytics/podcasts` | Podcast downloads, countries, apps, devices | All authenticated |
| `/dashboard/analytics/podcasts/episodes/[id]` | Single episode download analytics | All authenticated |
| `/dashboard/analytics/youtube` | YouTube views, watch hours, subscribers, traffic, geo | All authenticated |
| `/dashboard/analytics/youtube/videos/[id]` | Single video analytics | All authenticated |
| `/dashboard/analytics/compare` | Side-by-side multi-show comparison | All authenticated |

All routes enforce show-level access via existing `UserShowAccess` model. Admins bypass show restrictions.

## Navigation

Add "Analytics" to the dashboard sidebar between content type links and Episode Distribution. Highlights on any `/dashboard/analytics/*` path.

Within analytics, tab navigation across: Overview, Podcasts, YouTube, Compare.

## Show Selector

Dropdown on every analytics page. Populated from:
- **Producers:** their `UserShowAccess` entries joined with WordPress show data
- **Admins:** all shows

If user has exactly one show, auto-select it and hide the dropdown. Selection persisted in URL search params.

## Data Architecture

### Credential Resolution

Analytics functions resolve API credentials via existing `PlatformCredential` model:
1. Look up show-specific credential (`wpShowId` + platform)
2. Fall back to network default (`wpShowId=0` + platform)
3. If no credential found, show a message directing user to ask admin to configure credentials

### Platform ID Resolution

`ShowPlatformLink` stores platform-specific identifiers per show:
- `transistor_show` — Transistor show URL (e.g., `https://share.transistor.fm/s/abc123`). The `resolvePlatformId` function parses the show ID from the URL path.
- `youtube_channel` — YouTube channel URL (e.g., `https://youtube.com/channel/UC...`). The `resolvePlatformId` function parses the channel ID from the URL path.

If a show lacks the required platform link, the analytics page shows a message indicating the platform isn't configured for that show.

### Caching (Upstash Redis)

New dependency: `@upstash/redis`

Cache TTLs by data type:
| Data Type | TTL |
|-----------|-----|
| Show/channel metadata | 1 hour |
| Episode/video lists | 1 hour |
| Podcast analytics | 4 hours |
| YouTube analytics | 6 hours |

Cache key format: `analytics:{platform}:{wpShowId}:{dataType}:{dateRange}`

In-memory fallback cache for local development when Redis is unavailable.

Manual cache refresh via a refresh button per page (busts relevant cache keys by prefix).

### No New Database Models

All analytics data is transient — fetched from external APIs and cached in Redis. No Prisma schema changes needed. Existing models used:
- `PlatformCredential` — API keys and OAuth tokens
- `ShowPlatformLink` — platform-specific show identifiers
- `UserShowAccess` — show-level access control

## API Layer

Server-side library functions (no API routes). Each function takes `wpShowId`, resolves credentials, checks cache, fetches from external API if needed.

### `src/lib/analytics/credentials.ts`

- `resolveCredential(wpShowId, platform)` — returns credential with network fallback
- `resolvePlatformId(wpShowId, platformLinkType)` — extracts platform-specific ID from ShowPlatformLink
- `refreshYouTubeToken(credential)` — refreshes expired YouTube OAuth tokens, updates DB

### `src/lib/analytics/cache.ts`

- `cachedFetch<T>(key, ttlSeconds, fetcher)` — Redis-first cache wrapper
- `bustCachePrefix(prefix)` — invalidate all keys matching prefix
- In-memory Map fallback when Redis unavailable

### `src/lib/analytics/transistor.ts`

- `getTransistorShows(wpShowId)` — list shows for credential
- `getTransistorEpisodes(wpShowId, transistorShowId)`
- `getTransistorShowAnalytics(wpShowId, transistorShowId, dateRange)` — downloads over time
- `getTransistorEpisodeAnalytics(wpShowId, episodeId, dateRange)` — single episode downloads
- `getTransistorCountryAnalytics(wpShowId, transistorShowId, dateRange)`
- `getTransistorAppAnalytics(wpShowId, transistorShowId, dateRange)`
- `getTransistorDeviceAnalytics(wpShowId, transistorShowId, dateRange)`

### `src/lib/analytics/youtube.ts`

- `getYouTubeChannelStats(wpShowId)` — subscriber, view, video counts
- `getYouTubeVideos(wpShowId)` — recent videos with metadata
- `getYouTubeChannelAnalytics(wpShowId, dateRange)` — views, watch minutes, subscriber changes by day
- `getYouTubeVideoAnalytics(wpShowId, videoId, dateRange)` — single video analytics
- `getYouTubeTrafficAnalytics(wpShowId, dateRange)` — views by traffic source
- `getYouTubeGeoAnalytics(wpShowId, dateRange)` — views by country

### `src/lib/analytics/types.ts`

TypeScript types for all analytics data structures. Ported from the current dashboard's type definitions, adapted for the portal context.

## Access Control

No new permissions model. Existing system handles everything:

1. **Authentication:** `requireAuth()` in analytics layout
2. **Show access:** Page components verify `wpShowId` against user's `UserShowAccess` (admins bypass)
3. **Credential access:** Credential resolution is server-side only — no tokens exposed to client

Helper function: `getAccessibleShows(userId, role)` — returns show list for the show selector, respecting access rules.

## UI Components

### New Components

**`src/components/analytics/show-selector.tsx`**
Client component. Dropdown populated from accessible shows. Selection stored in URL search params. Auto-selects if user has one show.

**`src/components/analytics/date-range-picker.tsx`**
Client component. Presets: 7d, 30d, 90d, 12m, custom. Default: 30d. Stores selection in URL search params for shareable links.

**`src/components/analytics/analytics-nav.tsx`**
Tab navigation: Overview | Podcasts | YouTube | Compare. Highlights active tab.

**`src/app/dashboard/analytics/layout.tsx`**
Server component. Calls `requireAuth()`, fetches accessible shows, renders analytics nav + show selector + date picker + children.

### Chart Components (in `src/components/analytics/charts/`)

Ported from current dashboard, restyled for portal's light theme:

- **`time-series-chart.tsx`** — Recharts LineChart for trends (downloads, views over time)
- **`bar-chart.tsx`** — Horizontal/vertical bars (top countries, platforms, devices)
- **`donut-chart.tsx`** — Pie/donut (traffic sources, device distribution)
- **`stat-card.tsx`** — Metric card with value and optional trend indicator

All charts use Recharts (new dependency: `recharts`). Styled with Tailwind to match portal's existing design language (light backgrounds, gray borders, blue/indigo accents).

### Page Components

Each analytics page is a server component that:
1. Reads `wpShowId` and date range from search params
2. Validates show access for the current user
3. Fetches data via library functions
4. Renders stat cards and charts

Client interactivity (show selector, date picker, chart tooltips) handled by client components receiving server-fetched data as props.

## Date Range

`DateRangeProvider` context wraps the analytics layout:
- Reads initial values from URL search params (`?from=2026-03-01&to=2026-03-29&preset=30d`)
- Presets: 7d, 30d, 90d, 12m, custom
- Default: 30d
- Updates URL on change (shareable links)
- Provides `{ from: string, to: string, preset: string }` to descendants

## Environment Variables (New)

```
UPSTASH_REDIS_REST_URL     # Redis connection
UPSTASH_REDIS_REST_TOKEN   # Redis auth token
```

No other new env vars. YouTube and Transistor credentials come from `PlatformCredential` in the database.

## Dependencies (New)

| Package | Purpose |
|---------|---------|
| `@upstash/redis` | Redis caching |
| `recharts` | Chart rendering |

## Out of Scope

- Patreon analytics
- Data export (CSV/JSON)
- Alerting/thresholds
- Dark theme
- Custom dashboard layouts
- Historical data storage (beyond Redis cache TTLs)
