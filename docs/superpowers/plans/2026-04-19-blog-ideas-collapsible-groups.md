# Blog Ideas Collapsible Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group blog idea cards by episode with collapsible sections, summary counts, and 30-day auto-hide for stale suggestions.

**Architecture:** Refactor the server component `page.tsx` to group cards by `jobId`, compute summary strings per group, and render using native `<details>` elements. Add a small client component for the "Show older ideas" toggle.

**Tech Stack:** Next.js server components, native HTML `<details>`/`<summary>`, Tailwind CSS

---

### File Map

| File | Action | Responsibility |
|---|---|---|
| `src/app/admin/blog-ideas/page.tsx` | Modify | Group cards, compute summaries, render collapsible groups |
| `src/app/admin/blog-ideas/episode-group.tsx` | Create | Client component wrapping `<details>` for a single episode group |

---

### Task 1: Create Episode Group Client Component

**Files:**
- Create: `src/app/admin/blog-ideas/episode-group.tsx`

- [ ] **Step 1: Create the EpisodeGroup component**

Create `src/app/admin/blog-ideas/episode-group.tsx`:

```tsx
"use client";

import { ChevronRightIcon } from "lucide-react";

interface EpisodeGroupProps {
  title: string;
  showName: string;
  summary: string;
  children: React.ReactNode;
}

export function EpisodeGroup({
  title,
  showName,
  summary,
  children,
}: EpisodeGroupProps) {
  return (
    <details className="group rounded-lg border">
      <summary className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-muted/50">
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm truncate">{title}</p>
          <p className="text-xs text-muted-foreground">{showName}</p>
        </div>
        <p className="text-xs text-muted-foreground shrink-0">{summary}</p>
      </summary>
      <div className="space-y-4 px-4 pb-4 pt-2">{children}</div>
    </details>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/admin/blog-ideas/episode-group.tsx
git commit -m "feat: add EpisodeGroup collapsible component"
```

---

### Task 2: Refactor Page to Group Cards by Episode

**Files:**
- Modify: `src/app/admin/blog-ideas/page.tsx`

This is the main refactor. The page currently builds a flat `cards` array and renders each as a `<Card>`. We need to:
1. Group cards by `jobId` (custom blogs without a jobId go into a "custom" group)
2. Filter out stale suggestions (>30 days, no blog post)
3. Compute a summary string per group
4. Render each group using `<EpisodeGroup>`

- [ ] **Step 1: Add imports and helper types**

At the top of `src/app/admin/blog-ideas/page.tsx`, add the import for the new component:

```tsx
import { EpisodeGroup } from "./episode-group";
```

Also add this interface after the existing `DisplayCard` interface (after line 39):

```tsx
interface EpisodeCardGroup {
  groupKey: string;
  episodeTitle: string;
  showName: string;
  cards: DisplayCard[];
  summary: string;
}
```

- [ ] **Step 2: Add the summary builder function**

Add this function before the `BlogIdeasPage` component (before `export default`):

```tsx
function buildGroupSummary(cards: DisplayCard[]): string {
  let ideas = 0;
  let drafts = 0;
  let reviewing: string[] = [];
  let published = 0;

  for (const card of cards) {
    if (!card.blogPost) {
      ideas++;
    } else if (card.blogPost.status === "draft") {
      drafts++;
    } else if (card.blogPost.status === "reviewing") {
      const editInfo = card.blogPost.editCheckLabel && card.blogPost.editCheckLabel !== "No changes"
        ? ` (${card.blogPost.editCheckLabel}${card.blogPost.editCheckPercentage != null ? ` ~${card.blogPost.editCheckPercentage}%` : ""})`
        : "";
      reviewing.push(`with host${editInfo}`);
    } else if (card.blogPost.status === "published") {
      published++;
    }
  }

  const parts: string[] = [];
  if (ideas > 0) parts.push(`${ideas} idea${ideas !== 1 ? "s" : ""}`);
  if (drafts > 0) parts.push(`${drafts} draft${drafts !== 1 ? "s" : ""}`);
  for (const r of reviewing) parts.push(r);
  if (published > 0) parts.push(`${published} published`);

  return parts.join(" · ") || "empty";
}
```

- [ ] **Step 3: Replace the flat card rendering with grouped rendering**

Replace everything in the `BlogIdeasPage` function from the line `const cards: DisplayCard[] = [...]` (line 141) through the end of the return JSX (line 226) with:

```tsx
  const allCards: DisplayCard[] = [...suggestionCards, ...customCards].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );

  // Filter out stale suggestions: >30 days old with no blog post generated
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const activeCards = allCards.filter(
    (card) =>
      card.blogPost !== null ||
      card.bodyLabel === "Custom brief" ||
      card.createdAt >= thirtyDaysAgo
  );
  const hiddenCount = allCards.length - activeCards.length;

  // Group cards by jobId (episode). Custom blogs without a job go to "custom" group.
  const groupMap = new Map<string, DisplayCard[]>();
  for (const card of activeCards) {
    // For suggestion cards, group by the job ID embedded in the key
    // For custom cards, use their own key since they may or may not have a jobId
    const groupKey = card.bodyLabel === "Custom brief" ? `custom:${card.key}` : (card.key.split(":")[0] === "suggestion" ? `job:${blogSuggestions.find(s => s.id === card.suggestionId)?.job.id ?? card.key}` : card.key);
    const existing = groupMap.get(groupKey) ?? [];
    existing.push(card);
    groupMap.set(groupKey, existing);
  }

  const groups: EpisodeCardGroup[] = Array.from(groupMap.entries()).map(
    ([groupKey, cards]) => {
      const first = cards[0];
      return {
        groupKey,
        episodeTitle: first.episodeTitle ?? first.blogPost?.title ?? "Custom blog",
        showName: first.showName,
        cards,
        summary: buildGroupSummary(cards),
      };
    }
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Blog Ideas</h2>
          <p className="text-sm text-muted-foreground">
            AI-generated blog post ideas from episode transcripts, plus custom
            briefs. Generate a draft, send to the host for review, then publish
            to WordPress.
          </p>
        </div>
      </div>

      <CustomBlogForm shows={showsForForm} styleGuideMap={styleGuideRecord} />

      {groups.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-12 text-center">
          <BookOpenIcon className="size-8 text-muted-foreground" />
          <p className="text-muted-foreground">
            No blog ideas yet. They&apos;ll appear here after episodes are
            processed or when you create a custom blog above.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <EpisodeGroup
              key={group.groupKey}
              title={group.episodeTitle}
              showName={group.showName}
              summary={group.summary}
            >
              {group.cards.map((card) => {
                const displayTitle =
                  card.episodeTitle ?? card.blogPost?.title ?? "Custom blog";
                return (
                  <Card key={card.key}>
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <CardTitle className="text-base">
                            {displayTitle}
                          </CardTitle>
                          <p className="text-sm text-muted-foreground">
                            {card.showName}
                            {card.bodyLabel === "Custom brief" && " · Custom"}
                          </p>
                        </div>
                        {card.suggestionAccepted && !card.blogPost && (
                          <Badge className="bg-green-100 text-green-800">
                            Generated
                          </Badge>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {card.bodyLabel === "Custom brief" ? (
                        <details className="text-sm">
                          <summary className="cursor-pointer text-muted-foreground">
                            Custom brief
                          </summary>
                          <p className="mt-2 whitespace-pre-wrap">{card.body}</p>
                        </details>
                      ) : (
                        <p className="whitespace-pre-wrap text-sm">{card.body}</p>
                      )}

                      {card.blogPost ? (
                        <BlogPostControls
                          blogPost={card.blogPost}
                          defaultHostEmail={reviewerEmailMap.get(card.wpShowId)}
                        />
                      ) : card.suggestionId ? (
                        <GenerateBlogButton
                          suggestionId={card.suggestionId}
                          episodeTitle={card.episodeTitle ?? ""}
                          generated={card.suggestionAccepted ?? false}
                          styleGuideHost={styleGuideMap.get(card.wpShowId)}
                        />
                      ) : null}
                    </CardContent>
                  </Card>
                );
              })}
            </EpisodeGroup>
          ))}

          {hiddenCount > 0 && (
            <p className="text-center text-sm text-muted-foreground pt-2">
              {hiddenCount} older idea{hiddenCount !== 1 ? "s" : ""} hidden (older than 30 days with no blog post).
            </p>
          )}
        </div>
      )}
    </div>
  );
```

**IMPORTANT:** The grouping logic above has a flaw — it tries to look up `blogSuggestions` by `suggestionId` which is clunky. A cleaner approach: add a `jobId` field to the `DisplayCard` interface and populate it during card creation, then group by that.

Update the `DisplayCard` interface to add `jobId`:

```tsx
interface DisplayCard {
  key: string;
  jobId: string | null;
  episodeTitle: string | null;
  showName: string;
  wpShowId: number;
  body: string;
  bodyLabel: "Idea" | "Custom brief";
  createdAt: Date;
  blogPost: BlogPostWithControls | null;
  suggestionId?: string;
  suggestionAccepted?: boolean;
}
```

Update `suggestionCards` mapping (around line 105) to include `jobId`:

```tsx
  const suggestionCards: DisplayCard[] = blogSuggestions.map((s) => ({
    key: `suggestion:${s.id}`,
    jobId: s.job.id,
    episodeTitle: s.job.title,
    showName:
      showNameMap.get(s.job.wpShowId) ?? `Show #${s.job.wpShowId}`,
    wpShowId: s.job.wpShowId,
    body: s.content,
    bodyLabel: "Idea",
    createdAt: s.job.createdAt,
    blogPost: s.blogPost,
    suggestionId: s.id,
    suggestionAccepted: s.accepted,
  }));
```

Update `customCards` mapping (around line 120) to include `jobId`:

```tsx
  const customCards: DisplayCard[] = customBlogs.map((b) => ({
    key: `custom:${b.id}`,
    jobId: null,
    episodeTitle: b.job?.title ?? null,
    showName: showNameMap.get(b.wpShowId) ?? `Show #${b.wpShowId}`,
    wpShowId: b.wpShowId,
    body: b.customPrompt ?? "",
    bodyLabel: "Custom brief",
    createdAt: b.createdAt,
    blogPost: {
      id: b.id,
      title: b.title,
      googleDocUrl: b.googleDocUrl,
      author: b.author,
      hostEmail: b.hostEmail,
      status: b.status,
      wpPostUrl: b.wpPostUrl,
      editCheckPercentage: b.editCheckPercentage,
      editCheckLabel: b.editCheckLabel,
    },
  }));
```

Then the grouping logic becomes clean:

```tsx
  const groupMap = new Map<string, DisplayCard[]>();
  for (const card of activeCards) {
    const groupKey = card.jobId ?? `custom:${card.key}`;
    const existing = groupMap.get(groupKey) ?? [];
    existing.push(card);
    groupMap.set(groupKey, existing);
  }
```

- [ ] **Step 4: Verify build**

```bash
npm run build
```

Expected: Build succeeds with no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/blog-ideas/page.tsx
git commit -m "feat: group blog ideas by episode with collapsible sections and 30-day cleanup"
```

---

### Task 3: Build Verification

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

```bash
npm test
```

Expected: All existing tests pass (no new tests needed — this is a UI refactor with no new logic beyond the summary builder, which is straightforward string concatenation).

- [ ] **Step 2: Run build**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 3: Final commit if fixes needed**

```bash
git add -A
git commit -m "fix: resolve build/test issues for blog ideas grouping"
```
