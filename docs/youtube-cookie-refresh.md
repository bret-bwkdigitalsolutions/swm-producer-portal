# Refreshing YouTube download cookies

## When you need this

A producer sees this error on **New Episode Distribution** (or a live recording gets stuck in `ended_pending` with a download failure):

> YouTube download failed — authentication cookies have expired. Please contact an admin to refresh them.

That message comes from `src/app/api/distribute/analyze/route.ts` when `yt-dlp` reports a "Sign in to confirm" / cookie error. It is **not a code bug** — YouTube has invalidated the stored login cookies and they need replacing.

## How it works

The portal extracts audio from YouTube videos with `yt-dlp` (see `src/lib/jobs/youtube-video-downloader.ts`). For age-gated, members-only, or bot-flagged videos, YouTube requires a logged-in session. The portal supplies that via the **`YOUTUBE_COOKIES`** environment variable (Netscape cookie format), which the downloader writes to a temp `cookies.txt` and passes to `yt-dlp --cookies`.

YouTube rotates and expires these cookies aggressively, so they need refreshing every so often. There is no automatic renewal.

## Fix — Part 1: export fresh cookies

Cookies can only be exported from a browser that is logged into YouTube. They grant full access to that Google account, so:

> **Use a dedicated / burner Google account, not a personal one.** YouTube may flag accounts used for automated downloads, and the cookies are a live credential.

1. Install a browser extension such as **"Get cookies.txt LOCALLY"** (Chrome or Firefox).
2. Open a **new Incognito / Private window** and log into YouTube with the burner account.
3. Open one normal video so the session is fully established.
4. With that tab focused, use the extension to **export cookies for `youtube.com` in Netscape format**. You get a `cookies.txt` file.
5. **Close the Incognito window WITHOUT logging out.**
   - This is the most common mistake. Logging out server-invalidates the session, so the exported cookies stop working within minutes. Just close the window — the cookies stay valid.

## Fix — Part 2: update the Railway env var

The entire contents of `cookies.txt` become the value of `YOUTUBE_COOKIES`. Update it on **both** environments — `staging` and `production`.

### Option A — Railway dashboard

For each of `staging` and `production`:

1. Open the `swm-producer-portal` project → select the environment.
2. Open the `swm-producer-portal` service → **Variables**.
3. Edit `YOUTUBE_COOKIES`, paste the full file contents, save.
4. Railway redeploys the service automatically.

### Option B — Railway CLI

Requires an authenticated CLI (`railway login`) or a project-scoped API token from
https://railway.com/account/tokens.

```bash
# Save the exported cookies to a local file first, then:
RAILWAY_API_TOKEN=<token> railway variables \
  --set "YOUTUBE_COOKIES=$(cat cookies.txt)" \
  --service swm-producer-portal --environment staging

RAILWAY_API_TOKEN=<token> railway variables \
  --set "YOUTUBE_COOKIES=$(cat cookies.txt)" \
  --service swm-producer-portal --environment production
```

Delete the local `cookies.txt` afterward — it is a live credential.

## Verify

After both services redeploy, retry a distribution from a YouTube source (the one that failed is fine). The download should now succeed and proceed to audio extraction / Transistor upload. If it still fails with the same cookie error, the most likely cause is that the Incognito window was logged out before/after export (see Part 1, step 5) — re-export and try again.

## When fresh cookies aren't enough: bump yt-dlp

If downloads still fail *after* a clean cookie refresh — especially with errors like:

> `ERROR: [youtube] <id>: Requested format is not available`
> `ERROR: [youtube] <id>: Sign in to confirm you're not a bot`

— and yt-dlp's logs show it cycling through player clients (`tv`, `android vr`, etc.), the problem is usually an **outdated yt-dlp**, not the cookies. YouTube changes its player API faster than yt-dlp cuts *stable* releases, so the fix is to bump to a newer **nightly** build.

1. Find the latest nightly tag:
   ```bash
   curl -s https://api.github.com/repos/yt-dlp/yt-dlp-nightly-builds/releases/latest | grep tag_name
   ```
2. Update `YT_DLP_VERSION` in the `Dockerfile` to that tag (the download URL already points at the `yt-dlp-nightly-builds` repo).
3. Commit and push. Railway rebuilds the image and the new binary is pulled at build time.

The version is pinned (not "latest") on purpose, for reproducible builds — so expect to bump it manually every so often as YouTube breaks older versions.

## Notes

- Cookies typically last weeks, not months. Expect to repeat this periodically.
- If downloads start failing right after a refresh, suspect the logout mistake first.
- If cookies are fresh but downloads still fail with format/bot errors, suspect a stale yt-dlp (see above).
- `YOUTUBE_COOKIES` is optional — if unset, the downloader runs `yt-dlp` without `--cookies`, which works for fully public videos but fails on anything YouTube gates behind a login.
