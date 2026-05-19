# Live Recording — Production Setup Guide

This is the operator checklist for turning on the live-recording feature in production. Everything below needs to land before the first real Vimeo Live broadcast for it to work end-to-end.

Sequencing matters in places — follow the order below.

Companion to:
- `docs/plans/2026-05-18-001-feat-live-recording-ingest-plan.md` (architecture)
- `docs/live-recording-wordpress-coordination.md` (WP-side spec for the website Claude)

---

## What I (portal Claude) already did

Production now has the portal-side code:
- `LiveRecording` table (migration auto-applies on first Railway container restart of swm-producer-portal-production)
- Admin route at `/dashboard/live-recordings/new` to schedule a recording
- Polling cron handler at `/api/cron/live-recording-poll` (waiting for Railway cron config)
- YouTube → Transistor handoff logic
- Detail view + Cancel / Retry / Force-archive admin actions
- List view at `/dashboard/live-recordings` + new sidebar nav item

Code is live but inert until the steps below are done.

---

## Step 1 — Verify the migration applied on production

After Railway finishes the latest production deploy, check the build logs for:

```
[migrate] Applying: 20260518000000_add_live_recordings
[migrate] Applied: 20260518000000_add_live_recordings
```

If you see `[migrate] No pending migrations.` instead and the table doesn't exist, the deploy may have rolled back. Check Railway dashboard → swm-producer-portal service → Deployments.

**Verify manually if you want certainty:**

```
railway run --service swm-producer-portal --environment production -- bash -c 'echo "SELECT COUNT(*) FROM live_recordings;" | psql $DATABASE_URL'
```

Expected: `0` (empty table). If you get an error about the table not existing, the migration didn't run — open a Railway support ticket or re-deploy.

---

## Step 2 — CRON_SECRET in Railway

This env var protects the cron endpoint from arbitrary internet callers. If you set it up for the social-snapshot work (from the social media plan), the same value is fine — the live-recording cron uses the same `CRON_SECRET`.

**Check whether it's already set:**

In Railway dashboard → swm-producer-portal-production → Variables, look for `CRON_SECRET`. If present, skip to Step 3.

**If not set, generate one:**

```
openssl rand -hex 32
```

Copy the 64-character hex output. In Railway:

1. swm-producer-portal-production → Variables → New Variable
2. Name: `CRON_SECRET`
3. Value: (paste the hex string)
4. Save — Railway will redeploy automatically (~1 min)

Keep a copy of the value — you'll need it for Step 3.

---

## Step 3 — Schedule the Railway cron job

The cron hits the portal's polling endpoint every 2 minutes. You can use Railway's built-in cron (if available on your plan) or schedule via your service's cron sidecar — whichever pattern you already use for the transistor-scraper cron job.

**Endpoint to hit:**

```
POST https://portal.stolenwatermedia.com/api/cron/live-recording-poll
Authorization: Bearer <CRON_SECRET value from Step 2>
```

**Recommended schedule:** every 2 minutes (`*/2 * * * *`).

**If Railway's cron service expects a shell command:**

```
curl -s -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://portal.stolenwatermedia.com/api/cron/live-recording-poll
```

**Verify it works after first tick (~2 min after configuration):**

In Railway logs for swm-producer-portal-production, look for:

```
[live-recording-poll] checked=0 transitions=0 handoffs=0 archived=0 failures=0
```

Zero across the board is correct when there are no recordings yet. The presence of the log line confirms the endpoint received the call and the auth check passed.

**If you see `Unauthorized`:** the CRON_SECRET your cron job is sending doesn't match what's in the env var. Double-check the value matches exactly (no trailing whitespace, no quotes around it).

**If you see no log line at all:** the cron job isn't firing. Check the Railway cron config — depending on which scheduler you're using, the syntax differs. Compare against the transistor-scraper cron, which is the working reference.

---

## Step 4 — WordPress plugin work (your other Claude)

The portal can write the new `_swm_episode_*` meta fields, but the WP theme needs to know what to render. Until this lands, scheduled live recordings will technically create WP posts, but the theme will render them as standard studio episodes with empty content — confusing for visitors.

**Hand `docs/live-recording-wordpress-coordination.md` to your website Claude.** That doc fully specifies:

- The 7 new meta keys to register on `swm_episode` (with `show_in_rest => true`)
- Per-state template branches (scheduled / live / ended_pending / archived / cancelled)
- The auto-refresh JS for the live page

**Critical:** the WP work should land **before** anyone creates a real live recording in the portal. The portal can publish a placeholder, but if the theme isn't ready, the live banner / countdown / "watch live" CTA won't appear — visitors see a blank-looking page.

The website Claude's checklist (mirrored here for visibility):

1. Register the 7 new meta keys via `register_meta` with `show_in_rest => true`
2. Add template branches for the four user-visible states
3. Wire JS polling on the live page (60-second interval, stops once state = archived)
4. Verify with a curl test:
   ```
   curl -X POST 'https://stolenwatermedia.com/wp-json/wp/v2/swm_episode/<id>' \
     -H "Authorization: Basic $(echo -n $WP_APP_USER:$WP_APP_PASSWORD | base64)" \
     -H 'Content-Type: application/json' \
     -d '{"meta":{"_swm_episode_live_state":"live"}}'
   ```
   followed by a GET to confirm the meta persisted. If `_swm_episode_live_state` doesn't update, REST registration didn't take.

---

## Step 5 — First broadcast: dress rehearsal

Once Steps 1–4 are done, run a low-stakes dress rehearsal before the first real public broadcast. Suggested flow:

1. **In Vimeo Live:** Set up a test event. Note the YouTube simulcast URL it generates.
2. **In the portal:** Go to `/dashboard/live-recordings/new` (admin only), enter:
   - Show: any show with YouTube credentials set up (Your Dark Companion is the natural test case)
   - Scheduled start: 5-10 minutes from now
   - YouTube URL: from Vimeo
   - Title + description: anything obviously test-flavored
3. **Click Schedule Recording.** You should land on the detail page showing state = `scheduled`.
4. **Open the public-facing WP post** in another tab. The website should now show "Going live at <time>".
5. **Start the Vimeo broadcast.** Within 2 minutes, the portal should flip the recording to `live` state, the website page should update (via the JS polling) to "Watch live →".
6. **End the broadcast.** Within 2 minutes, state → `ended_pending`, the website should show "Stream ended, replay coming shortly".
7. **Wait ~30 min** (YouTube VOD processing window). The handoff fires, yt-dlp downloads the audio, Transistor receives the upload, state → `archived`. The website page reloads to show the YouTube embed.

**Watch the Railway logs throughout** — you should see the state transitions and the handoff fire. If anything looks stuck, the detail view at `/dashboard/live-recordings/<id>` shows the last error and lets you Cancel / Retry / Force-archive.

---

## What this does NOT do yet (deferred)

After the live recording archives, the WP post has the YouTube embed but **no transcript and no AI-generated blog content** — that pipeline isn't wired up for live recordings in v1. The Transistor episode is created and visible in Transistor, but the post-Transistor processing (transcription via Deepgram, AI blog via Claude, WordPress write-through) requires the producer to manually trigger blog generation via the existing `/admin/blog-ideas` flow.

This is documented as a follow-up in `src/lib/live-recording/archive.ts` and in the plan's deferred-questions section. Building the auto-pipeline path needs a "Transistor episode → DistributionJob" trigger that doesn't exist today — a meaningful follow-up project rather than a small patch.

For the producers' day-to-day, the manual step is: open `/admin/blog-ideas` after the archive, pick the new episode, click Generate Custom Blog with the host-style guide. Takes about 2 minutes per episode.

---

## When things go wrong — quick lookup

| Symptom | Likely cause | Fix |
|---|---|---|
| Recording stuck in `scheduled` past the actual start time | Polling cron isn't running, OR YouTube credentials for the show are broken | Check Railway cron logs; verify show's YouTube OAuth in `/admin/credentials/<showId>` |
| Recording flipped to `live` but website doesn't show live banner | WP-side template branches not deployed yet | Verify Step 4 |
| Recording stuck in `ended_pending` for hours | YouTube archive still processing OR yt-dlp failing | Detail view shows download attempts + last error. If 5+ failed attempts, state should be `stuck` |
| State = `stuck` | Either YouTube archive issue or Transistor upload issue | Detail view shows the exact error. Click Retry to attempt again, or Force archive to bypass (if you uploaded to Transistor manually) |
| Recording cancelled but still on website | WP unpublish failed (network issue, auth issue) | Manually unpublish from WP admin |
| `Unauthorized` from cron endpoint | CRON_SECRET mismatch | Verify the value in Railway matches what the cron job sends |

---

## Open questions / decisions you may want to make later

- **Stuck threshold** is currently 5 download attempts (~30 min of polling). If broadcasts consistently take longer to archive on YouTube, bump this in `src/lib/live-recording/handoff.ts` (`STUCK_THRESHOLD` const).
- **Polling window** for `scheduled` recordings is ±2 hours of `scheduledStartAt`. Recordings outside that window sleep. If you schedule recordings days in advance and producers sometimes start broadcasts early, widen the window in `src/lib/live-recording/poll.ts` (`SCHEDULED_POLL_WINDOW_MS`).
- **Cancel behavior** sets WP post status to `private` so it disappears from the public site. If you'd rather it disappear into trash instead (different recovery path), change `unpublishWpPost` in `src/app/dashboard/live-recordings/[id]/actions.ts`.
- **Producer self-serve** is gated to admin-only in v1. To allow producers to schedule their own shows' recordings: change `requireAdmin()` to `requireContentTypeAccess` in `src/app/dashboard/live-recordings/new/page.tsx` and check the same for the server action.
- **Recurring schedules** (e.g., "every Tuesday 7 PM" for YDC) aren't built — producers create each broadcast manually. Worth building if you hit 10+ recordings/week and the manual entry becomes a chore.
