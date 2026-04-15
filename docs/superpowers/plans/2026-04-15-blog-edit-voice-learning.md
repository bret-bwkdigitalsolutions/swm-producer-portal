# Blog Edit Voice Learning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture host edits to AI-generated blog posts and synthesize them into per-show style guides that improve future blog generation prompts.

**Architecture:** Store original AI-generated HTML on `BlogPost` at generation time, capture a `BlogEditRecord` (before/after) at publish time, add `styleGuide`/`styleGuideUpdatedAt` to `ShowMetadata`. Admin-triggered synthesis analyzes all diffs via Claude. Blog generation prompt adaptively injects style guide and/or raw examples based on edit history depth.

**Tech Stack:** Prisma 7 (migration + schema), Anthropic SDK (Claude Sonnet for synthesis), Next.js Server Actions, React client components (shadcn/ui patterns)

---

### Task 1: Database Migration — Add `originalContent` to BlogPost

**Files:**
- Modify: `prisma/schema.prisma:308-331` (BlogPost model)
- Create: new migration via `npx prisma migrate dev`

- [ ] **Step 1: Add `originalContent` field to BlogPost model**

In `prisma/schema.prisma`, add the field to the BlogPost model after the `seoKeyphrase` field:

```prisma
  seoKeyphrase     String?
  originalContent  String?  // AI-generated HTML body, saved at generation time
  status           String   @default("draft")
```

- [ ] **Step 2: Run the migration**

Run: `npx prisma migrate dev --name add-blog-original-content`
Expected: Migration created and applied successfully.

- [ ] **Step 3: Verify migration**

Run: `npx prisma studio`
Check that the `blog_posts` table now has an `originalContent` column.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add originalContent field to BlogPost for edit tracking"
```

---

### Task 2: Database Migration — Add BlogEditRecord model

**Files:**
- Modify: `prisma/schema.prisma` (add new model after BlogPost)
- Create: new migration via `npx prisma migrate dev`

- [ ] **Step 1: Add BlogEditRecord model to schema**

In `prisma/schema.prisma`, add the new model after the BlogPost model (after line 331):

```prisma
model BlogEditRecord {
  id              String   @id @default(cuid())
  blogPostId      String   @unique
  wpShowId        Int
  originalContent String
  editedContent   String
  createdAt       DateTime @default(now())

  blogPost BlogPost @relation(fields: [blogPostId], references: [id], onDelete: Cascade)

  @@index([wpShowId])
  @@map("blog_edit_records")
}
```

Also add the reverse relation to the BlogPost model. After the `job` relation line:

```prisma
  job        DistributionJob  @relation(fields: [jobId], references: [id], onDelete: Cascade)
  editRecord BlogEditRecord?
```

- [ ] **Step 2: Run the migration**

Run: `npx prisma migrate dev --name add-blog-edit-record`
Expected: Migration created and applied successfully.

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add BlogEditRecord model for tracking host edits"
```

---

### Task 3: Database Migration — Add styleGuide fields to ShowMetadata

**Files:**
- Modify: `prisma/schema.prisma:191-201` (ShowMetadata model)
- Create: new migration via `npx prisma migrate dev`

- [ ] **Step 1: Add styleGuide fields to ShowMetadata**

In `prisma/schema.prisma`, add to the ShowMetadata model after the `bilingual` field:

```prisma
  bilingual         Boolean @default(false)
  styleGuide        String?  // Synthesized host voice/style profile
  styleGuideUpdatedAt DateTime? // Last synthesis timestamp
```

- [ ] **Step 2: Run the migration**

Run: `npx prisma migrate dev --name add-show-style-guide`
Expected: Migration created and applied successfully.

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add styleGuide fields to ShowMetadata"
```

---

### Task 4: Save originalContent at Blog Generation Time

**Files:**
- Modify: `src/app/admin/blog-ideas/actions.ts:182-196` (generateBlogPost, BlogPost create)

- [ ] **Step 1: Add `originalContent` to the BlogPost create call**

In `src/app/admin/blog-ideas/actions.ts`, find the `db.blogPost.create` call (line 182) and add `originalContent: postContent` to the data object:

```typescript
    const blogPost = await db.blogPost.create({
      data: {
        suggestionId: suggestion.id,
        jobId: suggestion.job.id,
        wpShowId: suggestion.job.wpShowId,
        title: postTitle,
        googleDocId: docId,
        googleDocUrl: docUrl,
        author: previousPost?.author ?? null,
        excerpt: excerpt || null,
        seoDescription: seoDescription || null,
        seoKeyphrase: seoKeyphrase || null,
        originalContent: postContent,
        status: "draft",
      },
    });
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: Build succeeds with no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/blog-ideas/actions.ts
git commit -m "feat: save originalContent when generating blog posts"
```

---

### Task 5: Capture BlogEditRecord at Publish Time

**Files:**
- Modify: `src/app/admin/blog-ideas/blog-actions.ts:165-367` (publishToWordPress)

- [ ] **Step 1: Add edit record capture after reading Google Doc content**

In `src/app/admin/blog-ideas/blog-actions.ts`, in the `publishToWordPress` function, after the Google Doc is read successfully (after line 213, after the `docHtml` variable is set), and after the `blogPost` is fetched — add the edit record capture. Insert this block right before the `// Use the BlogPost title` comment (line 219):

```typescript
  // Capture edit record if host made changes
  if (blogPost.originalContent && blogPost.originalContent !== docHtml) {
    try {
      await db.blogEditRecord.upsert({
        where: { blogPostId: blogPost.id },
        create: {
          blogPostId: blogPost.id,
          wpShowId: blogPost.job.wpShowId,
          originalContent: blogPost.originalContent,
          editedContent: docHtml,
        },
        update: {
          originalContent: blogPost.originalContent,
          editedContent: docHtml,
        },
      });
    } catch (error) {
      // Non-fatal — don't block publishing if edit capture fails
      console.error("[blog] Edit record capture failed (non-fatal):", error);
    }
  }
```

- [ ] **Step 2: Update the blogPost query to include `originalContent`**

The `blogPost` query at line 175 needs to fetch `originalContent`. Currently the `findUnique` includes related data but doesn't explicitly select fields — Prisma returns all scalar fields by default, so `originalContent` is already included. No change needed here.

Verify by checking that the `blogPost` variable's type includes `originalContent` — since we added the field to the schema, it will be there automatically.

- [ ] **Step 3: Also update the `job` select to include `wpShowId`**

Check that `blogPost.job.wpShowId` is already selected in the query at line 175. Looking at the existing code:

```typescript
  job: {
    select: {
      title: true,
      wpShowId: true,
      metadata: true,
      platforms: { ... },
    },
  },
```

`wpShowId` is already selected. No change needed.

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: Build succeeds with no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/blog-ideas/blog-actions.ts
git commit -m "feat: capture BlogEditRecord when publishing edited blog posts"
```

---

### Task 6: Style Guide Synthesis Server Action

**Files:**
- Create: `src/app/admin/shows/style-guide-actions.ts`

- [ ] **Step 1: Create the synthesis server action**

Create `src/app/admin/shows/style-guide-actions.ts`:

```typescript
"use server";

import { requireAdmin } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";

interface ActionResult {
  success: boolean;
  message: string;
  styleGuide?: string;
}

export async function synthesizeStyleGuide(
  wpShowId: number
): Promise<ActionResult> {
  await requireAdmin();

  const editRecords = await db.blogEditRecord.findMany({
    where: { wpShowId },
    orderBy: { createdAt: "asc" },
  });

  if (editRecords.length === 0) {
    return {
      success: false,
      message: "No edit records found. Publish some edited blog posts first.",
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { success: false, message: "ANTHROPIC_API_KEY is not set." };
  }

  // Build the analysis prompt with all before/after pairs
  const pairs = editRecords.map((record, i) => {
    return [
      `## Edit ${i + 1}`,
      "",
      "### Original (AI-generated)",
      record.originalContent,
      "",
      "### Host-Edited Version",
      record.editedContent,
    ].join("\n");
  });

  const prompt = [
    "You are analyzing a series of before/after edits that a podcast host made to AI-generated blog posts.",
    "Your job is to extract a concise style guide that captures this host's voice, preferences, and patterns.",
    "",
    "Below are the original AI-generated versions and the host's edited versions of several blog posts.",
    "",
    ...pairs,
    "",
    "## Instructions",
    "",
    "Analyze the differences between the original and edited versions across ALL examples above.",
    "Write a concise style guide (300-500 words) that captures:",
    "",
    "1. **Tone & Voice** — How does the host's writing differ in tone from the AI? (e.g., more conversational, uses humor, more direct)",
    "2. **Structure** — How does the host reorganize content? (e.g., shorter paragraphs, different heading style, preferred intro/outro patterns)",
    "3. **Vocabulary** — Words or phrases the host consistently adds or prefers, and words they consistently remove or avoid",
    "4. **Content Additions** — Types of content the host adds (personal anecdotes, specific examples, calls to action, questions to the reader)",
    "5. **Things to Avoid** — Patterns the host consistently removes or changes away from",
    "",
    "Write the style guide as direct instructions to an AI writer, e.g., 'Use a conversational tone' not 'The host prefers a conversational tone'.",
    "Focus on patterns that appear across multiple edits, not one-off changes.",
    "Be specific and actionable — 'Use short, punchy sentences' is better than 'Write clearly'.",
  ].join("\n");

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const styleGuide = textBlock?.text?.trim() ?? "";

    if (!styleGuide) {
      return { success: false, message: "AI returned empty style guide." };
    }

    await db.showMetadata.upsert({
      where: { wpShowId },
      create: {
        wpShowId,
        hosts: "",
        styleGuide,
        styleGuideUpdatedAt: new Date(),
      },
      update: {
        styleGuide,
        styleGuideUpdatedAt: new Date(),
      },
    });

    return {
      success: true,
      message: `Style guide synthesized from ${editRecords.length} edited post${editRecords.length !== 1 ? "s" : ""}.`,
      styleGuide,
    };
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : "Style guide synthesis failed";
    return { success: false, message: msg };
  }
}
```

- [ ] **Step 2: Verify the build**

Run: `npm run build`
Expected: Build succeeds with no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/shows/style-guide-actions.ts
git commit -m "feat: add style guide synthesis server action"
```

---

### Task 7: Style Guide UI on Show Admin Page

**Files:**
- Create: `src/app/admin/shows/show-style-guide.tsx`
- Modify: `src/app/admin/shows/page.tsx:14-153` (add component + data fetching)

- [ ] **Step 1: Create the ShowStyleGuide client component**

Create `src/app/admin/shows/show-style-guide.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2Icon, SparklesIcon } from "lucide-react";
import { synthesizeStyleGuide } from "./style-guide-actions";

interface ShowStyleGuideProps {
  wpShowId: number;
  currentStyleGuide: string | null;
  styleGuideUpdatedAt: string | null; // ISO string
  editRecordCount: number;
}

export function ShowStyleGuide({
  wpShowId,
  currentStyleGuide,
  styleGuideUpdatedAt,
  editRecordCount,
}: ShowStyleGuideProps) {
  const [synthesizing, setSynthesizing] = useState(false);
  const [styleGuide, setStyleGuide] = useState(currentStyleGuide);
  const [updatedAt, setUpdatedAt] = useState(styleGuideUpdatedAt);
  const [message, setMessage] = useState<{
    text: string;
    success: boolean;
  } | null>(null);

  async function handleSynthesize() {
    setSynthesizing(true);
    setMessage(null);

    try {
      const result = await synthesizeStyleGuide(wpShowId);
      setMessage({ text: result.message, success: result.success });
      if (result.success && result.styleGuide) {
        setStyleGuide(result.styleGuide);
        setUpdatedAt(new Date().toISOString());
      }
    } catch {
      setMessage({ text: "Synthesis failed unexpectedly.", success: false });
    } finally {
      setSynthesizing(false);
    }
  }

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">Voice & Style</Label>

      {editRecordCount === 0 && !styleGuide ? (
        <p className="text-xs text-muted-foreground">
          No style guide yet — publish edited blog posts to start building one.
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {editRecordCount} edited post{editRecordCount !== 1 ? "s" : ""}{" "}
            available
            {updatedAt && (
              <>
                {" · "}
                Last updated{" "}
                {new Date(updatedAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </>
            )}
          </p>

          {styleGuide && (
            <div className="max-h-48 overflow-y-auto rounded-md border bg-muted/50 p-3 text-xs leading-relaxed whitespace-pre-wrap">
              {styleGuide}
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            disabled={synthesizing || editRecordCount === 0}
            onClick={handleSynthesize}
          >
            {synthesizing ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <SparklesIcon className="size-3.5" />
            )}
            {synthesizing
              ? "Synthesizing..."
              : styleGuide
                ? "Update Style Guide"
                : "Generate Style Guide"}
          </Button>

          {message && (
            <p
              className={`text-xs ${message.success ? "text-green-600" : "text-destructive"}`}
            >
              {message.text}
            </p>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add edit record counts to the show admin page data fetching**

In `src/app/admin/shows/page.tsx`, add the import at the top:

```typescript
import { ShowStyleGuide } from "./show-style-guide";
```

Then update the `Promise.all` to include edit record counts. Replace the existing `Promise.all` (lines 15-22):

```typescript
  const [shows, allStakeholders, allPlatformLinks, allShowMetadata, editRecordCounts] = await Promise.all([
    getCachedShows().catch(() => []),
    db.showStakeholder.findMany({
      orderBy: { name: "asc" },
    }),
    db.showPlatformLink.findMany(),
    db.showMetadata.findMany(),
    db.blogEditRecord.groupBy({
      by: ["wpShowId"],
      _count: { id: true },
    }),
  ]);
```

Then add a map for the counts after the existing maps (after line 49):

```typescript
  const editCountByShow = new Map(
    editRecordCounts.map((r) => [r.wpShowId, r._count.id])
  );
```

- [ ] **Step 3: Add ShowStyleGuide component to each show card**

In `src/app/admin/shows/page.tsx`, add the `ShowStyleGuide` component after the `ShowLanguageEditor` and before the first `<div className="border-t pt-4" />` (after line 131):

```tsx
                  <ShowStyleGuide
                    wpShowId={show.id}
                    currentStyleGuide={showMeta?.styleGuide ?? null}
                    styleGuideUpdatedAt={
                      showMeta?.styleGuideUpdatedAt?.toISOString() ?? null
                    }
                    editRecordCount={editCountByShow.get(show.id) ?? 0}
                  />
```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: Build succeeds with no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/shows/show-style-guide.tsx src/app/admin/shows/page.tsx
git commit -m "feat: add Voice & Style section to show admin page"
```

---

### Task 8: Inject Style Guide into Blog Generation Prompt

**Files:**
- Modify: `src/app/admin/blog-ideas/actions.ts:18-215` (generateBlogPost)

- [ ] **Step 1: Load style context before building the prompt**

In `src/app/admin/blog-ideas/actions.ts`, in `generateBlogPost()`, after the `showLanguage` variable is set (after line 45), add the style context loading:

```typescript
  // Load style context for this show
  const editRecords = await db.blogEditRecord.findMany({
    where: { wpShowId: suggestion.job.wpShowId },
    orderBy: { createdAt: "desc" },
  });
  const hasStyleGuide = !!showMetadata?.styleGuide;
  const editCount = editRecords.length;
```

- [ ] **Step 2: Build the style context section**

After the edit records query, add the style context builder:

```typescript
  // Build style context for the prompt
  let styleContext = "";
  if (editCount > 0) {
    if (editCount >= 5 && hasStyleGuide) {
      // Mature: style guide + 1-2 recent examples
      const recentExamples = editRecords.slice(0, 2);
      const examplePairs = recentExamples
        .map((r, i) => {
          const orig = truncateMiddle(r.originalContent, 2000);
          const edited = truncateMiddle(r.editedContent, 2000);
          return `### Example ${i + 1}\n\n**Original:**\n${orig}\n\n**Host-edited:**\n${edited}`;
        })
        .join("\n\n");

      styleContext = [
        "## Host Style Guide",
        "The host of this show has a specific writing style. Follow this style guide closely:",
        "",
        showMetadata!.styleGuide,
        "",
        "## Recent Edit Examples",
        "Here are recent examples of the host's edits for reference:",
        "",
        examplePairs,
      ].join("\n");
    } else {
      // Early: raw before/after pairs only
      const examples = editRecords.slice(0, 4);
      const examplePairs = examples
        .map((r, i) => {
          const orig = truncateMiddle(r.originalContent, 2000);
          const edited = truncateMiddle(r.editedContent, 2000);
          return `### Example ${i + 1}\n\n**Original AI version:**\n${orig}\n\n**Host-edited version:**\n${edited}`;
        })
        .join("\n\n");

      styleContext = [
        "## Host Edit Examples",
        "The host of this show has edited previous AI-generated blog posts. Study these before/after examples and match their style, tone, and preferences in your writing:",
        "",
        examplePairs,
      ].join("\n");
    }
  }
```

- [ ] **Step 3: Add the truncateMiddle helper**

Add this function at the top of the file, after the imports (after line 6):

```typescript
/** Truncate content to roughly `maxChars`, keeping start and end. */
function truncateMiddle(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  const half = Math.floor(maxChars / 2);
  return (
    content.slice(0, half) +
    "\n\n[... middle content trimmed for brevity ...]\n\n" +
    content.slice(-half)
  );
}
```

- [ ] **Step 4: Inject style context into the prompt**

In the prompt array (starting at line 67), add `styleContext` before the `customInstructions` block. Replace the last two entries of the prompt array:

```typescript
    showLanguage === "es"
      ? "- IMPORTANT: Write the entire blog post in Spanish — headline, excerpt, SEO description, keyphrase, and HTML body must all be in Spanish"
      : "",
    styleContext,
    customInstructions
      ? `\n## Additional Instructions from Editor\n${customInstructions}`
      : "",
  ]
```

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: Build succeeds with no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/blog-ideas/actions.ts
git commit -m "feat: inject host style guide into blog generation prompt"
```

---

### Task 9: Style Guide Indicator on Blog Ideas Page

**Files:**
- Modify: `src/app/admin/blog-ideas/page.tsx:14-116`
- Modify: `src/app/admin/blog-ideas/generate-blog-button.tsx:17-150`

- [ ] **Step 1: Pass style guide availability to GenerateBlogButton**

In `src/app/admin/blog-ideas/page.tsx`, update the `allShowMetadata` query to include `styleGuide` (line 33):

```typescript
    db.showMetadata.findMany({
      select: { wpShowId: true, blogReviewerEmails: true, styleGuide: true },
    }),
```

Add a style guide map after the `reviewerEmailMap` (after line 44):

```typescript
  const styleGuideMap = new Map(
    allShowMetadata
      .filter((sm) => sm.styleGuide)
      .map((sm) => [sm.wpShowId, true])
  );
```

Then pass `hasStyleGuide` to the `GenerateBlogButton` component (around line 102):

```tsx
                    <GenerateBlogButton
                      suggestionId={suggestion.id}
                      episodeTitle={suggestion.job.title}
                      generated={suggestion.accepted}
                      hasStyleGuide={styleGuideMap.has(suggestion.job.wpShowId)}
                    />
```

- [ ] **Step 2: Display style guide indicator in GenerateBlogButton**

In `src/app/admin/blog-ideas/generate-blog-button.tsx`, add `hasStyleGuide` to the props interface (line 18):

```typescript
interface GenerateBlogButtonProps {
  suggestionId: string;
  episodeTitle: string;
  generated: boolean;
  hasStyleGuide?: boolean;
}
```

Update the component destructuring (line 23):

```typescript
export function GenerateBlogButton({
  suggestionId,
  episodeTitle,
  generated,
  hasStyleGuide,
}: GenerateBlogButtonProps) {
```

Add the indicator right after the `<div className="flex items-center gap-2">` opening tag and before the generate Button (after line 96). Add it after the Button's closing tag and before the Customize button:

```tsx
        {hasStyleGuide && !generating && (
          <span className="text-xs text-muted-foreground">
            Using host style guide
          </span>
        )}
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: Build succeeds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/blog-ideas/page.tsx src/app/admin/blog-ideas/generate-blog-button.tsx
git commit -m "feat: show style guide indicator on blog ideas page"
```
