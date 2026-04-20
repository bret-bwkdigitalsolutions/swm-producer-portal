# Blog Ideas Collapsible Groups Design

## Problem

The blog ideas page is a long scroll of individual cards. As episodes accumulate, it becomes hard to scan and find what needs attention. Older unused ideas clutter the view.

## Solution

Group blog idea cards by episode, with each group collapsible. Show a summary row with counts and statuses when collapsed. Auto-hide suggestions older than 30 days that haven't been acted on.

## Grouping

Cards grouped by episode (using `jobId`). Custom blogs without an episode go into a "Custom Blogs" group at the top. Each group is a collapsible section.

### Collapsed Row (one per episode)

Shows:
- Episode title + show name
- Summary string with counts and statuses, e.g.:
  - "3 ideas" (none generated yet)
  - "3 ideas · 1 draft"
  - "3 ideas · 1 with host (Minor edits ~6%) · 1 published"
- Click anywhere on the row to expand/collapse

### Expanded View

Same card layout as today — all blog ideas and `BlogPostControls` for that episode.

### Default State

All groups collapsed.

## 30-Day Cleanup

- Blog suggestions (`AiSuggestion` with type "blog") older than 30 days that have NOT been generated into a `BlogPost` (i.e., `accepted = false`) are hidden by default.
- Any suggestion that has a `BlogPost` (regardless of status) always shows.
- Custom blogs always show regardless of age.
- A "Show older ideas" link at the bottom reveals hidden suggestions.

## Ordering

Groups sorted by most recent episode first (by `job.createdAt` descending), same as today.

## Implementation Details

### Page Component Changes (`src/app/admin/blog-ideas/page.tsx`)

- After building the `cards` array, group by `jobId` (or `"custom"` for custom blogs).
- For each group, compute summary: count of ideas, count by status (draft, reviewing, published), edit check labels.
- Filter out suggestions older than 30 days without a blog post.
- Render groups as collapsible `<details>` elements (native HTML, no JS needed).
- Track whether "Show older ideas" is toggled via query param or client state.

### Summary String Logic

For each group, build the summary from its cards:
- Count total ideas (suggestions without a blog post)
- Count drafts (blogPost with status "draft")
- Count reviewing (blogPost with status "reviewing") — append edit label if present
- Count published (blogPost with status "published")
- Join non-zero counts with " · "

### No New Files

This is a refactor of the existing page component and possibly a small client component for the "Show older ideas" toggle. No new data models or server actions.

## Scope Boundaries

- No pagination or infinite scroll — just collapsible groups.
- No drag-and-drop reordering.
- No per-group actions (bulk publish, etc.).
- The 30-day cutoff is hardcoded, not configurable.
