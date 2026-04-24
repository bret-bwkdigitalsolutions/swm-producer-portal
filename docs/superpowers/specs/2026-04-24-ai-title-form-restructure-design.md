# AI Title Generation & Distribution Form Restructure

**Date:** 2026-04-24
**Goal:** Restructure the distribution form so AI suggests title, episode/season numbers alongside description/chapters/tags. Move metadata fields below the AI/manual choice so producers only provide video input up front, then review all AI-populated fields before distributing.

---

## Current Flow

1. Select show (auto-populates episode/season numbers)
2. Select video source (upload / YouTube URL)
3. Enter episode title *(required)*
4. Edit season/episode numbers
5. Check explicit if needed
6. Upload thumbnail
7. Choose: manual description vs AI recommendations
8. AI path → analyze → review description/chapters/tags → distribute
9. Manual path → write description → distribute

## New Flow

1. Select show
2. Select video source (upload / YouTube URL)
   - If YouTube URL: auto-show thumbnail preview via `<img>` tag
3. **Choose: "Write my own" vs "Get AI recommendations"** *(moved up)*
4. **AI path →** analyze video → ALL fields appear pre-filled for review:
   - Title (AI-suggested based on content + show's title history)
   - Season # / Episode # (auto-populated from WP: last + 1)
   - Explicit checkbox
   - Description (AI-suggested)
   - Chapters (AI-suggested)
   - Tags (AI-suggested)
5. **Manual path →** same fields appear immediately, empty except:
   - Season # / Episode # (auto-populated from WP like today)
6. Thumbnail upload (shows YouTube thumbnail preview if available)
7. Select platforms
8. Select publish mode
9. Distribute

---

## AI Title Generation

### New WordPress Client Function

`getRecentEpisodeTitles(wpShowId: number, count?: number)` in `src/lib/wordpress/client.ts`:
- Fetches last 10 published episodes for the show via WP REST API
- Query: `/swm_episode?per_page=10&orderby=date&order=desc&status=publish&_fields=id,title&meta_key=parent_show_id&meta_value={wpShowId}`
- Returns: `string[]` — array of decoded episode titles

### New AI Suggestion Type

Add `"title"` to `AiSuggestionType` union in `src/lib/jobs/ai-processor.ts`.

### Title Prompt (`buildTitlePrompt`)

Context provided to Claude:
- Show name
- Transcript of the current episode
- Last 10 episode titles for this show (for voice/format matching)
- Language (Spanish shows get Spanish titles)

Instructions:
- Generate a single episode title that matches the style, voice, and format of previous episodes
- Based on the actual content/topics discussed in the transcript
- Plain text only, no quotes or markdown

### Analyze Endpoint Changes

`/api/distribute/analyze/route.ts`:
- Add `getNextEpisodeNumber(wpShowId)` call to return episode/season numbers in the response
- Title suggestion is included via the existing suggestion array (type: `"title"`)
- Response shape gains: `episodeNumber: number | null`, `seasonNumber: number | null`

---

## YouTube Thumbnail Auto-Preview

### Trigger
When producer enters a valid YouTube URL (detected via `extractYoutubeVideoId`).

### Client Side
- Show an `<img>` tag with `https://img.youtube.com/vi/{videoId}/maxresdefault.jpg`
- Fall back to `hqdefault.jpg` via `onError` handler
- Label: "YouTube thumbnail" or similar
- Producer can still override by uploading their own image file

### Server Side (Upload)
- In `uploadThumbnailToGCS` (or the server action it calls): if no manual file was uploaded but the job has a YouTube video ID, fetch the thumbnail server-side from `img.youtube.com` and upload to GCS
- This avoids browser CORS issues entirely — `<img>` tags don't have CORS restrictions, and the actual fetch-and-upload happens server-side

---

## Form Restructure Details

### Fields Moved Below Path Choice
- Episode Title (`title`)
- Season Number (`season_number`)
- Episode Number (`episode_number`)
- Explicit checkbox (`explicit`)

These fields now appear in the review section (AI path) or immediately after choosing manual.

### AI Path Field Population
When `suggestions` arrive from the analyze endpoint:
- `setTitle()` ← title suggestion content
- `setEpisodeNumber()` ← from `response.episodeNumber` (deterministic: last + 1)
- `setSeasonNumber()` ← from `response.seasonNumber` (deterministic: same as last)
- `setDescription()` ← summary suggestion content (existing behavior)
- `setChapters()` ← chapters suggestion content (existing behavior)
- `setSuggestedTags()` ← keywords suggestion content (existing behavior)

### Manual Path Field Population
When producer chooses "Write my own":
- `getNextEpisodeNumber(wpShowId)` is called (can reuse the existing show-change effect)
- Episode/season auto-populated, title and description empty for manual entry

### Job Creation (AI Path)
`submitDistribution` currently requires `title`. For AI path, pass the show name as placeholder (e.g., "AI analysis in progress — {showName}"). `updateDistribution` overwrites with the final title before processing begins.

---

## File Map

| File | Action | What Changes |
|------|--------|-------------|
| `src/lib/wordpress/client.ts` | Add function | `getRecentEpisodeTitles()` |
| `src/lib/jobs/ai-processor.ts` | Add type + prompt | `"title"` suggestion type, `buildTitlePrompt()` |
| `src/app/api/distribute/analyze/route.ts` | Modify | Return episode/season numbers, generate title suggestion |
| `src/app/dashboard/distribute/new/distribution-form.tsx` | Major restructure | Move fields below path choice, populate from AI, YouTube thumbnail preview |
| `src/app/dashboard/distribute/new/actions.ts` | Minor | Relax title requirement for AI path placeholder, export `getNextEpisodeNumber` for analyze endpoint |
| `src/app/api/upload/thumbnail/route.ts` | Modify | Accept YouTube video ID as fallback when no file uploaded |

---

## What Stays the Same

- `updateDistribution` — already accepts title, season/episode, explicit from prior fix work
- `processor.ts` — reads from job record which is updated before processing
- Platform upload logic — unchanged
- Manual form submission fundamentals — same fields, just positioned lower
- Blog idea generation — unchanged
