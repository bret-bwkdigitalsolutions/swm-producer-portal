# Blog Edit Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect when hosts edit blog posts in Google Docs and show a change percentage badge on the blog ideas page.

**Architecture:** Add `sentToHostAt` and edit-check cache columns to `BlogPost`. On page load, check Google Drive `modifiedTime` for "reviewing" posts sent within the last 14 days, diff against `originalContent` if modified, cache results for 1 hour. Display color-coded badge on blog post cards.

**Tech Stack:** Prisma migration, Google Drive API (metadata), existing `readGoogleDocAsHtml`, Vitest

---

### File Map

| File | Action | Responsibility |
|---|---|---|
| `prisma/schema.prisma` | Modify | Add 4 columns to BlogPost |
| `src/lib/google/docs.ts` | Modify | Add `getDocModifiedTime()` function |
| `src/lib/blog/edit-check.ts` | Create | `computeEditPercentage()` pure function + `checkBlogEdits()` orchestrator |
| `src/app/admin/blog-ideas/blog-actions.ts` | Modify | Set `sentToHostAt` in `sendToHost()` |
| `src/app/admin/blog-ideas/page.tsx` | Modify | Call `checkBlogEdits()`, pass edit data to controls |
| `src/app/admin/blog-ideas/blog-post-controls.tsx` | Modify | Render edit status badge |
| `src/lib/blog/__tests__/edit-check.test.ts` | Create | Tests for `computeEditPercentage()` and label mapping |

---

### Task 1: Prisma Migration — Add Edit Check Columns

**Files:**
- Modify: `prisma/schema.prisma:310-337`

- [ ] **Step 1: Update BlogPost model in schema.prisma**

Add these 4 fields after `wpPostUrl` (line 328), before `createdAt`:

```prisma
  sentToHostAt         DateTime?
  editCheckPercentage  Int?
  editCheckLabel       String?
  editCheckAt          DateTime?
```

- [ ] **Step 2: Generate and run migration**

```bash
npx prisma migrate dev --name add_blog_edit_check_columns
```

Expected: Migration creates successfully, adds 4 nullable columns to `blog_posts` table.

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add edit check columns to BlogPost schema"
```

---

### Task 2: Google Drive Modified Time Helper

**Files:**
- Modify: `src/lib/google/docs.ts`
- Create: `src/lib/blog/__tests__/edit-check.test.ts` (test for `computeEditPercentage` — this task just adds the Drive helper)

- [ ] **Step 1: Add `getDocModifiedTime()` to `src/lib/google/docs.ts`**

Add after the existing `readGoogleDocAsHtml` function (around line 183):

```typescript
/**
 * Get the last modified time of a Google Doc via Drive API.
 * Uses a metadata-only call (fast, low quota cost).
 */
export async function getDocModifiedTime(docId: string): Promise<Date> {
  const data = await googleFetch(
    `${DRIVE_API}/files/${docId}?fields=modifiedTime`
  );
  return new Date(data.modifiedTime);
}
```

Note: `DRIVE_API` and `googleFetch` are already defined in this file.

- [ ] **Step 2: Commit**

```bash
git add src/lib/google/docs.ts
git commit -m "feat: add getDocModifiedTime helper for Drive API"
```

---

### Task 3: Edit Percentage Computation (Pure Function + Tests)

**Files:**
- Create: `src/lib/blog/edit-check.ts`
- Create: `src/lib/blog/__tests__/edit-check.test.ts`

- [ ] **Step 1: Write failing tests for `computeEditPercentage`**

Create `src/lib/blog/__tests__/edit-check.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { computeEditPercentage, getEditLabel } from "../edit-check";

describe("computeEditPercentage", () => {
  it("returns 0 for identical content", () => {
    const html = "<h2>Title</h2><p>Some paragraph text here.</p>";
    expect(computeEditPercentage(html, html)).toBe(0);
  });

  it("detects minor edits (typo fix)", () => {
    const original = "<h2>Title</h2><p>This is a great paragraph about music.</p>";
    const edited = "<h2>Title</h2><p>This is a great paragraph about jazz.</p>";
    const pct = computeEditPercentage(original, edited);
    expect(pct).toBeGreaterThan(0);
    expect(pct).toBeLessThanOrEqual(10);
  });

  it("detects moderate edits (rewritten paragraph)", () => {
    const original =
      "<h2>Intro</h2><p>Dallas has a rich music history spanning decades of innovation.</p>" +
      "<h2>Details</h2><p>The city grew into a hub for indie rock and jazz fusion.</p>";
    const edited =
      "<h2>Intro</h2><p>Dallas has a rich music history spanning decades of innovation.</p>" +
      "<h2>Details</h2><p>Over time, Dallas became known for its thriving hip-hop and electronic scenes.</p>";
    const pct = computeEditPercentage(original, edited);
    expect(pct).toBeGreaterThan(10);
    expect(pct).toBeLessThanOrEqual(50);
  });

  it("detects heavy rewrite", () => {
    const original = "<p>Original content about topic A with many details and examples.</p>";
    const edited = "<p>Completely different text about a new subject entirely.</p>";
    const pct = computeEditPercentage(original, edited);
    expect(pct).toBeGreaterThan(30);
  });

  it("strips HTML tags so formatting-only changes return 0", () => {
    const original = "<p>Some text here</p>";
    const edited = "<p><strong>Some text here</strong></p>";
    expect(computeEditPercentage(original, edited)).toBe(0);
  });

  it("returns 100 when original is empty and edited has content", () => {
    expect(computeEditPercentage("", "<p>New content</p>")).toBe(100);
  });

  it("handles null original gracefully", () => {
    expect(computeEditPercentage(null, "<p>New content</p>")).toBe(100);
  });
});

describe("getEditLabel", () => {
  it("returns 'No changes' for 0%", () => {
    expect(getEditLabel(0)).toBe("No changes");
  });

  it("returns 'Minor edits' for 1-10%", () => {
    expect(getEditLabel(5)).toBe("Minor edits");
    expect(getEditLabel(10)).toBe("Minor edits");
  });

  it("returns 'Moderate edits' for 11-30%", () => {
    expect(getEditLabel(15)).toBe("Moderate edits");
    expect(getEditLabel(30)).toBe("Moderate edits");
  });

  it("returns 'Heavily rewritten' for 31%+", () => {
    expect(getEditLabel(31)).toBe("Heavily rewritten");
    expect(getEditLabel(85)).toBe("Heavily rewritten");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- src/lib/blog/__tests__/edit-check.test.ts
```

Expected: FAIL — module `../edit-check` not found.

- [ ] **Step 3: Implement `computeEditPercentage` and `getEditLabel`**

Create `src/lib/blog/edit-check.ts`:

```typescript
/**
 * Strip HTML tags to get plain text for diffing.
 */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").trim();
}

/**
 * Compute the Levenshtein distance between two strings.
 * Uses a two-row optimization to keep memory O(min(a,b)).
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Ensure a is the shorter string for memory efficiency
  if (a.length > b.length) [a, b] = [b, a];

  let prev = Array.from({ length: a.length + 1 }, (_, i) => i);
  let curr = new Array<number>(a.length + 1);

  for (let j = 1; j <= b.length; j++) {
    curr[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[i] = Math.min(
        prev[i] + 1,        // deletion
        curr[i - 1] + 1,    // insertion
        prev[i - 1] + cost  // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[a.length];
}

/**
 * Compute the percentage of content that changed between original and edited HTML.
 * Strips HTML tags first so formatting-only changes don't count.
 * Returns 0-100.
 */
export function computeEditPercentage(
  originalHtml: string | null,
  editedHtml: string
): number {
  const original = stripHtml(originalHtml ?? "");
  const edited = stripHtml(editedHtml);

  if (original === edited) return 0;
  if (original.length === 0) return 100;

  const distance = levenshtein(original, edited);
  const maxLen = Math.max(original.length, edited.length);
  const pct = Math.round((distance / maxLen) * 100);

  return Math.min(pct, 100);
}

/**
 * Map a percentage to a human-readable label.
 */
export function getEditLabel(percentage: number): string {
  if (percentage === 0) return "No changes";
  if (percentage <= 10) return "Minor edits";
  if (percentage <= 30) return "Moderate edits";
  return "Heavily rewritten";
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- src/lib/blog/__tests__/edit-check.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/blog/edit-check.ts src/lib/blog/__tests__/edit-check.test.ts
git commit -m "feat: add computeEditPercentage and getEditLabel with tests"
```

---

### Task 4: Blog Edit Check Orchestrator

**Files:**
- Modify: `src/lib/blog/edit-check.ts`

- [ ] **Step 1: Add `checkBlogEdits()` orchestrator function**

Add to `src/lib/blog/edit-check.ts`, after the existing exports:

```typescript
import { db } from "@/lib/db";
import { getDocModifiedTime, readGoogleDocAsHtml } from "@/lib/google/docs";

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Check Google Docs for edits on all "reviewing" blog posts
 * sent within the last 14 days. Caches results for 1 hour.
 * Called from the blog ideas page on load.
 */
export async function checkBlogEdits(): Promise<void> {
  const cutoff = new Date(Date.now() - FOURTEEN_DAYS_MS);
  const staleAfter = new Date(Date.now() - ONE_HOUR_MS);

  const posts = await db.blogPost.findMany({
    where: {
      status: "reviewing",
      sentToHostAt: { gte: cutoff },
      OR: [
        { editCheckAt: null },
        { editCheckAt: { lt: staleAfter } },
      ],
    },
    select: {
      id: true,
      googleDocId: true,
      originalContent: true,
      sentToHostAt: true,
    },
  });

  for (const post of posts) {
    try {
      const modifiedTime = await getDocModifiedTime(post.googleDocId);

      // If doc hasn't been modified since we sent it, no changes
      if (post.sentToHostAt && modifiedTime < post.sentToHostAt) {
        await db.blogPost.update({
          where: { id: post.id },
          data: {
            editCheckPercentage: 0,
            editCheckLabel: "No changes",
            editCheckAt: new Date(),
          },
        });
        continue;
      }

      // Doc was modified — read content and compute diff
      const { html } = await readGoogleDocAsHtml(post.googleDocId);
      const percentage = computeEditPercentage(post.originalContent, html);
      const label = getEditLabel(percentage);

      await db.blogPost.update({
        where: { id: post.id },
        data: {
          editCheckPercentage: percentage,
          editCheckLabel: label,
          editCheckAt: new Date(),
        },
      });
    } catch (error) {
      // Non-fatal — log and skip this post
      console.error(
        `[edit-check] Failed to check blog post ${post.id}:`,
        error
      );
    }
  }
}
```

Note: The `import` statements for `db`, `getDocModifiedTime`, and `readGoogleDocAsHtml` should go at the top of the file. But since this file was initially created without `"use server"` or `"server-only"`, add `import "server-only";` at the very top of the file to prevent client bundling, and move the server imports to the top. The pure functions (`computeEditPercentage`, `getEditLabel`, `stripHtml`, `levenshtein`) should remain in this same file since they're used by the orchestrator.

The full file top should become:

```typescript
import "server-only";

import { db } from "@/lib/db";
import { getDocModifiedTime, readGoogleDocAsHtml } from "@/lib/google/docs";
```

For tests, vitest will need to handle the `"server-only"` import. Check if the project already mocks it. If not, vitest should still work since it doesn't enforce the server-only boundary — it's a build-time check only.

- [ ] **Step 2: Commit**

```bash
git add src/lib/blog/edit-check.ts
git commit -m "feat: add checkBlogEdits orchestrator for page-load edit detection"
```

---

### Task 5: Set `sentToHostAt` in sendToHost Action

**Files:**
- Modify: `src/app/admin/blog-ideas/blog-actions.ts:148-154`

- [ ] **Step 1: Update the `sendToHost` function's DB update**

In `src/app/admin/blog-ideas/blog-actions.ts`, find the `db.blogPost.update` call inside `sendToHost` (around line 148). Change:

```typescript
    data: {
      status: "reviewing",
      hostEmail: emailsString,
    },
```

to:

```typescript
    data: {
      status: "reviewing",
      hostEmail: emailsString,
      sentToHostAt: new Date(),
    },
```

- [ ] **Step 2: Commit**

```bash
git add src/app/admin/blog-ideas/blog-actions.ts
git commit -m "feat: set sentToHostAt when sending blog to host for review"
```

---

### Task 6: Call checkBlogEdits from Page + Pass Data to Controls

**Files:**
- Modify: `src/app/admin/blog-ideas/page.tsx`
- Modify: `src/app/admin/blog-ideas/blog-post-controls.tsx`

- [ ] **Step 1: Call `checkBlogEdits()` on page load and pass edit data**

In `src/app/admin/blog-ideas/page.tsx`:

1. Add import at top:
```typescript
import { checkBlogEdits } from "@/lib/blog/edit-check";
```

2. Inside `BlogIdeasPage()`, after the `Promise.all` block that fetches data (line 39-73), add:
```typescript
  // Check Google Docs for host edits on "reviewing" posts (cached, 1hr TTL)
  await checkBlogEdits();
```

3. Update the `BlogPostWithControls` type (line 15-23) to include edit check fields:
```typescript
type BlogPostWithControls = {
  id: string;
  title: string;
  googleDocUrl: string;
  author: string | null;
  hostEmail: string | null;
  status: string;
  wpPostUrl: string | null;
  editCheckPercentage: number | null;
  editCheckLabel: string | null;
};
```

4. Update the custom blog cards mapping (around line 113-130) to include the new fields:
```typescript
  const customCards: DisplayCard[] = customBlogs.map((b) => ({
    key: `custom:${b.id}`,
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

5. The suggestion-backed cards already pass the full `blogPost` from `s.blogPost` which includes all fields from Prisma, so those should already include the new columns automatically.

6. Also update the `customBlogs` query to include the new fields. The `db.blogPost.findMany` on line 57 already selects all fields (no explicit `select`), so Prisma will automatically include the new columns. No change needed.

- [ ] **Step 2: Update `BlogPostControls` component to accept and render edit badge**

In `src/app/admin/blog-ideas/blog-post-controls.tsx`:

1. Update the `BlogPostControlsProps` interface (line 19-28) to include edit fields:
```typescript
interface BlogPostControlsProps {
  blogPost: {
    id: string;
    title: string;
    googleDocUrl: string;
    author: string | null;
    hostEmail: string | null;
    status: string;
    wpPostUrl: string | null;
    editCheckPercentage: number | null;
    editCheckLabel: string | null;
  };
  defaultHostEmail?: string;
}
```

2. Add the edit status badge right after the existing "With Host" badge (after line 91). Replace the status badge block:

```tsx
      {/* Status badge */}
      {status === "reviewing" && (
        <div className="flex items-center gap-2">
          <Badge className="bg-amber-100 text-amber-800">With Host</Badge>
          {blogPost.editCheckLabel && (
            <EditStatusBadge
              label={blogPost.editCheckLabel}
              percentage={blogPost.editCheckPercentage}
            />
          )}
        </div>
      )}
      {status === "published" && (
        <Badge className="bg-green-100 text-green-800">Published</Badge>
      )}
```

3. Add the `EditStatusBadge` component at the bottom of the file (before the default export closing):

```tsx
function EditStatusBadge({
  label,
  percentage,
}: {
  label: string;
  percentage: number | null;
}) {
  const colorClass =
    label === "No changes"
      ? "bg-gray-100 text-gray-600"
      : label === "Minor edits"
        ? "bg-blue-100 text-blue-800"
        : label === "Moderate edits"
          ? "bg-amber-100 text-amber-800"
          : "bg-green-100 text-green-800"; // Heavily rewritten

  const displayText =
    label === "No changes"
      ? "No changes"
      : `${label} (~${percentage}%)`;

  return <Badge className={colorClass}>{displayText}</Badge>;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/blog-ideas/page.tsx src/app/admin/blog-ideas/blog-post-controls.tsx
git commit -m "feat: show edit detection badge on reviewing blog posts"
```

---

### Task 7: Build Verification

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 2: Run build**

```bash
npm run build
```

Expected: Build succeeds with no type errors.

- [ ] **Step 3: Final commit if any fixes were needed**

If build or tests required fixes, commit them:

```bash
git add -A
git commit -m "fix: resolve build/test issues for blog edit detection"
```
