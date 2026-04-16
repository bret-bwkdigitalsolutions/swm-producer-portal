# Custom Blog Prompt — Design

Date: 2026-04-16

## Problem

`/admin/blog-ideas` only surfaces blog ideas auto-generated from episode transcripts during the distribution pipeline. Admins have no way to start a blog post from a custom prompt — e.g., "write a piece on the Dallas music scene for SXSW readers, tying back to our recent interview." They want to:

1. Pick a show (required).
2. Optionally pick an episode from that show, so the AI can reference the transcript for accuracy and framing.
3. Write their own brief describing what the blog should be.
4. Generate a draft that flows through the existing review/publish pipeline (Google Doc → send to host → publish to WordPress).

## Goals & non-goals

**Goals**

- New "Create custom blog post" control on `/admin/blog-ideas`, show required, episode optional, brief required.
- When an episode is picked, its transcript is injected into the AI prompt for grounding.
- Custom blogs share the existing Google Doc / review / publish / translation / edit-capture flow.
- Style guide and host edit examples for the show apply to custom prompts the same way they do to auto-generated ones.

**Non-goals**

- Network-wide (no-show) blogs. Deferred — every downstream assumption (`parent_show_id`, Drive folder, style guide, reviewer emails) is keyed on `wpShowId`. Revisit as a separate design once we know how WP should represent a network-level blog.
- Episodes without transcripts in the picker. The picker is scoped to `DistributionJob`s with `metadata.transcript` non-empty, because the feature's value is transcript grounding.
- Post-generation prompt editing / "regenerate from this brief" buttons.

## Schema

Single Prisma migration on `BlogPost`:

```prisma
model BlogPost {
  id           String   @id @default(cuid())
  suggestionId String?  @unique    // was required — now nullable
  jobId        String?             // was required — now nullable
  wpShowId     Int                 // still required
  source       String   @default("suggestion") // "suggestion" | "custom"
  customPrompt String?  @db.Text   // editor's brief, only for source="custom"
  // (all other fields unchanged)

  suggestion AiSuggestion?    @relation(fields: [suggestionId], references: [id], onDelete: Cascade)
  job        DistributionJob? @relation(fields: [jobId], references: [id], onDelete: Cascade)
  editRecord BlogEditRecord?
}
```

- Existing rows backfill as `source="suggestion"` with both FKs intact — no data movement needed beyond the column adds.
- `onDelete: Cascade` preserved — a deleted job still takes its custom blog with it; custom blogs with no job are unaffected.
- `AiSuggestion`, `ShowBlogFolder`, `BlogEditRecord`, `ShowMetadata` untouched.

## Data flow

```
Admin fills form ──▶ generateCustomBlogPost(wpShowId, jobId?, customPrompt)
                         │
                         ├─ validate (show exists, brief non-empty, job belongs to show)
                         ├─ load ShowMetadata + BlogEditRecords + ShowBlogFolder
                         ├─ if jobId: load DistributionJob, pull metadata.transcript + description
                         ├─ build prompt (see Prompt section)
                         ├─ call Anthropic, parseBlogOutput
                         ├─ createGoogleDoc in show's Drive folder
                         └─ insert BlogPost { source: "custom", customPrompt, jobId?, suggestionId: null, ... }

                            ▼
                  BlogPostControls (existing)
                  └─ sendToHost / publishToWordPress / translation / edit capture
                     (nullability tweaks — see below)
```

## Server actions

### New: `generateCustomBlogPost`

Location: `src/app/admin/blog-ideas/actions.ts`.

```ts
generateCustomBlogPost(input: {
  wpShowId: number;
  jobId?: string;
  customPrompt: string;
}): Promise<GenerateResult>
```

Steps:

1. `requireAdmin()`.
2. Validate: `Number.isInteger(wpShowId) && wpShowId > 0`; `customPrompt.trim()` non-empty. If `jobId` given, fetch the job and confirm `job.wpShowId === wpShowId`.
3. Load `ShowMetadata`, `BlogEditRecord`s (via `loadStyleContext` helper), `ShowBlogFolder`. Return the existing friendly error if no `ShowBlogFolder` exists for the show.
4. If `jobId` present: read `metadata.transcript` and `metadata.description` from the job.
5. Build prompt (see Prompt section).
6. Call Anthropic, run `parseBlogOutput`.
7. Call `createBlogDraftArtifacts` to create the Google Doc and `BlogPost` row.
8. Return `{ success, blogPostId, googleDocUrl }`.

### New: `listEpisodeOptions`

Location: `src/app/admin/blog-ideas/actions.ts`.

```ts
listEpisodeOptions(wpShowId: number): Promise<Array<{
  id: string;         // DistributionJob.id
  title: string;
  createdAt: Date;
}>>
```

Returns `DistributionJob`s for the show where `metadata->>'transcript'` is non-empty, ordered `createdAt desc`, limit 50. Admin-guarded.

### Refactor of existing code in `actions.ts`

Extract three helpers so `generateBlogPost` and `generateCustomBlogPost` each stay ~30–50 lines:

- `loadStyleContext(wpShowId): Promise<string>` — style guide + edit examples block (today lines ~66–117).
- `parseBlogOutput(rawText: string): { title, excerpt, seoDescription, seoKeyphrase, content }` — today lines ~186–213.
- `createBlogDraftArtifacts(input): Promise<{ blogPostId, googleDocUrl }>` — folder lookup, Google Doc creation, `BlogPost` insert, and (for `source="suggestion"`) the `AiSuggestion.accepted = true` update (today lines ~219–275).

Shape of `createBlogDraftArtifacts`:

```ts
createBlogDraftArtifacts(input: {
  wpShowId: number;
  title: string;
  content: string;
  excerpt: string | null;
  seoDescription: string | null;
  seoKeyphrase: string | null;
  source: "suggestion" | "custom";
  suggestionId?: string;   // required when source="suggestion"
  jobId?: string;          // optional
  customPrompt?: string;   // required when source="custom"
})
```

### `blog-actions.ts` — nullability edits

`publishToWordPress` and `sendToHost` today both read `blogPost.job.title`, `blogPost.job.wpShowId`, `blogPost.job.metadata`, and `blogPost.job.platforms[0]`. With a null `job`:

- `parent_show_id: blogPost.job.wpShowId` → `parent_show_id: blogPost.wpShowId` (already stored on the row).
- `_swm_linked_episode` — only set when `blogPost.job?.platforms[0]?.externalId` is truthy.
- Featured image from `metadata.thumbnailGcsPath` — only attempt when `blogPost.job` exists; otherwise go straight to the existing "show featured image from WP" fallback.
- Email HTML — omit the "Episode" row when there's no `blogPost.job`.

Prisma `include: { job: { select: { title: true, wpShowId: true, metadata: true, platforms: {…} } } }` becomes optional; code branches on `if (blogPost.job) { … }` where needed. Translation and edit-capture are keyed on blog id / wpShowId / content and need no changes.

## Prompt construction

Identical scaffold to today's `generateBlogPost` prompt, with two changes:

1. `## Blog Topic Idea` → replaced by `## Blog Brief from Editor` containing `customPrompt` verbatim.
2. Episode context is conditional:
   - **Episode picked:** include `## Source Episode` (title + description) and `## Episode Transcript` (first 8000 chars, labelled "for reference and accuracy — the blog should fit alongside this episode"). Keep the "Reference the episode at the end with a call-to-action to listen" requirement.
   - **No episode:** omit both sections; drop the episode CTA requirement.

Style context (`loadStyleContext`) and language handling (`showLanguage === "es"`) identical to today. Output format (first-line title, EXCERPT/SEO/KEYPHRASE prefixes, then HTML body) identical so `parseBlogOutput` works unchanged.

## UI

### New component: `CustomBlogForm`

Location: `src/app/admin/blog-ideas/custom-blog-form.tsx`. Client component.

Collapsible card at the top of `/admin/blog-ideas`, above the existing list. Closed by default. Open state:

- **Show select** — populated from `getCachedShows()` passed from the page. Required.
- **Episode select** — disabled until a show is picked. Populated by calling `listEpisodeOptions(wpShowId)` on show change. First option `"— No episode —"` with value empty. Label format: `${job.title} — ${createdAt.toLocaleDateString()}`.
- **Brief textarea** — required, rows=6, no hard limit.
- **Style guide indicator** — shown when the picked show has a `styleGuide` on `ShowMetadata`. Reuses the same "Using {host}'s style guide" string the existing `GenerateBlogButton` uses. Passed in as a lookup map keyed by `wpShowId`.
- **Generate button** — disabled until show + non-empty brief; spinner while pending.
- **Cancel button** — collapses and clears.
- **Success** — clear the form, collapse the card, `router.refresh()`. The new post appears in the list below with the existing `BlogPostControls`.
- **Error** — inline destructive text under the button.

### Page changes

`src/app/admin/blog-ideas/page.tsx`:

- Query both `AiSuggestion` (existing) and `BlogPost where source="custom"` in parallel.
- Normalize into a `DisplayCard` shape:
  ```ts
  type DisplayCard = {
    id: string;
    title: string;        // episode title or blog title
    showName: string;
    body: string;         // suggestion.content OR customPrompt
    bodyLabel: "Idea" | "Custom brief";
    blogPost?: BlogPost;
    accepted: boolean;    // suggestion.accepted OR blogPost exists
    suggestionId?: string; // needed for GenerateBlogButton on unrealized suggestions
    wpShowId: number;
    createdAt: Date;
  };
  ```
- Merge and sort by `createdAt desc`. Render one list.
- For `source="custom"` cards, wrap `body` in a `<details>` with summary "Custom brief" (keeps the list tidy when many custom blogs accumulate). Existing suggestion cards keep their `<p>` rendering.
- Render `CustomBlogForm` above the list, passing `shows`, `styleGuideMap`.

## Testing

- Unit tests for extracted `parseBlogOutput` — valid full output; output missing EXCERPT; output with HTML starting immediately.
- Unit tests for `generateCustomBlogPost` validation — missing show, blank brief, job/show mismatch. (Happy path needs mocking Anthropic + Google Docs; skip unless trivial.)
- Manual smoke test on staging:
  1. Create with episode — transcript reaches prompt; publish flow succeeds.
  2. Create without episode — no transcript, no episode CTA; publish flow succeeds; no `_swm_linked_episode` meta on WP.
  3. Bilingual show — translation meta is present after publish.

No local testing (per project convention — deploy to staging).

## Files touched

1. `prisma/schema.prisma` + new migration.
2. `src/app/admin/blog-ideas/actions.ts` — extract 3 helpers; add `generateCustomBlogPost`; add `listEpisodeOptions`.
3. `src/app/admin/blog-ideas/blog-actions.ts` — nullability branches in `publishToWordPress` and `sendToHost`.
4. `src/app/admin/blog-ideas/custom-blog-form.tsx` — new.
5. `src/app/admin/blog-ideas/page.tsx` — add form, extend query, normalize display cards.
6. Tests for `parseBlogOutput` and `generateCustomBlogPost` validation.

## Risks & mitigations

- **Prompt too long with transcript** — 8000-char transcript cap already in use elsewhere; keep the same cap.
- **Orphan custom blogs after show deletion** — shows aren't currently deletable from the portal and `wpShowId` is just a WP reference, not a FK. No cascade risk beyond what exists today for suggestion-backed blogs.
- **Empty list of episodes for new/unprocessed shows** — picker simply shows `"— No episode —"` only. UI makes this clear.
- **Style guide not yet mature** — `loadStyleContext` already handles the "no records" case cleanly; nothing special needed.
