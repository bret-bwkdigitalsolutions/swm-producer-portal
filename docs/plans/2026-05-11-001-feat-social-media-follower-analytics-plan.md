---
title: "feat: Social media follower analytics (Facebook, Instagram, TikTok, X)"
type: feat
created: 2026-05-11
status: active
depth: deep
---

# feat: Social media follower analytics (Facebook, Instagram, TikTok, X)

## Summary

Add a "Social" tab to the producer analytics dashboard that surfaces follower counts and growth trends for each show's Facebook Page, Instagram Business/Creator account, TikTok creator account, and X (Twitter) handle — plus host personal accounts where applicable. SWM admins connect accounts centrally from a new admin page; a daily worker snapshots follower counts; the dashboard charts current count and growth over time.

---

## Problem Frame

Producers need a single place to monitor social reach alongside podcast and YouTube metrics they already see in `/dashboard/analytics`. SWM operates several shows, each typically with its own social accounts, plus some hosts who maintain personal accounts that represent their public-facing brand. Today, follower data lives across four siloed platforms with very different auth models — there is no consolidated view, no trend history, and no way to compare growth across shows or platforms.

### Per-platform authentication reality (drives much of the design)

| Platform | Auth model | "One credential covers many accounts?" | Notes |
|---|---|---|---|
| **X (Twitter)** | App-only Bearer token | **Yes** — query any handle by username | Requires X API Basic tier (~$200/mo) for read access. Single env-var credential. |
| **Facebook + Instagram** | Per-Page OAuth (Meta Graph API) | **Partially** — one admin OAuth grants access to *all* Pages they admin, and to IG Business/Creator accounts linked to those Pages | Public Page follower counts blocked since 2018. Requires Meta app review for production scopes. Long-lived Page Access Tokens (~60 days). |
| **TikTok** | Per-creator OAuth (Login Kit / Display API) | **No** — each creator must authorize individually | Requires TikTok app review. Returns `follower_count` from `user/info`. |

There is no general-purpose "give me follower count for handle X" API across platforms. X is the exception that allows it; Meta and TikTok require per-account authorization. The plan must accommodate both shapes.

---

## Scope Boundaries

### In scope (v1)

- Connect, store, and refresh credentials for Facebook Pages, Instagram Business/Creator accounts, TikTok creator accounts, and X handles
- Daily snapshot of `followerCount` per connected account
- Social tab on `/dashboard/analytics` with: per-platform stat cards (current count + 7d/30d delta), trend chart, account-level breakdown
- Admin connection UI at `/admin/social-accounts` with central OAuth flows
- Support for both show-level accounts (tied to `wpShowId`) and host-level accounts (tied to a host name string)

### Deferred to follow-up work

- Engagement metrics beyond follower count (impressions, profile views, post-level stats, reach)
- Per-post analytics (e.g., "how did this Reel perform")
- Producer-self-serve connection (only admin-managed in v1; producers see analytics but don't connect)
- LinkedIn, YouTube social side (subscribers already covered by existing YouTube analytics), Threads, Bluesky
- Real-time / on-demand refresh (v1 is daily-only)
- Cross-platform comparison view (the Compare tab equivalent for social)

### Outside this product's identity

- Posting/publishing to social platforms (this portal is a producer analytics + distribution tool for podcast content; social *posting* is not planned)
- Audience demographic data from social platforms (different product surface)

---

## Key Technical Decisions

### KTD-1. Separate `SocialAccount` model rather than reusing `PlatformCredential`

`PlatformCredential` has a unique constraint of `(wpShowId, platform)` and one credential row per show/platform. Social breaks both assumptions: a show may have multiple X handles or two Instagram accounts; host accounts have no `wpShowId`; X handles need no per-account credential (they piggyback on an app-level bearer token).

We introduce three new models:
- `SocialAccount` — one row per tracked handle/account (show or host)
- `SocialAccountCredential` — OAuth tokens, present for Meta and TikTok, absent for X
- `SocialFollowerSnapshot` — time series of follower counts

This keeps the social domain cleanly separated from the existing distribution-platform credentials. Pattern follows `ShowMetadata` + `ShowPlatformLink` style — additive, no migration of existing tables.

### KTD-2. Daily snapshot worker, not on-demand fetches

A single Railway cron runs once daily and snapshots every connected account. Reasons:
- Rate limits across all four platforms make on-demand polling fragile when many users view the dashboard
- Trend charts require historical data anyway, so snapshotting is the source of truth
- A daily snapshot is sufficient resolution for follower-growth analytics; sub-daily fluctuations are noise

Dashboard reads from `SocialFollowerSnapshot`; "current" count is the most recent snapshot. A manual "refresh now" button can be added in v2 if needed.

### KTD-3. Single Meta OAuth event maps to many `SocialAccount`s via a mapping UI

When an admin completes Facebook Login, the callback receives a list of Pages they administer. Rather than running OAuth once per show, we surface a mapping UI showing all returned Pages (+ linked IG accounts) and let the admin assign each one to a `wpShowId` or host. This exploits Meta's "one login, many Pages" model and dramatically reduces friction for SWM admins who manage many Pages.

TikTok has no equivalent — each creator OAuth produces exactly one `SocialAccount`.

### KTD-4. X handles are stored as `SocialAccount` rows with no credential

X uses an app-level Bearer token from `X_BEARER_TOKEN` env var. Admin "connects" an X account by entering the handle (e.g. `@stolenwatermedia`), we validate it exists via the API, and store a `SocialAccount` row with `platform = "x"` and no `SocialAccountCredential`. The worker fetches all X handles in a single batched API call (`users/by` accepts up to 100 usernames per request).

### KTD-5. Admin-only connection in v1

All connection flows live under `/admin/social-accounts` and require the existing admin role guard. Producers see the resulting analytics on `/dashboard/analytics/social` but cannot connect or disconnect accounts. This avoids the additional permission model, UX, and security review that producer-self-serve would require, and matches the existing pattern where credentials for YouTube/Transistor are managed centrally.

---

## High-Level Technical Design

*This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```mermaid
flowchart LR
    subgraph admin[/admin/social-accounts]
        A1[Admin clicks Connect Facebook]
        A2[Admin clicks Connect TikTok]
        A3[Admin enters X handle]
    end

    subgraph oauth[OAuth callbacks]
        B1[Meta callback → list Pages → mapping UI]
        B2[TikTok callback → store token + user_info]
        B3[X validate → store handle]
    end

    subgraph db[Database]
        C1[(SocialAccount)]
        C2[(SocialAccountCredential)]
        C3[(SocialFollowerSnapshot)]
    end

    subgraph worker[Daily Railway cron]
        D1[For each SocialAccount]
        D2[Fetch follower count from platform]
        D3[Insert snapshot row]
    end

    subgraph dashboard[/dashboard/analytics/social]
        E1[Stat cards: current + delta]
        E2[Trend chart from snapshots]
    end

    A1 --> B1 --> C1
    B1 --> C2
    A2 --> B2 --> C1
    B2 --> C2
    A3 --> B3 --> C1
    C1 --> D1 --> D2 --> D3 --> C3
    C3 --> E2
    C3 --> E1
```

---

## Output Structure

New files and directories created by this plan:

```
prisma/
  migrations/
    <timestamp>_social_accounts/migration.sql
  schema.prisma                                  (modified: 3 new models)

src/
  app/
    admin/
      social-accounts/
        page.tsx                                 (list + connect UI)
        actions.ts                               (server actions: add X handle, map Meta pages, disconnect)
        meta-mapping/
          page.tsx                               (post-Meta-OAuth Page → show mapping)
    api/
      oauth/
        meta/
          authorize/route.ts
          callback/route.ts
        tiktok/
          authorize/route.ts
          callback/route.ts
    dashboard/
      analytics/
        social/
          page.tsx
          actions.ts
    api/
      cron/
        social-snapshot/route.ts                 (Railway cron target)
  components/
    analytics/
      analytics-nav.tsx                          (modified: add "Social" tab)
      social-section.tsx                         (stat cards + chart)
      charts/
        social-trend-chart.tsx
    admin/
      social-account-card.tsx
      connect-buttons.tsx
  lib/
    social/
      types.ts
      meta-oauth.ts
      tiktok-oauth.ts
      x-client.ts
      fetchers.ts                                (uniform fetchFollowerCount per platform)
      snapshot.ts                                (worker entrypoint)
      __tests__/
        meta-oauth.test.ts
        tiktok-oauth.test.ts
        x-client.test.ts
        snapshot.test.ts
```

The per-unit `**Files:**` sections remain authoritative for what each unit creates.

---

## Implementation Units

### U1. Data model: `SocialAccount`, `SocialAccountCredential`, `SocialFollowerSnapshot`

**Goal:** Establish the schema that supports show-level and host-level accounts across four platforms, with separate credential storage for OAuth platforms and a time-series snapshot table.

**Requirements:** Foundational — all subsequent units depend on this.

**Dependencies:** None.

**Files:**
- `prisma/schema.prisma` (add three models)
- `prisma/migrations/<timestamp>_social_accounts/migration.sql` (generated)
- `src/lib/social/types.ts` (shared TypeScript types: `SocialPlatform`, `SocialAccountKind`)
- `src/lib/social/__tests__/types.test.ts`

**Approach:**

```
model SocialAccount {
  id            String   @id @default(cuid())
  platform      String   // "facebook_page" | "instagram" | "tiktok" | "x"
  kind          String   // "show" | "host" | "network"
  wpShowId      Int?     // nullable: null for host/network accounts
  hostName      String?  // nullable: null for show/network accounts
  handle        String   // human-readable handle (e.g. "@stolenwatermedia")
  displayName   String?  // platform-reported display name
  externalId    String?  // Page ID, IG user ID, TikTok openId, X user ID
  status        String   @default("active") // "active" | "needs_reauth" | "removed"
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  credential    SocialAccountCredential?
  snapshots     SocialFollowerSnapshot[]

  @@unique([platform, externalId])
  @@index([wpShowId])
}

model SocialAccountCredential {
  socialAccountId String   @unique
  accessToken     String   @db.Text
  refreshToken    String?  @db.Text
  tokenExpiresAt  DateTime?
  connectedByUserId String? // which admin connected this
  connectedEmail  String?  // FB/TikTok account that authorized
  scopes          String?  // space-separated OAuth scopes granted
  // FK + cascade on SocialAccount removal
}

model SocialFollowerSnapshot {
  id              String   @id @default(cuid())
  socialAccountId String
  followerCount   Int
  capturedAt      DateTime @default(now())

  @@index([socialAccountId, capturedAt])
}
```

Validation: enforce `kind == "show"` ⇒ `wpShowId NOT NULL`, `kind == "host"` ⇒ `hostName NOT NULL` at the application layer (Prisma can't express conditional non-null cleanly).

**Patterns to follow:**
- `prisma/schema.prisma` existing models — particularly `PlatformCredential` (cuid IDs, `@@map` snake_case, `@db.Text` for tokens) and `ShowPlatformLink` (the `wpShowId=0` convention for network-wide rows is not used here — we use `kind="network"` instead, since social accounts are not the same shape as platform URLs)

**Test scenarios:**
- Creating a `SocialAccount` with `kind="show"` succeeds when `wpShowId` is set and fails (application-level check) when null
- Creating a `SocialAccount` with `kind="host"` succeeds when `hostName` is set
- `(platform, externalId)` unique constraint prevents duplicate connections of the same Page/IG/TikTok account
- Cascading delete: removing a `SocialAccount` removes its credential and snapshots
- TypeScript discriminated union for `SocialPlatform` ensures unknown platform strings are rejected at compile time

**Verification:** Migration runs cleanly against a fresh database; `npx prisma db push` reflects the schema; type definitions compile.

---

### U2. Admin connection UI shell (`/admin/social-accounts`)

**Goal:** Provide the list-and-connect surface that every subsequent platform unit (U3–U5) plugs into. Renders existing connections grouped by kind (Show / Host / Network) and exposes four "Connect" affordances.

**Requirements:** Single central point for SWM admins to manage all social connections.

**Dependencies:** U1.

**Files:**
- `src/app/admin/social-accounts/page.tsx`
- `src/app/admin/social-accounts/actions.ts` (server actions: `removeSocialAccount`, `markNeedsReauth`)
- `src/components/admin/social-account-card.tsx`
- `src/components/admin/connect-buttons.tsx`
- `src/app/admin/social-accounts/__tests__/page.test.tsx`

**Approach:**
- Server component that queries all `SocialAccount` rows, groups by `kind`, and renders cards.
- Each card shows: platform icon, handle, display name, current follower count (from latest snapshot if any), last-fetched timestamp, status badge (`active` / `needs_reauth` / `removed`), and Disconnect button.
- Four prominent "Connect" buttons at the top: Facebook + Instagram (combined — one OAuth covers both), TikTok, Add X Handle. Each routes to the corresponding `/api/oauth/...` authorize endpoint or opens an "Add X handle" modal.
- Admin role guard via `requireAdmin()` from `src/lib/auth-guard.ts`.

**Patterns to follow:**
- `src/app/admin/credentials/page.tsx` (existing credential overview layout, status badge styling)
- `src/lib/auth-guard.ts` (role guard usage)
- shadcn/ui v4 cards (uses `@base-ui/react`, not Radix; per CLAUDE.md)

**Test scenarios:**
- Page renders without crashing when no social accounts exist
- Shows accounts grouped under "Shows" / "Hosts" / "Network"
- Renders `needs_reauth` status badge in a visible warning color for Meta/TikTok accounts past token expiry
- Disconnect action soft-deletes (sets `status="removed"`) rather than hard-deletes, preserving snapshot history
- Non-admin user is redirected to `/login`

**Verification:** Page loads at `/admin/social-accounts` for an admin; non-admins are redirected; existing seed accounts render correctly.

---

### U3. X (Twitter) integration: handle add, fetch, batch snapshot

**Goal:** Implement the simplest platform first — app-level Bearer token, handle entry, batch fetch.

**Requirements:** Track X follower counts for any handle without per-account OAuth.

**Dependencies:** U1, U2.

**Files:**
- `src/lib/social/x-client.ts`
- `src/lib/social/__tests__/x-client.test.ts`
- `src/app/admin/social-accounts/actions.ts` (extend with `addXHandle` server action)
- `.env.example` (add `X_BEARER_TOKEN`)

**Approach:**
- `x-client.ts` exports `fetchXUserByUsername(username)` and `fetchXUsersBatch(usernames[])`. Uses `GET https://api.twitter.com/2/users/by` with `usernames=` query param (comma-separated, up to 100) and `user.fields=public_metrics,name,id`.
- Bearer auth header from `X_BEARER_TOKEN`.
- `addXHandle` server action: takes handle + kind + wpShowId/hostName, calls `fetchXUserByUsername` to validate + resolve `externalId` and `displayName`, inserts `SocialAccount` row. No `SocialAccountCredential` row.
- Returns clear error messages for: handle not found, rate-limited (429), API tier insufficient (401/403 with explanatory message).

**Patterns to follow:**
- `src/lib/youtube-oauth.ts` env-var-loading pattern (throw if missing)
- Existing fetcher modules in `src/lib/analytics/` (`youtube.ts`, `transistor.ts`) for response-shape normalization

**Test scenarios:**
- `fetchXUserByUsername("validhandle")` returns `{ id, username, name, followerCount }`
- Invalid handle (404 from X) surfaces as a typed error, not a crash
- Rate limit (429) surfaces with a `retry-after`-aware error
- Batch fetch of 150 usernames splits into two requests of 100 + 50
- `addXHandle` rejects duplicate (same `externalId` already exists for `platform="x"`)
- `addXHandle` for a `kind="show"` requires `wpShowId`; for `kind="host"` requires `hostName`

**Verification:** Admin can add `@stolenwatermedia` via the UI; row appears in `social_accounts` with correct `externalId`; calling `fetchXUsersBatch` against three handles returns three follower counts.

---

### U4. Meta OAuth: Facebook + Instagram with Page mapping flow

**Goal:** Implement the highest-complexity flow — Facebook Login, list managed Pages, map each Page (and linked IG account) to a show or host.

**Requirements:** Connect Facebook Pages and linked Instagram Business/Creator accounts via a single admin OAuth event.

**Dependencies:** U1, U2.

**Files:**
- `src/lib/social/meta-oauth.ts`
- `src/app/api/oauth/meta/authorize/route.ts`
- `src/app/api/oauth/meta/callback/route.ts`
- `src/app/admin/social-accounts/meta-mapping/page.tsx`
- `src/app/admin/social-accounts/meta-mapping/actions.ts`
- `src/lib/social/__tests__/meta-oauth.test.ts`
- `.env.example` (add `META_APP_ID`, `META_APP_SECRET`)

**Approach:**

1. **Authorize route** — redirects to Facebook Login with scopes:
   - `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`
   - `instagram_basic`, `instagram_manage_insights`
   - `business_management`
   - `state` parameter encodes the admin's userId (CSRF + return mapping)

2. **Callback route** — exchanges code for short-lived user token, then exchanges for a long-lived user token (~60d), then calls `GET /me/accounts?fields=id,name,access_token,instagram_business_account{id,username,name,profile_picture_url}` to list managed Pages and their linked IG Business accounts. Each Page comes with its own Page Access Token (which is what we actually store).

3. **Mapping page** — displays each returned Page + IG pair with dropdowns: "Map to: [Show ▼] or [Host ▼] or [Skip]". On submit, creates one `SocialAccount` per Page (platform=`facebook_page`) and one per linked IG (platform=`instagram`), each with its own `SocialAccountCredential` row storing the Page Access Token. IG Business accounts inherit the linked Page's access token — that's how Meta's API works.

4. **Token refresh** — Long-lived Page Access Tokens are documented as ~60 days but in practice often longer. The snapshot worker (U6) detects token expiry via API error and flips status to `needs_reauth`. A dedicated refresh path is not built in v1 — admin re-runs the OAuth flow when prompted.

**Patterns to follow:**
- `src/lib/youtube-oauth.ts` (OAuth flow shape, state parameter, `.env` access pattern)
- `src/app/api/oauth/youtube/callback/route.ts` (callback structure, error redirects to admin page with `?error=` param)

**Test scenarios:**
- Authorize route rejects non-admin users
- Callback handles missing `code` param gracefully
- Callback handles user-denied OAuth (`error=access_denied`) and redirects to mapping page with message
- Mapping page renders one row per Page returned, with linked IG account shown as a sub-row
- Submitting the mapping form creates `SocialAccount` + `SocialAccountCredential` for each mapped Page and IG account
- "Skip" mapping for a Page produces no DB rows for that Page
- Re-running OAuth for an already-mapped Page updates the existing `SocialAccount` (matched by `externalId`) and refreshes its token, rather than creating a duplicate
- Storing token does not log the token value to activity log or stdout

**Verification:** Admin completes Facebook Login flow, sees all SWM Pages with mapping dropdowns, submits, and `social_accounts` contains one row per mapped Page + IG account with valid Page Access Tokens.

---

### U5. TikTok OAuth: per-creator connection

**Goal:** Implement TikTok Login Kit OAuth for individual creator accounts.

**Requirements:** Connect TikTok creator accounts (show or host) and fetch follower count.

**Dependencies:** U1, U2.

**Files:**
- `src/lib/social/tiktok-oauth.ts`
- `src/app/api/oauth/tiktok/authorize/route.ts`
- `src/app/api/oauth/tiktok/callback/route.ts`
- `src/lib/social/__tests__/tiktok-oauth.test.ts`
- `.env.example` (add `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`)

**Approach:**
- Authorize route redirects to `https://www.tiktok.com/v2/auth/authorize` with scopes `user.info.basic`, `user.info.profile`, `user.info.stats`. `state` encodes a "pending mapping" record so the callback can attribute the connection to a show or host.
  - UX wrinkle: TikTok OAuth requires the admin to know *before* clicking Connect whether they're connecting "Show X's account" or "Host Y's account." Add a small selector on the connect button: "Connect TikTok for: [Show ▼] [Host ▼]". The selection is encoded in `state`.
- Callback exchanges code for access token + refresh token (good for 365 days from issuance, refreshable). Calls `GET /v2/user/info/?fields=open_id,union_id,display_name,follower_count,avatar_url`. Creates one `SocialAccount` + `SocialAccountCredential`.
- Token refresh in the worker: refresh proactively when within 7 days of expiry.

**Patterns to follow:**
- `src/lib/youtube-oauth.ts` (token-exchange pattern, refresh-token storage)

**Test scenarios:**
- Authorize redirects with correct scopes and `state` parameter
- Callback rejects mismatched / expired state
- Successful callback creates a `SocialAccount` with `externalId = open_id`
- Re-connecting the same TikTok account updates the existing row rather than duplicating
- Token expiry within 7 days triggers refresh; refresh failure flips status to `needs_reauth`
- Admin without "Show X" / "Host Y" selection at connect time sees a validation error before redirect

**Verification:** Admin selects "Connect TikTok for Show: The Clubhouse", completes OAuth, returns to admin page; `social_accounts` has the new row tied to The Clubhouse's `wpShowId`.

---

### U6. Daily snapshot worker

**Goal:** Single scheduled job that snapshots follower counts for every active `SocialAccount`, isolates per-account errors, and refreshes tokens proactively.

**Requirements:** Daily history that powers trend charts; resilience to single-platform outages.

**Dependencies:** U1, U3, U4, U5.

**Files:**
- `src/lib/social/fetchers.ts` (uniform `fetchFollowerCount(account, credential): Promise<number>` dispatcher)
- `src/lib/social/snapshot.ts` (worker logic: iterate accounts, fetch, insert)
- `src/app/api/cron/social-snapshot/route.ts` (HTTP endpoint Railway cron hits with a shared-secret header)
- `src/lib/social/__tests__/snapshot.test.ts`
- `.env.example` (add `CRON_SECRET`)

**Approach:**
- Endpoint guarded by `Authorization: Bearer ${CRON_SECRET}` header.
- Worker queries all `SocialAccount` rows with `status="active"`.
- X accounts batched in groups of 100 (one API call per batch).
- Meta accounts: one `GET /{page_id}?fields=followers_count` per Page using its Page Access Token. IG accounts: `GET /{ig_user_id}?fields=followers_count` using the linked Page's token.
- TikTok accounts: one `GET /v2/user/info/?fields=follower_count` per creator, after refreshing token if within 7-day expiry window.
- Each account's fetch wrapped in try/catch: on success insert `SocialFollowerSnapshot`; on failure log to `ActivityLog` and increment a per-account failure counter (5 consecutive failures → flip status to `needs_reauth`).
- Returns JSON summary: `{ totalAccounts, snapshotsInserted, failures: [{accountId, platform, error}] }`.

**Execution note:** Test-first for the dispatcher and error isolation logic — both are easy to get wrong and hard to debug in production cron runs.

**Patterns to follow:**
- Existing scraper/cron pattern if any exists in `scripts/transistor-scraper/` (verify during implementation)
- `src/lib/analytics/transistor.ts` API client style for retry/backoff

**Test scenarios:**
- Worker processes mixed-platform set without one platform's failure affecting others
- X batch of 250 accounts splits into 100 + 100 + 50
- Meta API returns 401 (token expired) — account is flipped to `needs_reauth` and worker continues
- TikTok token within 7-day expiry triggers refresh before fetch
- Successful fetch inserts exactly one `SocialFollowerSnapshot` row with `capturedAt` = now
- Cron endpoint without `CRON_SECRET` header returns 401
- Duplicate snapshot on the same calendar day is allowed (we keep all snapshots; UI dedupes if needed)

**Verification:** Manual hit of `/api/cron/social-snapshot` with the secret header populates `social_follower_snapshots` for every active account; failures are isolated to the offending account.

---

### U7. Social analytics tab (`/dashboard/analytics/social`)

**Goal:** Consume the snapshot data and surface it in the producer dashboard with the same shape as existing Podcasts/YouTube tabs.

**Requirements:** Producers see current follower counts and growth trends for their shows' social accounts, alongside their podcast metrics.

**Dependencies:** U1, U6 (needs snapshot data to render meaningfully).

**Files:**
- `src/components/analytics/analytics-nav.tsx` (modified: add "Social" tab)
- `src/app/dashboard/analytics/social/page.tsx`
- `src/app/dashboard/analytics/social/actions.ts` (server action: load snapshots for show + date range)
- `src/components/analytics/social-section.tsx` (stat cards + per-platform breakdown)
- `src/components/analytics/charts/social-trend-chart.tsx`
- `src/components/analytics/__tests__/social-section.test.tsx`

**Approach:**
- Reuse `hierarchical-show-selector` and `date-range-picker` from existing tabs.
- Page queries `SocialAccount` filtered by the user's allowed shows (`UserShowAccess`), joins latest snapshot per account.
- Stat cards: one per platform per show, showing current count + delta over the selected date range (current minus snapshot closest to range start).
- Trend chart: line per platform, X axis = date, Y axis = follower count. Uses the same chart library as `src/components/analytics/charts/`.
- Empty states: show "No Facebook account connected" with a link to `/admin/social-accounts` if the user is admin, or "Contact your admin" if not.
- Respects existing user permissions: a producer with `UserShowAccess` for only Show A sees only Show A's social data.

**Patterns to follow:**
- `src/app/dashboard/analytics/youtube/page.tsx` (date range + show selector + stat cards layout)
- `src/components/analytics/listeners-section.tsx` (stat card composition)
- `src/lib/analytics/access.ts` (permission filtering)

**Test scenarios:**
- Page renders with no social accounts → friendly empty state
- Page renders with one show, all four platforms → four stat cards + one trend chart with four lines
- Producer with access to only one show does not see other shows' data even via URL manipulation (`?show=` param)
- Delta calculation handles the case where no snapshot exists at the start of the range (falls back to earliest available)
- Trend chart correctly displays gaps for days where snapshots are missing
- Stat card shows "Needs reauth" warning when underlying `SocialAccount.status = "needs_reauth"`
- Adding "Social" tab to `analytics-nav.tsx` preserves the selection query-string behavior the existing tabs use

**Verification:** Producer with access to The Clubhouse navigates to `/dashboard/analytics/social`, sees stat cards for FB/IG/TikTok/X (where connected), and a multi-line trend chart populated by the snapshot history.

---

## System-Wide Impact

| Surface | Impact |
|---|---|
| **Database** | Three new tables (`social_accounts`, `social_account_credentials`, `social_follower_snapshots`). Additive; no changes to existing tables. |
| **Admin UI** | New page at `/admin/social-accounts` (+ `/admin/social-accounts/meta-mapping`). Existing `/admin/credentials` is unchanged. |
| **Dashboard UI** | One new tab in `analytics-nav.tsx`. Existing Overview/Podcasts/YouTube/Compare tabs unchanged. |
| **Auth** | No changes to NextAuth config. Reuses `requireAdmin()` for admin routes and `UserShowAccess` for producer scoping. |
| **Background jobs** | One new Railway cron target (`/api/cron/social-snapshot`). |
| **Env vars** | Five new: `META_APP_ID`, `META_APP_SECRET`, `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `X_BEARER_TOKEN`, `CRON_SECRET`. Add to `.env.example`. |
| **External services** | Three new app registrations: Meta for Developers app (with app review for production scopes), TikTok for Developers app (with audit), X Developer account on Basic tier. |
| **Activity log** | Connection events, mapping events, token refresh failures, and snapshot worker failures all flow through existing `ActivityLog`. |

---

## Risks and Mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Meta app review delay** — Meta requires app review for `pages_read_engagement`, `instagram_manage_insights`, and `business_management`. Review can take 1–4 weeks and may require screencasts and a public privacy policy. | High | High — blocks Meta integration | Submit app review concurrent with U4 development. Use development mode + test users to build and verify before submitting. The portal already has `/privacy` and `/terms` pages. |
| **TikTok audit delay** — TikTok Display API requires audit; similar wait time. | High | Medium — blocks TikTok integration only | Submit early; X and Meta can ship independently if TikTok is delayed. |
| **X API cost** — Basic tier (~$200/mo) is a real recurring cost. | Certain | Low — known cost, small relative to platform value | Confirm budget before purchasing credentials; the data model and worker tolerate X being absent. |
| **Meta Page Access Token expiry** — Tokens nominally last 60 days but can be invalidated earlier (password change, scope revocation, user deletion). | Medium | Medium — admin must re-OAuth that Page | `status="needs_reauth"` flag + visible warning in admin UI. Snapshot worker detects 401 and flips status atomically. |
| **Rate limits during snapshot batch** — Especially Meta (200 calls/hour/user) and TikTok. | Low | Medium — partial daily snapshot | Worker logs partial failures and proceeds; missed accounts retry next day. If chronic, add jitter or split worker into per-platform crons. |
| **Scraping temptation** when official APIs gate access to accounts SWM doesn't admin | Medium | High (ToS / legal) | Plan explicitly excludes scraping. Document this decision; reject scope creep that proposes it as a workaround. |
| **Personal/host accounts disappear or rebrand** — host leaves SWM, deletes account, etc. | Medium | Low | `status="removed"` soft-delete preserves historical snapshots; UI hides removed accounts by default. |
| **Token leakage in logs** — long-lived Page/refresh tokens written to ActivityLog by mistake | Low | High (security) | Code review checklist: tokens never passed to logger functions. Add a redacted helper for activity log entries that touch credentials. |

---

## Dependencies and Prerequisites

Must be in place before starting U3–U5:

1. **X Developer account on Basic tier** — register at developer.x.com, generate app-level Bearer token. Required before U3 can be verified end-to-end.
2. **Meta for Developers app** — create app, add Facebook Login and Instagram Graph API products, register OAuth redirect URI (`{NEXTAUTH_URL}/api/oauth/meta/callback`), submit for app review with required scopes. Development-mode work can proceed with test users in parallel with review.
3. **TikTok for Developers app** — create app, request Login Kit, register redirect URI (`{NEXTAUTH_URL}/api/oauth/tiktok/callback`), submit audit.
4. **Railway cron job configured** — add scheduled job hitting `/api/cron/social-snapshot` daily; verify `CRON_SECRET` is set in Railway env.

U1 and U2 have no external prerequisites and can begin immediately.

---

## Operational Notes

- **Rollout sequencing:** U1 → U2 → U3 (X — no app review needed) → U6 (worker, X-only initially) → U7 (dashboard, X-only view). Meta and TikTok land as their app reviews clear; the worker and dashboard already accommodate them.
- **Monitoring:** Snapshot worker writes summary stats to `ActivityLog` on every run. Failures over 5 consecutive runs for a single account flip status; admin sees this on `/admin/social-accounts`.
- **Backfill:** No backfill possible — follower counts at past dates are not available from any platform's API. The trend chart will simply start showing data from the day the snapshot worker first ran.
- **Cost ceiling:** X API Basic ($200/mo). Meta + TikTok are free at our expected volume. Hosting impact of new tables is negligible.

---

## Deferred Implementation Questions

These should be resolved during implementation, not planning:

- Exact shape of token-refresh logic for Meta — whether to refresh proactively on a schedule or lazily on 401 detection (current plan: lazy, but reassess if 401s are common)
- Whether the X username validator (`addXHandle`) should also fetch and persist `displayName` and a current snapshot immediately, or wait for the first cron run
- Whether the social trend chart should share a chart component with podcast/YouTube trend charts or be its own thing — depends on the existing chart abstraction's flexibility
- Whether to add a `?platform=` filter to `/dashboard/analytics/social` for users with many platforms — wait for usage to decide
- How "host" accounts surface in `hierarchical-show-selector` — they don't have `wpShowId`. Likely a separate "Hosts" section in the selector; implementer should verify the component's extensibility before committing to a shape
