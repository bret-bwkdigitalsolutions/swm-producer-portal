# Reaction Form Design

## Problem

The `swm_reaction` WordPress post type now has two new meta fields (`_swm_reaction_type` and `parent_show_id`) that need to be set during submission. The portal needs a reaction submission form.

## Solution

Create a new reaction content type form following existing portal patterns (review, trailer, etc.). Add two new dropdowns at the top of the form for content type and show selection.

## New Files

- `src/app/dashboard/reaction/page.tsx` — page shell with auth guard
- `src/app/dashboard/reaction/actions.ts` — server action `submitReaction()`
- `src/components/forms/reaction-form.tsx` — form component

## Modifications

- `src/lib/constants.ts` — add `REACTION: "reaction"` to `ContentType`
- `src/lib/wordpress/client.ts` — add `[ContentType.REACTION]: "swm_reaction"` to `POST_TYPE_MAP`

## Form Fields (top to bottom)

1. **Content Type** — `<select>` with two options:
   - "Reaction" (value: `"reaction"`, default)
   - "Nation Preview" (value: `"nation_preview"`)
   - Saves to `_swm_reaction_type` meta

2. **Show** — `<select>` populated from `getCachedShows()`:
   - Lists all `swm_show` posts
   - Defaults to Sunset Soccer Club (look up by name match, fall back to first show)
   - Saves to `parent_show_id` meta

3. **Title** — text input (required, used as the WP post title)

4. **YouTube Video ID** — text input (required)

5. **Thumbnail** — image upload via existing `ImageInput` component, uploaded as WP `featured_media`

6. **Teams Covered** — text input (free-form text, not multi-select)

7. **Game Window** — text input (free-form text, e.g., "Week 12" or "March 15, 2026")

8. **Status** — publish/draft/future (standard `StatusSelect` pattern)

## WordPress Meta Payload

```json
{
  "_swm_portal_user_id": "<session user id>",
  "_swm_portal_submission": true,
  "_swm_reaction_type": "reaction" | "nation_preview",
  "parent_show_id": 123,
  "youtube_video_id": "abc123",
  "teams_covered": "Dallas Cowboys vs Philadelphia Eagles",
  "game_window": "Week 12"
}
```

Thumbnail uploaded separately via `uploadMedia()` and set as `featured_media`.

## Auth

- Page guard: `requireContentTypeAccess("reaction")`
- Action guard: `verifyContentTypeAccess("reaction")` + `verifyShowAccess(showId)`
- Activity logged to `db.activityLog`

## Patterns to Follow

- Form component uses `FormShell` with `useActionState`
- Server action signature: `(prevState: FormState, formData: FormData) => Promise<FormState>`
- Show dropdown uses `getCachedShows().catch(() => [])` for data
- Follows review form structure most closely (has show dropdown + meta fields)
