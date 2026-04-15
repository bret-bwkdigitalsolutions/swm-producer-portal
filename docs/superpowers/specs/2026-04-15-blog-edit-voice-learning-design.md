# Blog Edit Voice Learning — Design Spec

## Problem

AI-generated blog posts require host editing before publication. These edits represent the host's voice, preferences, and style — but currently they're lost after publishing. Over time, the system should learn from these edits to generate blog posts that increasingly match each host's voice, reducing editing effort.

## Solution

Capture the diff between AI-generated and host-edited blog content at publish time. Accumulate these diffs per show and synthesize them into a style guide that gets injected into future blog generation prompts.

## Design Decisions

- **Always capture diffs** — no admin opt-in/opt-out per post. Every publish with edits creates a record.
- **Raw storage, structured analysis at synthesis time** — store lossless before/after HTML in the database. Do the pattern extraction when the admin triggers style guide synthesis, not at capture time. This keeps publish fast and lets analysis improve over time.
- **Adaptive prompt injection** — use raw before/after examples when edit history is thin (< 5 posts), shift to synthesized style guide + 1-2 recent examples once enough data exists.
- **Full re-synthesis** — each style guide update replaces the previous one, re-analyzing all available diffs. Not incremental.

## Data Model

### New: `BlogEditRecord`

| Field | Type | Description |
|-------|------|-------------|
| id | String @id @default(cuid()) | Primary key |
| blogPostId | String | FK to BlogPost |
| wpShowId | Int | Denormalized for easy show-level queries |
| originalContent | String | AI-generated HTML at time of blog creation |
| editedContent | String | Host-edited HTML read from Google Doc at publish time |
| createdAt | DateTime @default(now()) | When the diff was captured |

Relation: `BlogPost` has optional one `BlogEditRecord` (one edit record per publish).

### Modified: `BlogPost`

| Field | Type | Description |
|-------|------|-------------|
| originalContent | String? | AI-generated HTML body, saved at generation time |

This field stores the raw AI output so it's available at publish time for comparison, even if the Google Doc has been edited.

### Modified: `ShowMetadata`

| Field | Type | Description |
|-------|------|-------------|
| styleGuide | String? | Synthesized style profile (300-500 words) |
| styleGuideUpdatedAt | DateTime? | Last synthesis timestamp |

## Capture Flow (at publish time)

1. `publishToWordPress()` already calls `readGoogleDocAsHtml()` to get host-edited content
2. Read `BlogPost.originalContent` (saved at generation time)
3. Compare the two via simple string inequality — if they differ at all, create a `BlogEditRecord` with both versions
4. Continue with existing publish flow (no latency impact beyond one DB write)

## Style Guide Synthesis (admin-triggered)

1. Admin clicks "Update Style Guide" on show admin page
2. Server action loads all `BlogEditRecord`s for that `wpShowId`
3. Sends all before/after pairs to Claude with a meta-prompt extracting:
   - **Tone preferences** — formal vs. conversational, humor, warmth
   - **Structural patterns** — paragraph length, content organization, heading style
   - **Vocabulary** — words/phrases consistently added or removed
   - **Content patterns** — types of additions (anecdotes, examples, calls to action)
   - **Things to avoid** — patterns the host consistently removes
4. Result: concise style guide (300-500 words) stored in `ShowMetadata.styleGuide`
5. Updates `ShowMetadata.styleGuideUpdatedAt`

## Prompt Injection for Blog Generation

Modified in `generateBlogPost()` (`src/app/admin/blog-ideas/actions.ts`):

### When < 5 edit records exist for the show:
- Include available before/after pairs directly in the prompt
- Each pair wrapped in clear structure: "Original AI version" → "Host-edited version"
- Cap at ~2000 tokens per pair (truncate middle, keep beginning and end)
- No style guide injection (too few data points)

### When 5+ edit records exist:
- Include the synthesized style guide
- Include 1-2 most recent before/after pairs as concrete examples
- Style guide is primary; examples reinforce

### When no edit records exist:
- Prompt stays as-is (current behavior, no change)

## Admin UI

### Show admin page (`/admin/shows`)

New "Voice & Style" section below language settings:

- **Empty state:** "No style guide yet — publish edited blog posts to start building one"
- **With edit records but no guide:** Shows count of available edit records + "Update Style Guide" button
- **With guide:** Displays style guide text (read-only), last updated date, edit record count, and "Update Style Guide" button to re-synthesize

### Blog ideas page (`/admin/blog-ideas`)

- When generating a blog post for a show that has a style guide, show indicator: "Using [host name]'s style guide"
- Informational only, no toggle

### Publish flow

- No UI changes. Diff capture is automatic and invisible.

## Token Budget

- **Per-pair injection (early posts):** ~2000 tokens per pair × up to 4 pairs = ~8000 tokens max
- **Style guide injection (mature):** ~500 tokens for guide + ~4000 tokens for 2 example pairs = ~4500 tokens
- **Synthesis call:** All pairs sent at once. At 10 posts × ~4000 tokens per pair = ~40,000 tokens input. Manageable and infrequent.

## Out of Scope

- Admin curation of which diffs to include/exclude (can add later if needed)
- Automatic synthesis triggers (e.g., after every N publishes)
- Blog idea generation prompt injection (only full blog post generation is affected)
- Cross-show style sharing
