# Blog Edit Detection Design

## Problem

When a blog post is sent to a host for review (status: "reviewing"), there's no visibility into whether the host has made edits in Google Docs. The admin has to manually publish to WordPress to discover changes. This makes it hard to prioritize which posts are ready for publishing.

## Solution

On page load of the blog ideas page, check Google Docs for edits on posts in "reviewing" status. Cache results so repeat visits are fast. Show a color-coded badge with a change percentage on each post.

## Data Model

Add four columns to `BlogPost`:

| Column | Type | Purpose |
|---|---|---|
| `editCheckPercentage` | `Int?` | 0-100, percentage of content changed |
| `editCheckLabel` | `String?` | Human-readable label |
| `editCheckAt` | `DateTime?` | When we last checked |
| `sentToHostAt` | `DateTime?` | When the doc was sent for review |

`sentToHostAt` is set by the `sendToHost()` action. This replaces relying on `updatedAt` for the 14-day eligibility window.

### Label Mapping

| Percentage | Label |
|---|---|
| 0% | No changes |
| 1-10% | Minor edits |
| 11-30% | Moderate edits |
| 31%+ | Heavily rewritten |

## Server-Side Logic

New function `checkBlogEdits()` in `src/app/admin/blog-ideas/blog-actions.ts`:

1. **Query eligible posts:** `BlogPost` where `status = "reviewing"` AND `sentToHostAt` within last 14 days AND (`editCheckAt` is null OR older than 1 hour).
2. **For each eligible post:** Call Google Drive API to get `modifiedTime`.
   - If `modifiedTime` < `sentToHostAt`: host hasn't touched it. Set percentage=0, label="No changes".
   - If `modifiedTime` >= `sentToHostAt`: host may have edited.
3. **If modified:** Call `readGoogleDocAsHtml(docId)` to get current content. Strip HTML tags from both current and `originalContent`, then compute change percentage via character-level diff (Levenshtein distance / original length, capped at 100%).
4. **Update BlogPost** with `editCheckPercentage`, `editCheckLabel`, `editCheckAt = now()`.
5. **Return** updated posts.

Called from the blog ideas page data-fetching layer. Posts already checked within the last hour return cached values with no API calls.

### Diff Approach

Lightweight string similarity on tag-stripped text. No external diff library. Formatting-only changes (bold, italic) don't inflate the percentage since we compare text content only. The ratio of changed characters to total original characters gives the percentage.

### Google Drive `modifiedTime`

Use the existing Google auth from `src/lib/google/auth.ts`. Single Drive API call per post: `GET https://www.googleapis.com/drive/v3/files/{docId}?fields=modifiedTime`. This is a metadata-only call — fast and low quota cost. Only posts where `modifiedTime` indicates changes trigger the heavier `readGoogleDocAsHtml()` content fetch.

## UI Changes

On each "reviewing" post card, next to the existing status badge:

- **Gray badge:** "No changes" — host hasn't touched it
- **Blue badge:** "Minor edits (~N%)" — small tweaks
- **Amber badge:** "Moderate edits (~N%)" — meaningful changes
- **Green badge:** "Heavily rewritten (~N%)" — deep engagement from host

Badge text includes the label and percentage, e.g. "Minor edits (~8%)".

Posts without a completed check (just sent, page not yet reloaded) show no edit badge — just the normal "reviewing" status.

No new buttons or manual actions. The check happens automatically on page load for eligible posts.

## Scope Boundaries

- No webhooks or push notifications — polling on page load only.
- No real-time updates — stale for up to 1 hour between checks.
- No diff viewer — just the percentage and label. Full diff happens at publish time via the existing `BlogEditRecord` mechanism.
- 14-day window keeps API calls bounded (typically 0-5 posts in review at any time).
