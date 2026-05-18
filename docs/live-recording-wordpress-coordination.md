# Live Recording — WordPress Coordination

This is the handoff doc from the producer portal team to the website/WordPress team. The portal owns the live-recording state machine and writes meta on the `swm_episode` post; the WP theme reads that meta and renders the correct page state. Both sides need to land in coordination, but they can be developed in parallel.

Companion to `docs/plans/2026-05-18-001-feat-live-recording-ingest-plan.md`.

---

## What changed and why

SWM shows now broadcast live via Vimeo Live → simulcast to YouTube. Volume: 5-15 live recordings per week across multiple shows (Your Dark Companion runs 2-3 weekly, with other shows expected to adopt the pattern). The portal needs to publish the WP post **before** the broadcast so the website can promote it, then update that same post as the broadcast moves through its lifecycle. The theme must render four distinct page states from the same post.

**Critical:** one WP post per live recording. The portal creates the `swm_episode` post in the `scheduled` state and the same post evolves through the lifecycle. The Transistor pipeline updates this post in place rather than creating a duplicate; the website team doesn't need to do anything special for that — it's a portal-side concern.

---

## New meta fields on `swm_episode`

All meta keys below need to be registered with `register_meta` and exposed via the REST API so the portal can write them via authenticated REST calls.

| Meta key | Type | Values / format | Written by | Read by |
|---|---|---|---|---|
| `_swm_episode_source` | string | `"live"` or `"studio"` | Portal at create time | Theme (defaults to `"studio"` when absent — preserves backward compat for existing studio episodes) |
| `_swm_episode_live_state` | string | `"scheduled"` \| `"live"` \| `"ended_pending"` \| `"archived"` \| `"cancelled"` \| `"stuck"` | Portal at every transition | Theme — drives template branching |
| `_swm_episode_youtube_live_url` | string | Canonical `https://www.youtube.com/watch?v=<id>` URL | Portal at create | Theme — `<a>` href for "Watch live" CTA |
| `_swm_episode_youtube_video_id` | string | Bare YouTube video ID (e.g. `dQw4w9WgXcQ`) | Portal at create | Theme — embed URL construction |
| `_swm_episode_scheduled_start` | string | ISO 8601 timestamp (e.g. `2026-05-20T19:00:00-05:00`) | Portal at create | Theme — countdown display in `scheduled` state |
| `_swm_episode_live_started_at` | string | ISO 8601 timestamp or empty | Portal when YouTube reports actualStartTime | Theme — "Live since" display in `live` state (optional) |
| `_swm_episode_live_ended_at` | string | ISO 8601 timestamp or empty | Portal when YouTube reports actualEndTime | Theme — "Stream ended at" display in `ended_pending` / `archived` states |
| `_swm_live_recording_portal_id` | string | Portal's `LiveRecording.id` (cuid) | Portal at create | Reserved for cross-system tracing; theme doesn't need to render it |

### `register_meta` requirements

For each key above, register with:

- `'show_in_rest' => true` (so the portal can write via REST)
- `'single' => true`
- `'type' => 'string'`
- `'auth_callback'` — return true when the user has `edit_post` capability for the target post (matches WP default for app-password authenticated writes)

**Critical:** these meta keys must travel through the same `rest_after_insert_<cpt>` defensive hook added to the SWM plugins in the 2026-05-17 fix. If the portal's payload includes any of these meta keys in a `POST /wp-json/wp/v2/swm_episode/<id>` call, the hook should re-apply them after WP core's default save logic — same belt-and-suspenders pattern that made `featured_media` updates stick.

---

## Template rendering by state

Same `swm_episode` post, four distinct page layouts. Branch on `_swm_episode_live_state` (treat absent value as not-a-live-recording — fall through to standard studio episode rendering).

### `scheduled`

Show as an "upcoming live event" page. Page is published from creation, so it's publicly accessible the moment the portal creates it.

- Hero with the show's branding (or YouTube thumbnail if available — see Poster image section below)
- Title + description
- **"Going live at &lt;localized scheduled_start&gt;"** prominently displayed (e.g. "Going live Friday at 7:00 PM CT")
- Optional countdown timer (JS, refreshes once per second locally; doesn't require server hits)
- No audio player, no transcript, no embed
- Calendar add-to button (optional, nice-to-have)

### `live`

Stream is currently broadcasting.

- Same hero
- **"🔴 LIVE NOW"** badge
- Prominent **"Watch on YouTube →"** CTA pointing at `_swm_episode_youtube_live_url`
- Optionally embed the YouTube live player directly (`<iframe>` with the live video ID) — gives in-page viewing without leaving the site
- "Live since &lt;_swm_episode_live_started_at&gt;" subtle subtitle

### `ended_pending`

Broadcast just ended. Portal is downloading + processing.

- Hero (now you can use the YouTube auto-generated thumbnail — `https://img.youtube.com/vi/<video_id>/maxresdefault.jpg`)
- **"Stream ended — replay coming shortly"** banner
- "Stream ended at &lt;_swm_episode_live_ended_at&gt;" subtitle
- No transcript, no blog content yet
- Optionally: link to YouTube where the archived video is being processed

### `archived`

Full episode is ready. This is the steady-state rendering and should look (or be) identical to a regular studio episode page.

- Hero with featured image (portal sets `featured_media` at this stage)
- Title, description, full blog content (from `post_content`)
- Audio player (using Transistor embed or local audio, whichever the existing studio episode page uses)
- YouTube embed (`https://www.youtube.com/embed/<_swm_episode_youtube_video_id>`)
- Transcript section
- Standard episode meta (date, length, etc.)
- No live-state badge

### `cancelled`

Admin cancelled the recording before or during broadcast. Portal sets WP post status to `private` (or `trash`, configurable) so this state may not be publicly visible. If you choose to keep the post `publish` after cancellation, render an explicit "this recording was cancelled" page so visitors aren't confused.

### `stuck`

Portal-side processing failed repeatedly. **Render as `ended_pending`** from the public's perspective — they shouldn't see error states. Admin sees the actual `stuck` state in the portal UI and handles recovery there.

---

## Auto-refresh on the live page

While `_swm_episode_live_state` is in `{scheduled, live, ended_pending}`, the page should auto-refresh state without requiring the visitor to manually reload — they should see "scheduled" flip to "live" without intervention.

Two ways to implement, in order of recommended:

### Option A — JS polling (recommended, simplest)

```javascript
// Pseudocode — runs only when live_state ∈ {scheduled, live, ended_pending}
const POLL_INTERVAL = 60_000; // 60 seconds
let currentState = "<%= live_state %>";

setInterval(async () => {
  const resp = await fetch(`/wp-json/wp/v2/swm_episode/${postId}?_fields=meta`);
  if (!resp.ok) return;
  const { meta } = await resp.json();
  const newState = meta._swm_episode_live_state;
  if (newState && newState !== currentState) {
    // Reload to render the new state — simplest correct behavior
    window.location.reload();
  }
}, POLL_INTERVAL);
```

60 seconds is a reasonable balance — visitors don't wait long after state changes, and at the expected visitor volume this is well within WP's REST capacity. Stop polling once `_swm_episode_live_state === "archived"`.

### Option B — Server-sent events / WebSocket

More sophisticated, real-time, but requires infrastructure SWM doesn't currently have. Stick with Option A unless there's a separate reason to introduce push.

---

## Poster image / featured image lifecycle

| State | Featured image source |
|---|---|
| `scheduled` | Show's default placeholder (theme can fall back to the show's branding image if no featured_media is set yet) |
| `live`, `ended_pending` | Theme may dynamically use YouTube thumbnail: `https://img.youtube.com/vi/<_swm_episode_youtube_video_id>/maxresdefault.jpg` |
| `archived` | Portal sets `featured_media` on the post when archiving — theme renders normally |

The portal does not pre-upload a custom poster in v1. v2 may add a poster upload field to the create form.

---

## How the portal writes meta — example payload

When the portal transitions a recording to `live`, it sends:

```json
POST /wp-json/wp/v2/swm_episode/<post_id>
Authorization: Basic <base64(user:app_password)>
Content-Type: application/json

{
  "meta": {
    "_swm_episode_live_state": "live",
    "_swm_episode_live_started_at": "2026-05-20T19:02:11-05:00"
  }
}
```

When transitioning to `archived` (after the Transistor pipeline finishes), portal sends the full payload — meta keys above plus the standard episode content fields (`post_content`, `excerpt`, etc.) and updates `featured_media`.

---

## What the WP team does NOT need to handle

- **State derivation** — portal owns this. The theme never queries YouTube directly or guesses state from missing meta.
- **Cron / polling logic** — portal has its own cron (`/api/cron/live-recording-poll`); the WP side just reflects what the portal writes.
- **Audio file storage** — comes via the existing Transistor pipeline after archive; theme uses whatever it currently uses for studio episodes.
- **Pipeline triggering** — entirely portal-side.

---

## Coordinated rollout

1. **WP side ships first** — register the new meta keys, add template branches, add the JS poll. Until the portal-side write code lands, the meta will simply be absent (defaults to "studio") and pages render as today. No risk.
2. **Portal side ships second** — once meta is registerable via REST, portal can start creating live recordings. The first one is a test broadcast; if anything renders wrong, both sides iterate.

Coordinate the cutover so portal creates aren't attempting REST writes on meta keys WP hasn't registered yet — that's the only sequencing risk.

---

## Questions / clarifications welcome

If anything in this doc is unclear, ambiguous, or doesn't fit the existing theme architecture, raise it before implementing. Better to have a 10-min sync than to build divergent assumptions on both sides.
