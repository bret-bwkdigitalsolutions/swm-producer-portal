# Distribution Pipeline Design

Real platform uploads (YouTube, Transistor, WordPress) with optional AI-assisted episode descriptions via transcription.

## Flow Summary

Two-path distribution flow based on producer choice:

**Path A — Manual:** Producer writes their own description, selects platforms, distributes immediately.

**Path B — AI-Assisted:** Producer uploads video, system extracts audio, transcribes via Deepgram, generates summary/chapters/blog ideas via Claude. Producer reviews and edits recommendations, then distributes.

Both paths converge at distribution, which executes platform uploads in dependency order.

## Distribution Form Redesign

The form collects upfront: show, episode title, video file.

After video is selected, the producer chooses:
- **"I'll write my own description"** — textarea for description appears, plus platform selection and publish mode. Standard submit flow.
- **"Get AI recommendations"** — video uploads to GCS, then a pipeline runs: extract audio → transcribe → generate recommendations. Producer sees progress indicators for each step.

### AI Recommendation Review UI

When AI analysis completes, the producer sees:
- **Summary suggestion** — accept, edit, or discard. Becomes the episode description.
- **Chapter suggestions** — timestamped chapters. Accept, reorder, edit, or discard. Appended to the description if accepted.
- **Blog post ideas** — shown as cards. Stored in `AiSuggestion` table for later admin-triggered full generation (separate feature).

After the producer finalizes their description (from either path), the same platform selection + publish mode controls appear, followed by "Distribute Now" / "Save as Draft" / "Schedule".

### Progress Indicators (AI Path)

- "Uploading video..." (progress bar, existing)
- "Extracting audio..."
- "Transcribing... this may take a few minutes"
- "Generating recommendations..."

## Processing Pipeline

### Trigger

Processing starts immediately when the producer clicks "Distribute Now". No cron, no job queue polling — the confirm/submit endpoint triggers the processor directly.

Exception: scheduled posts use status "scheduled" with a target datetime. A lightweight Railway cron checks every few minutes for jobs whose scheduled time has arrived and triggers their processing.

### Platform Execution Order

1. **YouTube** (first — WordPress needs the video URL)
2. **Transistor** (parallel with YouTube — uses extracted audio, independent)
3. **WordPress** (last — needs YouTube URL for embed)

### Step 1: YouTube Upload

- Use YouTube Data API v3 `videos.insert` with resumable upload
- Download video from GCS, stream to YouTube
- Set: title, description (with chapters if available), tags, privacy status, category
- Retrieve OAuth credentials from `PlatformCredential` table (show-specific → network default fallback)
- Auto-refresh expired tokens using existing refresh logic in `src/lib/youtube-oauth.ts`
- On completion: capture video ID + URL, update `DistributionJobPlatform` with `externalId` and `externalUrl`

### Step 2: Transistor Upload

- Extract audio from video using ffmpeg (`video.mp4` → `episode.mp3`)
- Create episode via Transistor API `POST /v1/episodes` with show ID, title, description, season/episode number
- Upload audio file to the created episode
- Retrieve API key from `PlatformCredential` table
- Transistor show ID resolved from `ShowPlatformLink` (platform: `transistor_show`)

### Step 3: WordPress Post

- Create `swm_episode` post via existing WP REST client (`createPost`)
- `content` = description text (with chapters if AI-assisted, plain description if manual)
- Meta fields:
  - `_swm_youtube_url` = YouTube URL from Step 1
  - `_swm_show_id` = WordPress show ID
  - `_swm_episode_number` = episode number from form
  - Other optional fields: season number, duration, content warning
- Post status matches producer's publish mode selection (publish/draft/future)

### Step 4: AI Blog Ideas

- If not already generated during the AI-assisted path, analyze transcript for blog post opportunities
- Store suggestions in `AiSuggestion` table with `type: "blog"`
- Blog ideas identify tangential topics mentioned but not deeply explored in the episode
- Full blog post generation is a separate admin-triggered feature (not part of this spec)

## Audio Extraction

Replace the placeholder in `src/lib/jobs/audio-extractor.ts` with real ffmpeg implementation.

- Download video from GCS to temp file
- Run ffmpeg: `ffmpeg -i input.mp4 -q:a 0 -map a output.mp3`
- Upload extracted mp3 back to GCS (for Transistor upload and transcription)
- Clean up temp files
- Add `ffmpeg` to the Dockerfile: `RUN apk add --no-cache ffmpeg` in the runner stage

## Transcription (Deepgram)

- Send extracted mp3 to Deepgram REST API
- Auto-detect language (supports English + Spanish with profanity/slang)
- Request word-level timestamps and speaker diarization
- Returns timestamped transcript JSON
- Env var: `DEEPGRAM_API_KEY` (free tier: $200 credits)
- No file size limit — no chunking needed
- Expected speed: ~1-2 minutes for a 60-minute episode

## AI Recommendations (Claude)

Using existing Anthropic SDK integration (`src/lib/jobs/ai-processor.ts`):

**Summary prompt** — rewrite to use transcript. Generate a 2-4 sentence episode summary optimized for podcast platform discoverability.

**Chapters prompt** — new, uses timestamped transcript. Identify natural topic breaks, generate chapter titles with timestamps formatted as `HH:MM:SS - Title`.

**Blog ideas prompt** — rewrite per project requirements. Find topics mentioned in the episode but not deeply explored. Suggest 2-3 companion blog posts that go deep on those tangential topics for SEO/AI discoverability. Not episode recaps.

## Error Handling

### Per-Platform Failures

- Each platform is independent (except WordPress depends on YouTube URL)
- If YouTube fails: WordPress is skipped (no embed URL), Transistor proceeds independently
- If Transistor fails: YouTube and WordPress are unaffected
- If WordPress fails: YouTube and Transistor results are preserved
- Individual platform status updated in `DistributionJobPlatform` with error messages
- Producer sees failures on the job detail page

### Admin Error Notifications

On any platform failure, send email to `bret@stolenwatermedia.com` via Resend:
- Subject: "Distribution failed — [Episode Title]"
- Body: job title, show name, producer name, which platform(s) failed, error messages, link to job detail page
- Uses existing Resend integration (`notifications@stolenwatermedia.com`)
- Producer sees the error in the UI; admin gets notified silently

## Infrastructure Changes

### Dockerfile

Add ffmpeg to the production image:
```dockerfile
# In runner stage, before USER nextjs
RUN apk add --no-cache ffmpeg
```

### Environment Variables (New)

- `DEEPGRAM_API_KEY` — Deepgram transcription API key
- `OPENAI_API_KEY` — not needed (using Deepgram instead)

### Environment Variables (Existing, Must Be Set)

- `ANTHROPIC_API_KEY` — Claude API for AI recommendations
- `GCS_CREDENTIALS_JSON` — Google Cloud Storage credentials
- `GCS_BUCKET_NAME` — Storage bucket name

## Data Model Changes

No schema changes needed. Existing models support this:
- `DistributionJob.metadata` (JSON) — stores transcript, description, chapters
- `DistributionJobPlatform` — per-platform status tracking
- `AiSuggestion` — stores summary, chapters, blog ideas
- `PlatformCredential` — YouTube OAuth tokens, Transistor API keys
- `ShowPlatformLink` — YouTube channel/playlist, Transistor show IDs

## New Files

| File | Purpose |
|------|---------|
| `src/lib/transcription.ts` | Deepgram API client — send audio, get timestamped transcript |
| `src/lib/platforms/youtube.ts` | YouTube Data API v3 video upload |
| `src/lib/platforms/transistor.ts` | Transistor episode creation + audio upload |
| `src/lib/platforms/wordpress.ts` | WordPress episode post creation (wraps existing client) |
| `src/lib/notifications.ts` | Extend with admin error notification function |

## Modified Files

| File | Changes |
|------|---------|
| `src/lib/jobs/processor.ts` | Replace `simulatePlatformUpload` with real platform calls, add execution ordering |
| `src/lib/jobs/audio-extractor.ts` | Replace placeholder with real ffmpeg implementation |
| `src/lib/jobs/ai-processor.ts` | Rewrite prompts, add transcript-based analysis, make blog ideas configurable |
| `src/app/dashboard/distribute/new/distribution-form.tsx` | Two-path flow, AI recommendation review UI |
| `src/app/dashboard/distribute/new/actions.ts` | Support AI-assisted path, immediate processing trigger |
| `src/app/api/upload/confirm/route.ts` | Trigger processing directly instead of just setting status |
| `Dockerfile` | Add ffmpeg |

## Out of Scope

- Full blog post generation (admin-triggered, separate feature)
- Spotify/Apple Podcasts uploads (future platforms)
- Video transcoding/compression
- Thumbnail generation from video frames
- Real-time processing status via WebSocket (use polling on job detail page)
