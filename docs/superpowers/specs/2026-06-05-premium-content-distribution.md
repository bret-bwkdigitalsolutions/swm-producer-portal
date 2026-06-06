# Premium Content Distribution

## Overview

Enable producers to distribute premium (gated) content across all three platforms — WordPress, Transistor, and YouTube — with subscriber access managed centrally through the website and synced to Transistor in real-time.

## Repos Involved

- **swm-producer-portal** — distribution form, processor, subscriber sync receiver, reconciliation cron
- **website-stolenwatermedia** — Stripe webhook → portal notification, subscriber list REST endpoint

## Platform Behavior

| Platform | Premium behavior | Gating mechanism |
|----------|-----------------|------------------|
| WordPress | Sets `is_premium_only` meta on episode post | Existing `swm-premium` plugin handles frontend gating |
| Transistor | Uploads to a separate private show per show | Per-subscriber unique RSS feeds; managed via Transistor subscriber API |
| YouTube | Uploads as `unlisted` (producer manually flips to members-only in Studio) | YouTube channel memberships (no API for members-only) |

## Section 1: Distribution Flow

### Distribution Form

The distribution form (`src/app/dashboard/distribute/new/distribution-form.tsx`) gets a "Premium content" toggle. The toggle is only visible when the selected show has `premiumEnabled: true` in `ShowMetadata`.

When premium is toggled on:
- YouTube privacy defaults to `unlisted` instead of `public` (producer can override)
- The form stores the premium flag on the job

### Database

Add to `DistributionJob`:
```
isPremium Boolean @default(false)
```

### Processor Changes

The processor (`src/lib/jobs/processor.ts`) reads `job.isPremium` and routes accordingly:

- **YouTube phase**: Uses `unlisted` privacy when `isPremium` and no explicit override. The job detail page shows a reminder to flip to members-only in YouTube Studio.
- **Transistor phase**: Looks up `showMetadata.transistorPrivateShowId`. If set and `isPremium`, uploads to the private show instead of the public one. If `transistorPrivateShowId` is not configured, the Transistor upload fails with a clear error message.
- **WordPress phase**: Adds `is_premium_only: true` to the post meta payload when `isPremium`.

## Section 2: Transistor Private Shows & Credential Storage

### New Fields on ShowMetadata

```
premiumEnabled          Boolean  @default(false)
transistorPrivateShowId String?
```

- `premiumEnabled` controls whether the premium toggle appears in the distribution form
- `transistorPrivateShowId` is the Transistor show ID for the private feed, set manually after creating the private show in Transistor's dashboard

### Credential Reuse

Transistor uses one API key per account, not per show. The existing credential resolution (`src/lib/analytics/credentials.ts`) works for both public and private shows. The processor swaps which `show_id` it passes to `uploadToTransistor` based on `isPremium`.

### Admin UI

The show settings page (`src/app/admin/shows/`) gets a "Premium content" section:
- Toggle for `premiumEnabled`
- Text input for `transistorPrivateShowId` (visible only when premium is enabled)

## Section 3: Subscriber Sync

Website is the source of truth. Subscription changes push to Transistor via the portal.

### 3a. Website Webhook (WordPress Plugin)

The `swm-premium` plugin hooks into its Stripe webhook processing. On subscription lifecycle events, it fires a POST to the portal:

```
POST https://portal.stolenwatermedia.com/api/webhooks/subscription
Authorization: Bearer <SUBSCRIPTION_WEBHOOK_SECRET>

{
  "event": "subscription.created" | "subscription.cancelled" | "subscription.expired",
  "email": "subscriber@example.com",
  "wpShowId": 21,
  "scope": "show" | "all_access",
  "status": "active" | "cancelled" | "past_due"
}
```

`wpShowId` is the portal's show ID (same values used throughout the portal — e.g., 21 for YDC). The website plugin reads the show's `parent_show_id` meta (which already stores the portal-compatible ID) and sends that. For `all_access` scope, `wpShowId` is 0.

New env var on both sides: `SUBSCRIPTION_WEBHOOK_SECRET`.

### 3b. Portal Webhook Receiver

New API route: `src/app/api/webhooks/subscription/route.ts`

1. Validates the shared secret
2. Looks up `ShowMetadata.transistorPrivateShowId` for the given `wpShowId`
4. Calls the Transistor subscriber API:
   - `subscription.created` → `POST /v1/subscribers` with `show_id` and `email`, `skip_welcome_email: true`
   - `subscription.cancelled` / `subscription.expired` → `DELETE /v1/subscribers` with `show_id` and `email`
5. For `all_access` scope: iterates all shows with `transistorPrivateShowId` set and adds/removes the subscriber from each

### 3c. Nightly Reconciliation

A scheduled cron job (Railway cron hitting a portal API endpoint):

1. Calls a new WP REST endpoint (`/wp-json/swm-premium/v1/subscribers`) that returns active subscribers grouped by show
2. For each show with a `transistorPrivateShowId`:
   - Fetches current Transistor subscribers via `GET /v1/subscribers?show_id=<private_id>`
   - Compares email lists
   - Adds subscribers present on the website but missing from Transistor
   - Removes subscribers present on Transistor but not on the website
3. Logs results; sends notification email only if discrepancies were found and corrected

New WP REST endpoint is authenticated with the same app password used for other portal→WP API calls.

## Section 4: Live Recording Integration

Live recordings already have `isPremiumOnly` on the `LiveRecording` model. The handoff code (`src/lib/live-recording/handoff.ts`) must carry this flag forward when creating a `DistributionJob`, setting `isPremium: true` so premium routing activates automatically.

## Section 5: Verification

The verification system (`src/lib/jobs/verify-distribution.ts`) becomes premium-aware:

- **YouTube**: For premium jobs, accept `unlisted` as a valid privacy status. Skip the public URL HEAD check for unlisted videos.
- **Transistor**: No change needed — `externalId` already references the correct episode. API key works across public and private shows.
- **WordPress**: No change needed — gated pages return 200 (paywall rendered for non-subscribers). `is_premium_only` posts with status `publish` are valid.

## Migration & Setup Steps

1. Create private Transistor shows for YDC (and any future premium shows)
2. Run Prisma migration adding `isPremium` to `DistributionJob` and `premiumEnabled`/`transistorPrivateShowId` to `ShowMetadata`
3. Set `premiumEnabled: true` and `transistorPrivateShowId` for YDC in admin
4. Add `SUBSCRIPTION_WEBHOOK_SECRET` env var to both Railway (portal) and Cloudways (website)
5. Deploy website plugin changes (webhook firing)
6. Deploy portal changes (distribution form, processor, webhook receiver, reconciliation cron)
7. Run initial reconciliation to seed Transistor private show subscribers from existing website subscriber list

## Out of Scope

- YouTube members-only API (doesn't exist)
- YouTube member list sync (read-only, marginal value)
- Per-episode gating within a single Transistor feed (Transistor doesn't support this)
- Subscriber management UI in the portal (website handles this via Stripe/Firebase)
- New subscription tiers or pricing changes
