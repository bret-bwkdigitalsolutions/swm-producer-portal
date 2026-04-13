# Episode Keywords & Tags Design

**Date:** 2026-04-13  
**Status:** Approved

## Overview

Upgrade the episode distribution form's plain tag text input into a smart tag-chip UI that pre-populates show-specific defaults from historical usage and surfaces AI-recommended keywords during the AI analysis path.

## Goals

- Allow producers to quickly apply recurring show-specific tags per episode
- Surface AI-recommended SEO keywords during the AI description path
- Allow full review and edit before submission
- No new database schema required

## Data & AI Pipeline

### Frequent Tags Computation

In `src/app/dashboard/distribute/new/page.tsx` (server component), after fetching `descriptionFooters`, query all past `DistributionJob` records for each show the producer can access. Extract `metadata.tags` from each job's JSON metadata, aggregate by frequency, and return the top 12 tags per show.

Passed to `DistributionForm` as:
```ts
frequentTags: Record<string, string[]> // keyed by wpShowId as string
```

No schema change needed. Uses existing `metadata.tags: string[]` stored in `DistributionJob`.

### AI Keyword Generation

Add `"keywords"` as a new `AiSuggestionType` in `src/lib/jobs/ai-processor.ts`.

- Prompt: ask Claude to generate 8–12 SEO-friendly tags from the transcript (short, 1–3 word phrases, no duplicates, no markdown)
- Stored as a single `AiSuggestion` record with `type: "keywords"`, content as a newline-separated list
- Generated alongside `"chapters"` and `"summary"` in the existing `generateAiSuggestions` call
- Returned in the `/api/distribute/analyze` response alongside other suggestions

### Tags in Metadata

No change. Tags remain `metadata.tags: string[]` on `DistributionJob`. The chip UI replaces the text input as the means of producing that array. Existing `actions.ts` parsing logic is unchanged.

## Tag Chip UI Component

**Location:** `src/components/forms/tag-input.tsx`

### Props

```ts
interface TagInputProps {
  selectedTags: string[];
  suggestedTags: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}
```

### Behavior

- **Selected tags** rendered as dismissible chips (click × to remove)
- **Suggested tags** rendered below as unselected outlined/muted chips — click to move into selected
- **Free-text input** inline: press Enter or comma to add a typed tag
- Hidden `<input type="hidden" name="tags" value={selectedTags.join(",")} />` for form submission

## Integration in DistributionForm

### New prop

```ts
frequentTags?: Record<string, string[]>
```

### State

```ts
const [tags, setTags] = useState<string[]>([]);
const [suggestedTags, setSuggestedTags] = useState<string[]>([]);
```

### Show selection

When `showId` changes, reset `tags` to `frequentTags[showId] ?? []` and clear `suggestedTags`. This applies on both manual and AI paths.

### Manual path

`TagInput` is shown with `selectedTags={tags}` and `suggestedTags={[]}`. Producer sees pre-selected show-history chips and can freely add/remove.

### AI path

When AI suggestions arrive (end of `startAiAnalysis`):
1. Parse the `"keywords"` suggestion (split on newlines) → `aiKeywords: string[]`
2. `setSuggestedTags(aiKeywords.filter(k => !tags.includes(k)))` — de-duplicate against already-selected frequent tags
3. Show-history frequent tags that are not already in `tags` are surfaced in `suggestedTags` too, so the producer sees the full picture in one place

### Form submission

`TagInput`'s hidden input provides the final comma-separated `tags` value. Existing server action parsing is unchanged.

### Reset on video change

When a new video is selected, reset `tags` to `frequentTags[showId] ?? []` and clear `suggestedTags`, alongside existing resets for `descriptionMode` and `suggestions`.

## Placement in Form

The `TagInput` replaces the current plain `Input` tags field. It appears in the same position — after description/chapters, before platform selection — and is gated on `descriptionMode` being set (same as current).

## Out of Scope

- Admin UI for manually editing show default tags (derived from history only)
- Tags on the manual path receiving AI suggestions
- Per-user saved tags
