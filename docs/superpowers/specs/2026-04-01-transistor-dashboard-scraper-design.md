# Transistor Dashboard Analytics Scraper

## Problem

Transistor FM's REST API only provides daily download counts. Their web dashboard offers significantly richer analytics — geographic breakdowns, podcast app/player data, device data, estimated subscribers, and average downloads per episode — but these are only accessible through the dashboard UI. There are no documented API endpoints for this data, and the undocumented endpoints that were attempted (`/analytics/{showId}/countries`, `/applications`, `/devices`) do not work.

We need to automate extracting this dashboard-only data weekly and blend it into the portal's existing analytics pages.

## Approach: Playwright Network Interception

Use Playwright to authenticate with the Transistor dashboard, navigate to analytics pages, and intercept the internal API responses (JSON) that power the dashboard — rather than scraping the DOM or downloading CSVs. This gives us structured data that is more reliable than CSS selectors and richer than CSV exports.

## Architecture

Two-part system with clean separation:

```
Transistor Dashboard
    | (Playwright intercepts JSON responses)
Scraper Service (standalone, scheduled)
    | (Prisma writes)
PostgreSQL (new scraped analytics tables)
    ^ (Prisma reads)
Portal Analytics Pages
```

- **Scraper Service**: Standalone Node.js script, not part of the Next.js app. Runs weekly via Railway cron. Shares the portal's database.
- **Portal Integration**: Existing analytics pages read from new database tables alongside live API data, blending them into a unified view. The portal never touches Playwright.

If the scraper fails one week, the portal still shows the last successful data with a "last updated" timestamp.

## Authentication

### Login Flow (per account)

1. Check for saved session state file (`transistor-auth-{account}.json`)
2. If exists, load it and verify session is still valid
3. If expired or missing, perform fresh login:
   - Navigate to `dashboard.transistor.fm/login`
   - Fill email + password from environment variables
   - Save session state via Playwright `storageState()`
4. Proceed with data collection

Neither account has 2FA enabled.

### Credentials

```
TRANSISTOR_SUNSET_EMAIL / TRANSISTOR_SUNSET_PASSWORD
TRANSISTOR_YDC_EMAIL / TRANSISTOR_YDC_PASSWORD
```

Stored in the scraper service's Railway environment variables, not in the portal's env.

### Error Handling

- Login failure: log error, send notification via Resend, abort that account
- Session expiry mid-run: retry login once, then fail gracefully
- Each account runs independently — if Sunset Lounge fails, YDC still runs

## Data Collection

### Pages Visited Per Show

| Dashboard Page | Data Captured | Target Table |
|---|---|---|
| Overview/Downloads | Monthly/yearly aggregated downloads, avg downloads at 7/30/60/90 days, estimated subscribers | `TransistorScrapedOverview` |
| Countries | Country breakdown with download counts + percentages, state/province for US/CA/AU | `TransistorScrapedGeo` |
| Apps/Players | App-level download counts with trends | `TransistorScrapedApps` |
| Devices | Device type + specific device breakdowns | `TransistorScrapedDevices` |

### Interception Approach

- Register `page.on('response')` listener filtered to Transistor's API domain before navigating
- Capture all JSON responses, keyed by URL pattern
- After page load settles (network idle), collect the intercepted data
- If a response is missing, fall back to attempting the CSV export button as backup

### Date Range & Scope

- Pull the last 90 days of data on each run (provides overlap for corrections)
- Upsert strategy: if a record for that show + date + dimension exists, update it
- All shows across both accounts: ~7 Sunset Lounge shows + 1 YDC show
- ~8 page navigations per show, ~64 total page loads per run

## Database Schema

```prisma
model TransistorScrapedOverview {
  id                   String   @id @default(cuid())
  wpShowId             Int
  scrapedAt            DateTime
  estimatedSubscribers Int?
  avgDownloads7d       Float?
  avgDownloads30d      Float?
  avgDownloads60d      Float?
  avgDownloads90d      Float?
  monthlyDownloads     Json?    // { "2026-03": 1234, "2026-02": 1100, ... }
  yearlyDownloads      Json?    // { "2026": 14000, "2025": 12000, ... }

  @@unique([wpShowId, scrapedAt])
}

model TransistorScrapedGeo {
  id         String   @id @default(cuid())
  wpShowId   Int
  scrapedAt  DateTime
  country    String
  region     String?  // state/province for US/CA/AU
  downloads  Int
  percentage Float?

  @@unique([wpShowId, scrapedAt, country, region])
  @@index([wpShowId, scrapedAt])
}

model TransistorScrapedApps {
  id         String   @id @default(cuid())
  wpShowId   Int
  scrapedAt  DateTime
  appName    String
  downloads  Int
  percentage Float?

  @@unique([wpShowId, scrapedAt, appName])
  @@index([wpShowId, scrapedAt])
}

model TransistorScrapedDevices {
  id         String   @id @default(cuid())
  wpShowId   Int
  scrapedAt  DateTime
  deviceType String   // "desktop", "mobile", "smart_speaker", etc.
  deviceName String?  // "iPhone", "Android", "Alexa", etc.
  downloads  Int
  percentage Float?

  @@unique([wpShowId, scrapedAt, deviceType, deviceName])
  @@index([wpShowId, scrapedAt])
}

model TransistorScrapeLog {
  id          String    @id @default(cuid())
  startedAt   DateTime
  completedAt DateTime?
  status      String    // "running", "completed", "failed"
  account     String    // "sunset_lounge" or "ydc"
  showCount   Int?
  errors      Json?     // Array of error messages
}
```

### Key Decisions

- `scrapedAt` is the timestamp of the scrape run, not the analytics period — tracks data freshness
- `TransistorScrapeLog` tracks job health for alerting
- `wpShowId` as join key — consistent with the rest of the portal
- Upsert on unique constraints — re-running is safe, no duplicates

## Portal Integration

### UI Changes

- **Overview cards**: Add estimated subscribers and average downloads per episode (from `TransistorScrapedOverview`)
- **Downloads chart**: Add monthly/yearly toggle using scraped aggregations, supplementing daily API data
- **New "Listeners" section** on podcast analytics page with three sub-views:
  - **Geography**: Country breakdown table + map visualization, expandable to state/province for US/CA/AU
  - **Apps**: Bar/pie chart of listening apps
  - **Devices**: Bar/pie chart of device types

### Data Freshness

- Each section sourced from scraped data shows a subtle "Updated {date}" indicator
- If data is older than 10 days (missed weekly run + buffer), show a warning badge
- Live API data (daily downloads) has no freshness indicator since it's fetched on-demand

### Access Control

- Same rules as existing analytics — admins see all shows, producers see only assigned shows
- No changes to access model — scraped data is keyed by `wpShowId` and uses existing `requireShowAccess()`

### Server Actions

- New actions in existing `analytics/actions.ts` querying scraped tables
- Same caching layer (Redis + in-memory) with longer TTLs since data updates weekly

## Scraper Runtime & Scheduling

### Deployment

- Separate Railway service (not part of the portal web server)
- Own Dockerfile with Playwright + Chromium
- Shares `DATABASE_URL` with the portal
- Runs on schedule, not as a long-running process

### Schedule

- Weekly, Sunday nights: `0 3 * * 0` (3 AM UTC)
- Each run should complete in under 10 minutes

### Script Structure

```
scripts/transistor-scraper/
  index.ts          — entry point, orchestrates the run
  auth.ts           — login + session management
  collector.ts      — page navigation + response interception
  parser.ts         — normalize intercepted JSON into DB shapes
  storage.ts        — Prisma upserts to scraped tables
  notify.ts         — success/failure notifications
  package.json      — own deps (playwright, prisma client)
  Dockerfile        — Playwright + Chromium image
```

### Monitoring

- `TransistorScrapeLog` record created at start, updated on completion/failure
- On failure: email notification via Resend
- Portal admin panel could show a "Scraper Health" indicator from the log table

### Retry Strategy

- If a single show fails, continue with remaining shows, log the error
- No automatic retry of the full run — failure triggers notification, next weekly run picks it up
- Manual trigger: `POST /api/scraper/trigger` (admin-only, protected by secret) for on-demand re-runs

## Evolution Path

Once the scraper is running and we can observe the intercepted network requests, we may discover that Transistor's internal API endpoints are stable and accept session cookie auth directly. If so, we can evolve toward direct HTTP calls (no browser rendering) for faster, more reliable data collection — keeping Playwright only for the login step.
