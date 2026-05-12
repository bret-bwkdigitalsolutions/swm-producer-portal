# Social Media Follower Analytics — Manual Setup Guide

Companion to `docs/plans/2026-05-11-001-feat-social-media-follower-analytics-plan.md`. This is the list of human-only tasks (developer-account signups, app reviews, paid plans, secret generation) that have to happen before the code in U3–U7 can ship to production.

## TL;DR Sequence

| When | Task | Unblocks |
|---|---|---|
| **Now** | Sign up for X Developer Basic, grab Bearer token | U3 — ships within hours of this |
| **Now** | Create Meta for Developers app, set redirect URIs, save secrets | U4 development |
| **Now** | Create TikTok for Developers app, request Login Kit, save secrets | U5 development |
| **After U4 deployed to staging in dev mode** | Submit Meta app for review | U4 → production (1–4 week wait) |
| **After U5 deployed to staging in sandbox** | Submit TikTok app for audit | U5 → production (similar wait) |
| **After U6 lands** | Configure Railway cron + generate `CRON_SECRET` | Daily snapshots running |

X can go end-to-end first because it has no review process. Meta and TikTok need real working OAuth flows on a publicly reachable URL before they'll approve. That means I have to build U4/U5 against your dev-mode apps before you can submit for review.

---

## 1. X (Twitter) Developer Account

**Cost:** ~$200/month (Basic tier — required for any read access since 2023). Free tier is write-only and won't work for follower counts.

**Time:** 30 minutes if you have a corporate card ready.

### Steps

1. Go to https://developer.x.com/en/portal/dashboard
2. Sign in with whichever X account should own SWM's developer presence. **Don't use a personal account** — this is the account that will pay for and own the API access. If SWM doesn't have a dedicated org account on X, create one first.
3. Apply for developer access — fill out the use-case form. Honest answers: "Reading public follower counts for shows and hosts we manage, displayed in our internal producer dashboard."
4. Once approved (usually instant), click **Subscribe** on the Basic tier. Enter payment info.
5. Create a new **Project** named e.g. `SWM Producer Portal`.
6. Inside that Project, create an **App**.
7. In App Settings → **Keys and tokens** → **Bearer Token** → click **Generate**.
8. **Copy the Bearer Token immediately** — X will only show it once. If you lose it, you'll have to regenerate (which invalidates the old one).
9. In Railway, set this env var on both `staging` and `production` services:
   - `X_BEARER_TOKEN=<the bearer token>`
10. Also add it to your local `.env.local` so dev can hit the API.

### Verification

After U3 ships and the env var is set, an admin should be able to go to `/admin/social-accounts`, click **Add X Handle**, enter a known handle (e.g. `stolenwatermedia`), and see the follower count populate.

### Gotchas

- The Bearer Token is app-level, not user-level. One token covers every handle lookup.
- Basic tier has a **10,000 reads/month** limit. Snapshotting 100 accounts daily = 3,000/month, comfortable. If you grow past ~300 accounts you'd need Pro tier (~$5000/mo) or to skip days.
- The `users/by` endpoint accepts up to **100 usernames per request**, so the snapshot worker batches efficiently.

---

## 2. Meta for Developers (Facebook + Instagram)

**Cost:** Free.

**Time:** ~2 hours to set up the app, plus **1–4 weeks** for App Review.

### Prerequisites

- Someone at SWM must have **admin role on every Facebook Page** you want to track. If a show's Page is owned by a host's personal FB account, you'll need either to (a) get the host to add an SWM admin as a Page admin, or (b) have the host go through the OAuth flow themselves later.
- Each Instagram account must be a **Business or Creator account** (not Personal) and must be **linked to a Facebook Page**. Verify in the Instagram app: Settings → Account Center → Connected experiences → Facebook. If any IG account isn't linked, link it now — that's a 5-minute fix per account and is required for the Graph API to expose follower counts.
- Your Facebook account needs to be promoted to a **Business Account** in Meta Business Suite if it isn't already.

### Steps

#### 2a. Create the app

1. Go to https://developers.facebook.com/apps
2. Sign in with the Facebook account that admins the Pages.
3. Click **Create App**.
4. Choose use case: **Other** → **Business** type. (Don't pick "Consumer" — it gates the Instagram permissions.)
5. App name: `SWM Producer Portal`. Contact email: an SWM-monitored address.
6. Once created, you're in the app dashboard.

#### 2b. Add products

In the left sidebar:

1. Click **Add Product** → add **Facebook Login**. Configure with the **Web** platform.
2. Click **Add Product** → add **Instagram Graph API**.

#### 2c. Configure OAuth redirect URIs

1. Facebook Login → **Settings** → **Valid OAuth Redirect URIs**.
2. Add (one per line):
   - `https://<staging-domain>/api/oauth/meta/callback`
   - `https://<production-domain>/api/oauth/meta/callback`
   - `http://localhost:3000/api/oauth/meta/callback` (for local dev)

   *Replace `<staging-domain>` and `<production-domain>` with the actual Railway URLs. Find them in Railway → service → Settings → Networking.*

3. Save changes.

#### 2d. Grab the secrets

1. Settings → **Basic**.
2. Copy **App ID** and **App Secret** (click "Show" to reveal the secret).
3. In Railway, set on both `staging` and `production`:
   - `META_APP_ID=<app id>`
   - `META_APP_SECRET=<app secret>`
4. Also add to `.env.local`.

#### 2e. Add yourself + test users (dev mode)

While the app is in Development Mode, only listed users can complete the OAuth flow.

1. App Roles → **Roles** → add yourself as **Admin**.
2. App Roles → **Testers** → add any other SWM staff who'll test the connection flow.

This lets U4 development proceed without waiting for app review.

#### 2f. Submit for App Review (after U4 is built and on staging)

This step happens **after** I've built U4 and you've verified it works in dev mode against your test users on the staging deploy. Reviewers need to see a working OAuth flow.

Permissions to request, with the use-case rationale you'll paste into each one:

| Permission | Why we need it (paste this into the review form) |
|---|---|
| `pages_show_list` | List the Pages our admin user manages so we can map each one to a podcast show in our internal dashboard. |
| `pages_read_engagement` | Read `followers_count` for each managed Page to display trend analytics to our internal producer team. |
| `instagram_basic` | Read profile data for Instagram Business/Creator accounts linked to managed Pages, to identify which IG account belongs to which podcast show. |
| `instagram_manage_insights` | Read `followers_count` and basic insights for linked IG Business/Creator accounts to display trend analytics. |
| `business_management` | Required by Meta to enumerate Pages across multiple Business accounts an admin may manage. |

For each permission, the review form requires:

1. A **screencast** (3–5 min). I'll write a one-page screencast script to follow before you submit.
2. A **step-by-step instructions** field — describe exactly how a reviewer can reproduce the flow on staging.
3. **Test credentials** — staging URL + a test admin login.

Required public links (these pages already exist in the portal):

- Privacy policy: `https://<production-domain>/privacy`
- Terms of service: `https://<production-domain>/terms`
- App icon: 1024×1024 PNG (use SWM's standard logo).

**After submission:** Meta reviews in 1–4 weeks. They sometimes reject on first pass for unclear screencasts — budget for one re-submission. Keep the dev-mode app fully working so you can resubmit immediately if rejected.

### Verification

While in dev mode: any test user can complete OAuth at `/admin/social-accounts` → Connect Facebook + Instagram, and see their managed Pages appear on the mapping page.

After production approval: any admin (not just test users) can complete the flow.

### Gotchas

- **Page Access Tokens nominally last 60 days** but Meta can invalidate them earlier if the admin changes their FB password or revokes app access. The snapshot worker (U6) will detect 401s and flip `status="needs_reauth"` — you'll see a warning on `/admin/social-accounts` when that happens.
- **One admin's OAuth covers all Pages they admin.** If you have multiple admins each managing different Pages, each one runs the OAuth flow once. The mapping page will show all returned Pages from whichever admin just connected.
- **Instagram accounts inherit the linked Page's access token.** You don't OAuth Instagram separately. If an IG account is linked to a Page after the OAuth event, you'll need to re-run OAuth to pick it up.
- **Personal Instagram accounts are not supported by the API.** If a host has only a personal IG, you cannot track follower count via official API. They'd need to convert to Creator account (free, takes 2 minutes inside the IG app).

---

## 3. TikTok for Developers

**Cost:** Free.

**Time:** ~1 hour to set up, plus audit time (varies, usually 1–2 weeks).

### Prerequisites

- A TikTok account (any account works for the developer account itself — it doesn't need to be linked to your tracked creators).
- Each TikTok creator you want to track must be willing to log in via OAuth and grant access. There's no admin-bypass like Meta has.

### Steps

#### 3a. Create the developer app

1. Go to https://developers.tiktok.com/
2. Click **Manage apps** → sign in.
3. **Connect** the dev account to your organization (creates a TikTok for Business developer profile).
4. **Create an app**:
   - App name: `SWM Producer Portal`
   - App icon, description, category (Tools/Productivity is fine).
5. Once created, you're in the app dashboard.

#### 3b. Request Login Kit

1. In the app dashboard → **Add products** → request **Login Kit for Web**.
2. Configure OAuth redirect URLs:
   - `https://<staging-domain>/api/oauth/tiktok/callback`
   - `https://<production-domain>/api/oauth/tiktok/callback`
   - `http://localhost:3000/api/oauth/tiktok/callback`
3. Scopes to request (check these boxes):
   - `user.info.basic`
   - `user.info.profile`
   - `user.info.stats`

#### 3c. Grab the secrets

1. App dashboard → **App info**.
2. Copy **Client Key** and **Client Secret**.
3. In Railway, set on both `staging` and `production`:
   - `TIKTOK_CLIENT_KEY=<client key>`
   - `TIKTOK_CLIENT_SECRET=<client secret>`
4. Also add to `.env.local`.

#### 3d. Sandbox testing

While the app is in sandbox mode, only users you add as "Sandbox testers" can complete OAuth.

1. App dashboard → **Manage** → **Sandbox** → add SWM staff TikTok handles as testers.
2. Each tester must accept the invitation in their TikTok app before they can connect.

#### 3e. Submit for audit (after U5 is built and on staging)

Same shape as Meta: reviewers need a working flow on a publicly reachable URL.

1. App dashboard → **Submit for review**.
2. Provide:
   - Use case description: "Reading follower_count for podcast hosts and shows whose creators have authorized our app, displayed in our internal producer dashboard."
   - Demo video showing the OAuth flow and what the data is used for.
   - Test credentials for staging.

### Verification

In sandbox: any tester can connect at `/admin/social-accounts` → Connect TikTok (after picking a show or host to map to), and the row appears.

After production approval: any creator can complete the flow.

### Gotchas

- **Each creator must individually OAuth.** There is no equivalent of Meta's "list all Pages I admin." If The Clubhouse, Signal 51, and 10 hosts each have their own TikTok accounts, that's 12 OAuth events.
- **Refresh tokens are valid for 365 days.** The snapshot worker refreshes proactively when within 7 days of expiry. If a creator hasn't connected in over a year and the token has fully expired, they re-OAuth.
- **TikTok rate limits aren't well-documented** but our daily-snapshot pattern (one call per account per day) is well within practical limits.

---

## 4. Railway Cron Setup (after U6 lands)

This unlocks the daily snapshot worker. Hold off until U6 is implemented and deployed.

### Steps

1. **Generate a strong secret** locally:
   ```
   openssl rand -hex 32
   ```
   Copy the output.

2. In Railway, set on both `staging` and `production`:
   - `CRON_SECRET=<the 64-char hex string>`

3. In Railway dashboard → your service → **Settings** → **Cron**:
   - Click **Add Cron Job**.
   - Schedule: `0 4 * * *` (4 AM UTC daily — outside typical SWM working hours).
   - Command:
     ```
     curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<production-domain>/api/cron/social-snapshot
     ```
     *(use `<staging-domain>` on staging service's cron, `<production-domain>` on production)*

4. After the first run, check Railway logs for the service. You should see lines like:
   ```
   [social-snapshot] processed=12 inserted=12 failures=0
   ```

### Verification

After the first cron run, `social_follower_snapshots` has one row per active `SocialAccount`. The `/dashboard/analytics/social` tab will start showing data.

### Gotchas

- **Cron secrets are not the same as bearer tokens.** Each service (staging, production) should have its own `CRON_SECRET`. Never reuse.
- **Timezone:** Railway crons run in UTC. 4 AM UTC = midnight Eastern. Adjust if you want snapshots aligned to a different business day.
- **Backfill is impossible.** Trend charts start populating from the first cron run; there's no way to get historical follower counts from before that day.

---

## 5. Environment Variable Summary

When you're done, the staging and production Railway services should each have these new env vars set:

```
# X (Twitter)
X_BEARER_TOKEN=AAAA...

# Meta (Facebook + Instagram share these)
META_APP_ID=123456789012345
META_APP_SECRET=abc123...

# TikTok
TIKTOK_CLIENT_KEY=aw...
TIKTOK_CLIENT_SECRET=...

# Daily snapshot worker
CRON_SECRET=64-char-hex-from-openssl
```

Mirror these into your local `.env.local` (which is gitignored) for dev. Do **not** commit any of these values to the repo.

---

## 6. What I Still Need From You Before Building U4 and U5

When you're ready for me to start on U4 (Meta) and U5 (TikTok), I'll need:

1. **Staging domain** (the Railway URL — something like `swm-producer-portal-staging.up.railway.app`).
2. **Production domain** (so I can hardcode the production OAuth callback in the env-derived `NEXTAUTH_URL`).
3. Confirmation that `META_APP_ID` / `META_APP_SECRET` are set on staging.
4. Confirmation that `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` are set on staging.
5. The list of test users (SWM staff Facebook + TikTok handles) added to dev mode / sandbox on each app.

For U3 (X), all I need is `X_BEARER_TOKEN` set in staging — then say go.

---

## 7. Open Questions Worth Resolving Before App Review

These don't block development, but they'll affect what you put in the Meta and TikTok review forms:

- **Privacy policy update?** The existing `/privacy` page may need a line added about reading social-platform data on behalf of users. Worth showing to whoever owns SWM's legal copy.
- **App icon variants?** Meta wants 1024×1024; TikTok wants 240×240 minimum. Make sure SWM has both.
- **Who is the "data controller" of record?** Meta's review form asks. Usually whoever signs the app's Privacy Policy.
- **For hosts who don't work for SWM full-time**, is there a written agreement that SWM tracks their public follower counts? Not legally required for *public* data but reduces "why is SWM tracking me" friction.
