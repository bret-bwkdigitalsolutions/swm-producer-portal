# Reaction Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reaction submission form with Content Type and Show dropdowns that posts to the `swm_reaction` WordPress post type.

**Architecture:** Follow the existing trailer form pattern — constants + POST_TYPE_MAP entry, server action with auth guards, client form component using FormShell/ShowSelect, page with show filtering. The sidebar auto-generates from CONTENT_TYPE_LABELS so no nav changes needed.

**Tech Stack:** Next.js server actions, FormShell, ShowSelect, ImageInput, WordPress REST API

---

### File Map

| File | Action | Responsibility |
|---|---|---|
| `src/lib/constants.ts` | Modify | Add REACTION to ContentType and CONTENT_TYPE_LABELS |
| `src/lib/wordpress/client.ts` | Modify | Add swm_reaction to POST_TYPE_MAP |
| `src/app/dashboard/reaction/actions.ts` | Create | Server action submitReaction() |
| `src/components/forms/reaction-form.tsx` | Create | Reaction form component |
| `src/app/dashboard/reaction/page.tsx` | Create | Page shell with auth + show filtering |

---

### Task 1: Add Reaction Content Type Constants

**Files:**
- Modify: `src/lib/constants.ts`
- Modify: `src/lib/wordpress/client.ts:32-39`

- [ ] **Step 1: Add REACTION to ContentType and labels**

In `src/lib/constants.ts`, add `REACTION: "reaction"` to the `ContentType` object (after `SHOW`):

```typescript
export const ContentType = {
  REVIEW: "review",
  TRAILER: "trailer",
  APPEARANCE: "appearance",
  EPISODE: "episode",
  CASE_DOCUMENT: "case_document",
  SHOW: "show",
  REACTION: "reaction",
} as const;
```

Add to `CONTENT_TYPE_LABELS`:

```typescript
export const CONTENT_TYPE_LABELS: Record<ContentTypeValue, string> = {
  [ContentType.REVIEW]: "Reviews",
  [ContentType.TRAILER]: "Trailers",
  [ContentType.APPEARANCE]: "Appearances",
  [ContentType.EPISODE]: "Episodes",
  [ContentType.CASE_DOCUMENT]: "Case Documents",
  [ContentType.SHOW]: "Shows",
  [ContentType.REACTION]: "Reactions",
};
```

- [ ] **Step 2: Add swm_reaction to POST_TYPE_MAP**

In `src/lib/wordpress/client.ts`, add to `POST_TYPE_MAP` (around line 38):

```typescript
const POST_TYPE_MAP: Record<string, string> = {
  [ContentType.REVIEW]: "swm_review",
  [ContentType.TRAILER]: "swm_trailer",
  [ContentType.APPEARANCE]: "swm_appearance",
  [ContentType.EPISODE]: "swm_episode",
  [ContentType.CASE_DOCUMENT]: "swm_case_doc",
  [ContentType.SHOW]: "swm_show",
  [ContentType.REACTION]: "swm_reaction",
};
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/lib/constants.ts src/lib/wordpress/client.ts
git commit -m "feat: add REACTION content type and WP post type mapping"
```

---

### Task 2: Create Server Action

**Files:**
- Create: `src/app/dashboard/reaction/actions.ts`

- [ ] **Step 1: Create the submitReaction server action**

Create `src/app/dashboard/reaction/actions.ts`:

```typescript
"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createPost, uploadMedia } from "@/lib/wordpress/client";
import { WpApiError } from "@/lib/wordpress/types";
import { ContentType } from "@/lib/constants";
import { verifyShowAccess, verifyContentTypeAccess } from "@/lib/auth-guard";
import { toISOWithTimezone } from "@/lib/timezone";

interface FormState {
  success?: boolean;
  message?: string;
  errors?: Record<string, string[]>;
}

export async function submitReaction(
  prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, message: "You must be logged in." };
  }

  const hasContentAccess = await verifyContentTypeAccess(
    session.user.id,
    session.user.role,
    ContentType.REACTION
  );
  if (!hasContentAccess) {
    return { success: false, message: "You do not have access to this content type." };
  }

  const showIdRaw = formData.get("show_id") as string;
  if (showIdRaw) {
    const hasShowAccess = await verifyShowAccess(session.user.id, parseInt(showIdRaw, 10));
    if (!hasShowAccess) {
      return { success: false, message: "You do not have access to this show." };
    }
  }

  // Extract fields
  const showId = formData.get("show_id") as string;
  const reactionType = formData.get("reaction_type") as string;
  const title = formData.get("title") as string;
  const youtubeVideoId = formData.get("youtube_video_id") as string;
  const teamsCovered = formData.get("teams_covered") as string;
  const gameWindow = formData.get("game_window") as string;
  const thumbnailFile = formData.get("thumbnail_file") as File | null;
  const thumbnailUrl = formData.get("thumbnail_url") as string | null;
  const status = formData.get("status") as "publish" | "future" | "draft";
  const scheduledDateRaw = formData.get("scheduled_date") as string | null;
  const timezone = formData.get("timezone") as string | null;
  const scheduledDate = scheduledDateRaw
    ? toISOWithTimezone(scheduledDateRaw, timezone)
    : null;

  // Validate
  const errors: Record<string, string[]> = {};
  if (!showId) errors.show = ["Please select a show."];
  if (!reactionType) errors.reaction_type = ["Please select a content type."];
  if (!title?.trim()) errors.title = ["Title is required."];
  if (!youtubeVideoId?.trim()) errors.youtube_video_id = ["YouTube Video ID is required."];
  if (status === "future" && !scheduledDate) {
    errors.scheduled_date = ["Please select a scheduled date."];
  }

  if (Object.keys(errors).length > 0) {
    return { success: false, message: "Please fix the errors below.", errors };
  }

  try {
    // Upload thumbnail if file provided
    let featuredMediaId: number | undefined;
    if (thumbnailFile && thumbnailFile.size > 0) {
      const media = await uploadMedia(thumbnailFile);
      featuredMediaId = media.id;
    }

    const payload = {
      title: title.trim(),
      status: status || "publish",
      ...(status === "future" && scheduledDate ? { date: scheduledDate } : {}),
      ...(featuredMediaId ? { featured_media: featuredMediaId } : {}),
      meta: {
        _swm_portal_user_id: session.user.id,
        _swm_portal_submission: true,
        _swm_reaction_type: reactionType,
        parent_show_id: parseInt(showId, 10),
        youtube_video_id: youtubeVideoId.trim(),
        ...(teamsCovered?.trim() ? { teams_covered: teamsCovered.trim() } : {}),
        ...(gameWindow?.trim() ? { game_window: gameWindow.trim() } : {}),
        ...(thumbnailUrl?.trim() && !featuredMediaId ? { thumbnail_url: thumbnailUrl.trim() } : {}),
      },
    };

    const post = await createPost(ContentType.REACTION, payload);

    await db.activityLog.create({
      data: {
        userId: session.user.id,
        action: "create",
        contentType: ContentType.REACTION,
        wpPostId: post.id,
        wpShowId: parseInt(showId, 10),
        details: `Created ${reactionType === "nation_preview" ? "nation preview" : "reaction"}: "${title.trim()}"`,
      },
    });

    return {
      success: true,
      message: `${reactionType === "nation_preview" ? "Nation Preview" : "Reaction"} "${title.trim()}" ${status === "draft" ? "saved as draft" : status === "future" ? "scheduled" : "published"} successfully.`,
    };
  } catch (error) {
    if (error instanceof WpApiError) {
      return { success: false, message: `WordPress error: ${error.message}` };
    }
    console.error("Reaction submission error:", error);
    return { success: false, message: "An unexpected error occurred. Please try again." };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/dashboard/reaction/actions.ts
git commit -m "feat: add submitReaction server action"
```

---

### Task 3: Create Reaction Form Component

**Files:**
- Create: `src/components/forms/reaction-form.tsx`

- [ ] **Step 1: Create the ReactionForm component**

Create `src/components/forms/reaction-form.tsx`:

```tsx
"use client";

import { useState } from "react";
import { FormShell } from "@/components/forms/form-shell";
import { ShowSelect } from "@/components/forms/show-select";
import { ImageInput } from "@/components/forms/image-input";
import { PublishToggle, type PublishState } from "@/components/forms/publish-toggle";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { submitReaction } from "@/app/dashboard/reaction/actions";

interface Show {
  id: string;
  title: string;
}

interface ReactionFormProps {
  shows: Show[];
  defaultShowId?: string;
}

export function ReactionForm({ shows, defaultShowId }: ReactionFormProps) {
  const [showId, setShowId] = useState(defaultShowId ?? "");
  const [reactionType, setReactionType] = useState("reaction");
  const [thumbnail, setThumbnail] = useState<File | string | null>(null);
  const [publishState, setPublishState] = useState<PublishState>({
    status: "publish",
  });

  return (
    <FormShell
      title="Submit a Reaction"
      action={submitReaction}
      submitLabel="Publish Reaction"
    >
      {/* Content Type */}
      <div className="space-y-2">
        <Label>
          Content Type<span className="text-destructive"> *</span>
        </Label>
        <Select
          name="reaction_type"
          value={reactionType}
          onValueChange={setReactionType}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select content type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="reaction">Reaction</SelectItem>
            <SelectItem value="nation_preview">Nation Preview</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Show */}
      <ShowSelect
        allowedShows={shows}
        value={showId}
        onValueChange={setShowId}
      />

      {/* Title */}
      <div className="space-y-2">
        <Label htmlFor="title">
          Title<span className="text-destructive"> *</span>
        </Label>
        <Input
          id="title"
          name="title"
          type="text"
          placeholder="Enter a title"
          required
        />
      </div>

      {/* YouTube Video ID */}
      <div className="space-y-2">
        <Label htmlFor="youtube_video_id">
          YouTube Video ID<span className="text-destructive"> *</span>
        </Label>
        <Input
          id="youtube_video_id"
          name="youtube_video_id"
          type="text"
          placeholder="e.g., dQw4w9WgXcQ"
          required
        />
      </div>

      {/* Thumbnail */}
      <ImageInput
        name="thumbnail"
        label="Thumbnail"
        value={thumbnail}
        onChange={setThumbnail}
      />

      {/* Teams Covered */}
      <div className="space-y-2">
        <Label htmlFor="teams_covered">Teams Covered</Label>
        <Input
          id="teams_covered"
          name="teams_covered"
          type="text"
          placeholder="e.g., Dallas Cowboys vs Philadelphia Eagles"
        />
      </div>

      {/* Game Window */}
      <div className="space-y-2">
        <Label htmlFor="game_window">Game Window</Label>
        <Input
          id="game_window"
          name="game_window"
          type="text"
          placeholder="e.g., Week 12, March 15 2026"
        />
      </div>

      {/* Publish Toggle */}
      <PublishToggle value={publishState} onChange={setPublishState} />
    </FormShell>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/forms/reaction-form.tsx
git commit -m "feat: add ReactionForm component with content type and show dropdowns"
```

---

### Task 4: Create Reaction Page

**Files:**
- Create: `src/app/dashboard/reaction/page.tsx`

- [ ] **Step 1: Create the page**

Create `src/app/dashboard/reaction/page.tsx`:

```tsx
import { requireContentTypeAccess } from "@/lib/auth-guard";
import { getCachedShows } from "@/lib/wordpress/cache";
import { db } from "@/lib/db";
import { ContentType } from "@/lib/constants";
import { ReactionForm } from "@/components/forms/reaction-form";

export default async function ReactionPage() {
  const session = await requireContentTypeAccess(ContentType.REACTION);

  const allShows = await getCachedShows().catch(() => []);

  let allowedShows;
  if (session.user.role === "admin") {
    allowedShows = allShows;
  } else {
    const userShowAccess = await db.userShowAccess.findMany({
      where: { userId: session.user.id },
      select: { wpShowId: true },
    });
    const allowedIds = new Set(userShowAccess.map((a) => a.wpShowId));
    allowedShows = allShows.filter((show) => allowedIds.has(show.id));
  }

  const shows = allowedShows.map((show) => ({
    id: String(show.id),
    title: show.title.rendered,
  }));

  // Default to "Sunset Soccer Club" if it exists
  const defaultShow = shows.find((s) =>
    s.title.toLowerCase().includes("sunset soccer")
  );

  return (
    <div className="py-6">
      <ReactionForm shows={shows} defaultShowId={defaultShow?.id} />
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

Expected: Build succeeds. The new `/dashboard/reaction` route appears in the route list.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/reaction/page.tsx
git commit -m "feat: add reaction page with auth guard and show filtering"
```

---

### Task 5: Build Verification

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

```bash
npm test
```

Expected: All existing tests pass.

- [ ] **Step 2: Run build**

```bash
npm run build
```

Expected: Build succeeds. Route `/dashboard/reaction` is listed.

- [ ] **Step 3: Final commit if fixes needed**

If build or tests required fixes:

```bash
git add -A
git commit -m "fix: resolve build issues for reaction form"
```
