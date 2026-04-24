# Fix AI Path Data Loss in Distribution Pipeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 4 bugs where the AI distribution path silently drops user-entered data (season/episode numbers, explicit flag, title edits, thumbnail changes) and eliminate redundant transcription.

**Architecture:** The AI path splits job creation (`startAiAnalysis` → `submitDistribution`) from finalization (`distributeAfterAi` → `updateDistribution`). The fix ensures both steps carry all fields. The form sends missing fields during initial creation AND `updateDistribution` accepts the full field set on finalization. The processor skips transcription when it already exists.

**Tech Stack:** Next.js server actions, React client components, Prisma, Vitest

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/app/dashboard/distribute/new/actions.ts` | Modify | Expand `updateDistribution` to accept title, seasonNumber, episodeNumber, explicit |
| `src/app/dashboard/distribute/new/distribution-form.tsx` | Modify | Send all fields in AI path's initial creation and finalization |
| `src/lib/jobs/processor.ts` | Modify | Skip transcription/AI when already done |
| `tests/app/distribute/actions.test.ts` | Modify | Add tests for `updateDistribution` and AI-path field passing |

---

### Task 1: Expand `updateDistribution` to Accept All Fields

**Files:**
- Modify: `src/app/dashboard/distribute/new/actions.ts:199-272`
- Modify: `tests/app/distribute/actions.test.ts`

- [ ] **Step 1: Write failing tests for `updateDistribution`**

Add these tests to `tests/app/distribute/actions.test.ts`. First, update the mock setup to support `updateDistribution`:

```ts
// Add to the vi.hoisted block (line 4):
const { mockCreate, mockCreateMany, mockActivityCreate, mockFindUnique,
  mockJobFindUnique, mockJobUpdate, mockPlatformDeleteMany, mockPlatformCreateMany,
} = vi.hoisted(() => ({
  mockCreate: vi.fn().mockResolvedValue({ id: "job-1" }),
  mockCreateMany: vi.fn().mockResolvedValue({}),
  mockActivityCreate: vi.fn().mockResolvedValue({}),
  mockFindUnique: vi.fn(),
  mockJobFindUnique: vi.fn(),
  mockJobUpdate: vi.fn().mockResolvedValue({}),
  mockPlatformDeleteMany: vi.fn().mockResolvedValue({}),
  mockPlatformCreateMany: vi.fn().mockResolvedValue({}),
}));
```

Update the db mock to add `distributionJob` methods at the top level (outside `$transaction`):

```ts
vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(async (fn: any) =>
      fn({
        distributionJob: { create: mockCreate, update: mockJobUpdate },
        distributionJobPlatform: {
          createMany: mockCreateMany,
          deleteMany: mockPlatformDeleteMany,
        },
        activityLog: { create: mockActivityCreate },
      })
    ),
    userShowAccess: { findUnique: mockFindUnique },
    distributionJob: { findUnique: mockJobFindUnique },
  },
}));
```

Update the import to include `updateDistribution`:

```ts
import {
  submitDistribution,
  updateDistribution,
} from "@/app/dashboard/distribute/new/actions";
```

Add a new `describe` block after the existing one:

```ts
describe("updateDistribution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockJobFindUnique.mockResolvedValue({
      id: "job-1",
      userId: "user-1",
      metadata: {
        description: "old description",
        thumbnailGcsPath: "thumb.jpg",
      },
    });
  });

  it("updates title on the job record", async () => {
    const result = await updateDistribution("job-1", {
      title: "Updated Title",
      description: "new desc",
      platforms: ["youtube", "transistor"],
    });
    expect(result.success).toBe(true);
    // Check that $transaction was called and the update includes title
    const txFn = (vi.mocked(await import("@/lib/db")).db.$transaction as any)
      .mock.calls[0][0];
    // The transaction function receives a tx object — check mockJobUpdate
    expect(mockJobUpdate).toHaveBeenCalled();
    const updateArgs = mockJobUpdate.mock.calls[0][0];
    expect(updateArgs.data.title).toBe("Updated Title");
  });

  it("updates seasonNumber and episodeNumber in metadata", async () => {
    await updateDistribution("job-1", {
      description: "desc",
      platforms: ["youtube"],
      seasonNumber: 3,
      episodeNumber: 42,
    });
    const updateArgs = mockJobUpdate.mock.calls[0][0];
    expect(updateArgs.data.metadata.seasonNumber).toBe(3);
    expect(updateArgs.data.metadata.episodeNumber).toBe(42);
  });

  it("updates explicit flag in metadata", async () => {
    await updateDistribution("job-1", {
      description: "desc",
      platforms: ["youtube"],
      explicit: true,
    });
    const updateArgs = mockJobUpdate.mock.calls[0][0];
    expect(updateArgs.data.metadata.explicit).toBe(true);
  });

  it("preserves existing metadata fields not being updated", async () => {
    await updateDistribution("job-1", {
      description: "new desc",
      platforms: ["youtube"],
    });
    const updateArgs = mockJobUpdate.mock.calls[0][0];
    expect(updateArgs.data.metadata.thumbnailGcsPath).toBe("thumb.jpg");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/app/distribute/actions.test.ts`
Expected: New tests fail — `updateDistribution` doesn't accept `title`, `seasonNumber`, `episodeNumber`, `explicit`.

- [ ] **Step 3: Update `updateDistribution` to accept and persist all fields**

In `src/app/dashboard/distribute/new/actions.ts`, update the function signature and body:

```ts
export async function updateDistribution(
  jobId: string,
  data: {
    title?: string;
    description: string;
    chapters?: string;
    tags?: string[];
    platforms: string[];
    isDraft?: boolean;
    scheduleMode?: string;
    scheduledAt?: string | null;
    timezone?: string | null;
    seasonNumber?: number;
    episodeNumber?: number;
    explicit?: boolean;
  }
): Promise<FormState> {
```

Update the `$transaction` body to update `job.title` when provided and include the new metadata fields:

```ts
  await db.$transaction(async (tx) => {
    // Build the job update — always update metadata, optionally update title
    const jobUpdate: Record<string, unknown> = {
      metadata: {
        ...existingMetadata,
        description: data.description,
        ...(data.chapters !== undefined ? { chapters: data.chapters } : {}),
        ...(data.tags ? { tags: data.tags } : {}),
        isDraft: data.isDraft ?? false,
        scheduleMode: data.scheduleMode ?? "now",
        scheduledAt:
          data.scheduledAt && data.scheduleMode === "schedule"
            ? toISOWithTimezone(data.scheduledAt, data.timezone)
            : (data.scheduledAt ?? null),
        ...(data.seasonNumber !== undefined
          ? { seasonNumber: data.seasonNumber }
          : {}),
        ...(data.episodeNumber !== undefined
          ? { episodeNumber: data.episodeNumber }
          : {}),
        ...(data.explicit !== undefined ? { explicit: data.explicit } : {}),
      },
    };

    if (data.title) {
      jobUpdate.title = data.title;
    }

    await tx.distributionJob.update({
      where: { id: jobId },
      data: jobUpdate,
    });

    // Replace platform records with the user's final selection
    await tx.distributionJobPlatform.deleteMany({
      where: { jobId },
    });

    const validPlatforms = VALID_PLATFORMS.filter((p) =>
      data.platforms.includes(p)
    );
    if (validPlatforms.length > 0) {
      await tx.distributionJobPlatform.createMany({
        data: validPlatforms.map((platform) => ({
          jobId,
          platform,
          status: "queued" as const,
        })),
      });
    }
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/app/distribute/actions.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/distribute/new/actions.ts tests/app/distribute/actions.test.ts
git commit -m "fix: expand updateDistribution to accept title, season/episode numbers, explicit flag"
```

---

### Task 2: Send All Fields in AI Path Form

**Files:**
- Modify: `src/app/dashboard/distribute/new/distribution-form.tsx:268-496`

- [ ] **Step 1: Fix `startAiAnalysis` to include season/episode/explicit in initial job creation**

In `distribution-form.tsx`, update the `startAiAnalysis` function's FormData construction (around line 280). Replace:

```ts
      const fd = new FormData();
      fd.set("show_id", showId);
      fd.set("title", title);
      fd.set("description", "AI-generated description pending");
      fd.set("platform_youtube", "on");
      if (publishState.status === "draft") fd.set("status", "draft");
```

With:

```ts
      const fd = new FormData();
      fd.set("show_id", showId);
      fd.set("title", title);
      fd.set("description", "AI-generated description pending");
      fd.set("platform_youtube", "on");
      if (publishState.status === "draft") fd.set("status", "draft");
      if (seasonNumber) fd.set("season_number", seasonNumber);
      if (episodeNumber) fd.set("episode_number", episodeNumber);
      // Read explicit checkbox directly from the form
      if (formRef.current) {
        const explicitCheckbox = formRef.current.querySelector<HTMLInputElement>('#explicit');
        if (explicitCheckbox?.checked) fd.set("explicit", "true");
      }
```

- [ ] **Step 2: Fix `distributeAfterAi` to send all fields to `updateDistribution`**

In `distribution-form.tsx`, update the `distributeAfterAi` function (around line 463). Replace:

```ts
      // Update job with final description, chapters, platforms
      const updateResult = await updateDistribution(aiUploadedJobId, {
        description: description.trim(),
        chapters: chapters.trim() || undefined,
        tags,
        platforms: selectedPlatforms,
        isDraft: publishState.status === "draft",
        scheduleMode: publishState.status === "future" ? "schedule" : "now",
        scheduledAt: publishState.status === "future" ? publishState.date ?? null : null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
```

With:

```ts
      // Update job with ALL fields — title may have been edited, and season/episode/explicit
      // need to be sent since the initial AI job creation may not have had final values
      const updateResult = await updateDistribution(aiUploadedJobId, {
        title: title.trim(),
        description: description.trim(),
        chapters: chapters.trim() || undefined,
        tags,
        platforms: selectedPlatforms,
        isDraft: publishState.status === "draft",
        scheduleMode: publishState.status === "future" ? "schedule" : "now",
        scheduledAt: publishState.status === "future" ? publishState.date ?? null : null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        seasonNumber: seasonNumber ? parseInt(seasonNumber, 10) : undefined,
        episodeNumber: episodeNumber ? parseInt(episodeNumber, 10) : undefined,
        explicit: fd.get("explicit") === "true",
      });
```

Wait — `fd` is a local inside `distributeAfterAi`. The explicit checkbox needs to be read from the form. Update to:

```ts
      // Read explicit checkbox from the form
      const explicitChecked = fd.get("explicit") === "on"
        || formRef.current?.querySelector<HTMLInputElement>('#explicit')?.checked
        || false;

      const updateResult = await updateDistribution(aiUploadedJobId, {
        title: title.trim(),
        description: description.trim(),
        chapters: chapters.trim() || undefined,
        tags,
        platforms: selectedPlatforms,
        isDraft: publishState.status === "draft",
        scheduleMode: publishState.status === "future" ? "schedule" : "now",
        scheduledAt: publishState.status === "future" ? publishState.date ?? null : null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        seasonNumber: seasonNumber ? parseInt(seasonNumber, 10) : undefined,
        episodeNumber: episodeNumber ? parseInt(episodeNumber, 10) : undefined,
        explicit: explicitChecked,
      });
```

Note: The explicit checkbox (line 844) uses `name="explicit" value="true"` with a native `<input type="checkbox">`, not the shadcn Checkbox. `FormData.get("explicit")` returns `"true"` when checked (because `value="true"`) or `null` when unchecked. So reading from the FormData `fd` created at line 447 is the cleanest approach:

```ts
      const explicitChecked = fd.get("explicit") === "true";

      const updateResult = await updateDistribution(aiUploadedJobId, {
        title: title.trim(),
        description: description.trim(),
        chapters: chapters.trim() || undefined,
        tags,
        platforms: selectedPlatforms,
        isDraft: publishState.status === "draft",
        scheduleMode: publishState.status === "future" ? "schedule" : "now",
        scheduledAt: publishState.status === "future" ? publishState.date ?? null : null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        seasonNumber: seasonNumber ? parseInt(seasonNumber, 10) : undefined,
        episodeNumber: episodeNumber ? parseInt(episodeNumber, 10) : undefined,
        explicit: explicitChecked,
      });
```

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/distribute/new/distribution-form.tsx
git commit -m "fix: send all fields (title, season/episode, explicit) in AI distribution path"
```

---

### Task 3: Re-upload Thumbnail if Changed After AI Analysis

**Files:**
- Modify: `src/app/dashboard/distribute/new/distribution-form.tsx:439-496`

- [ ] **Step 1: Add state to track whether thumbnail was already uploaded**

Add a ref to track the filename that was uploaded during AI analysis. Near the existing `thumbnailFileRef` (line 106):

```ts
  const thumbnailUploadedNameRef = useRef<string | null>(null);
```

- [ ] **Step 2: Record the uploaded thumbnail name during `startAiAnalysis`**

In `startAiAnalysis`, after the upload call (around line 306), record what was uploaded. Replace:

```ts
      if (videoSource === "upload") {
        setAnalysisStep("Uploading video...");
        await Promise.all([
          uploadVideoToGCS(jobId),
          uploadThumbnailToGCS(jobId),
        ]);
      } else {
        await uploadThumbnailToGCS(jobId);
      }
```

With:

```ts
      if (videoSource === "upload") {
        setAnalysisStep("Uploading video...");
        await Promise.all([
          uploadVideoToGCS(jobId),
          uploadThumbnailToGCS(jobId),
        ]);
      } else {
        await uploadThumbnailToGCS(jobId);
      }
      // Track which thumbnail file was uploaded so we can detect changes later
      thumbnailUploadedNameRef.current = thumbnailFileRef.current?.name ?? null;
```

- [ ] **Step 3: Re-upload thumbnail in `distributeAfterAi` if it changed**

In `distributeAfterAi`, before the `updateDistribution` call (around line 462), add:

```ts
      // Re-upload thumbnail if the user selected a new one after AI analysis
      const currentThumbName = thumbnailFileRef.current?.name ?? null;
      if (currentThumbName !== thumbnailUploadedNameRef.current) {
        await uploadThumbnailToGCS(aiUploadedJobId);
      }
```

- [ ] **Step 4: Reset the uploaded name ref when clearing AI state**

In the video source toggle handlers (around lines 660-700) and the video file onChange handler (line 730), where `setAiUploadedJobId(null)` is called, also reset:

```ts
thumbnailUploadedNameRef.current = null;
```

There are 3 places where AI state is reset:
1. Upload button click (line 660): add `thumbnailUploadedNameRef.current = null;`
2. YouTube button click (line 680): add `thumbnailUploadedNameRef.current = null;`
3. Video file onChange (line 730): add `thumbnailUploadedNameRef.current = null;`

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/distribute/new/distribution-form.tsx
git commit -m "fix: re-upload thumbnail if changed after AI analysis completes"
```

---

### Task 4: Skip Redundant Transcription in Processor

**Files:**
- Modify: `src/lib/jobs/processor.ts:200-239`

- [ ] **Step 1: Add check for existing transcript in processor**

In `processor.ts`, the transcription block starts at line 200:

```ts
  // --- Transcription + AI Processing ---
  let transcript: string | null = null;
  if (gcsAudioPath) {
```

Replace lines 200-239 with:

```ts
  // --- Transcription + AI Processing ---
  // Skip if the AI analysis endpoint already transcribed (AI path).
  // Check for existing transcript in metadata — the analyze endpoint stores it there.
  let transcript: string | null = null;
  const existingTranscript = (updatedMetadata.transcript as string) ?? null;

  if (existingTranscript) {
    console.log("[processor] Transcript already exists (AI path) — skipping re-transcription");
    transcript = (updatedMetadata.transcriptDisplay as string) ?? existingTranscript;
  } else if (gcsAudioPath) {
    try {
      console.log("[processor] Starting transcription...");
      const transcriptionResult = await transcribeAudio(gcsAudioPath);
      const formattedTranscript = formatTranscriptForAI(transcriptionResult.segments);
      const displayTranscript = formatTranscriptForDisplay(transcriptionResult.segments);
      transcript = displayTranscript;

      // Store transcript in job metadata
      const currentMetadata = job.metadata as Record<string, unknown>;
      await db.distributionJob.update({
        where: { id: job.id },
        data: {
          metadata: {
            ...currentMetadata,
            transcript: transcriptionResult.fullText,
            transcriptDisplay: displayTranscript,
            transcriptTimestamped: formattedTranscript,
            detectedLanguage: transcriptionResult.language,
            audioDuration: transcriptionResult.duration,
          },
        },
      });

      // Generate AI suggestions from transcript
      console.log("[processor] Generating AI suggestions...");
      await generateAiSuggestions(job.id, formattedTranscript, transcriptionResult.language);
      console.log("[processor] AI suggestions complete.");
    } catch (error) {
      console.error("[processor] Transcription/AI processing failed (non-fatal):", error);
      try {
        await generateAiSuggestions(job.id);
      } catch (aiErr) {
        console.error("[processor] AI suggestions also failed:", aiErr);
      }
    }
  }
```

Note: `updatedMetadata` is already defined at line 247, but we need it earlier. However, at line 200, we're before the metadata refresh. The initial `metadata` (line 140) was fetched at processor start — after `updateDistribution` ran — so it already has the transcript from the analyze endpoint. Use `metadata` instead:

Actually, looking at the code again: `metadata` at line 140 is from `job.metadata` which is from the `findUnique` at line 43. This is the freshest version at processor start. The analyze endpoint stores transcript in metadata, and `updateDistribution` spreads over it, preserving transcript fields. So `metadata.transcript` exists if the AI path ran.

Update the check to use `metadata` instead of `updatedMetadata`:

```ts
  const existingTranscript = (metadata.transcript as string) ?? null;
```

- [ ] **Step 2: Verify the metadata refresh still works**

The metadata refresh at line 243-247 happens after this block. In the AI path (skip branch), no metadata update happens, so the refresh just re-reads the same data — correct. In the manual path, the transcription branch runs and updates metadata, then the refresh picks up the new transcript data — also correct.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All tests pass. No tests directly exercise the processor's transcription skip, but existing tests should not regress.

- [ ] **Step 4: Commit**

```bash
git add src/lib/jobs/processor.ts
git commit -m "perf: skip redundant transcription when AI analysis already ran"
```

---

### Task 5: Fix Stale Metadata in YouTube Upload Phase

**Files:**
- Modify: `src/lib/jobs/processor.ts:307-309`

This is a latent bug: the YouTube phase reads `metadata` (line 307) but Transistor/WordPress read `updatedMetadata` (line 507+). For the manual path this doesn't matter (they're the same). But for correctness, YouTube should also read the freshest metadata.

- [ ] **Step 1: Move the metadata refresh before Phase 1**

In `processor.ts`, the metadata refresh currently happens at lines 243-247 (after transcription). Move it so it happens earlier — right after the transcription/AI block but before Phase 1 begins. The current code already does this, so no change needed there.

However, the YouTube upload phase (starting at line 296) reads from `metadata` (line 307):

```ts
      const description = (metadata.description as string) ?? "";
      const chapters = (metadata.chapters as string) ?? "";
```

Change these to read from `updatedMetadata`:

```ts
      const description = (updatedMetadata.description as string) ?? "";
      const chapters = (updatedMetadata.chapters as string) ?? "";
      const tags = (updatedMetadata.tags as string[]) ?? [];
      const isDraft = (updatedMetadata.isDraft as boolean) ?? false;
      const scheduleMode = (updatedMetadata.scheduleMode as string) ?? "now";
```

Also update the thumbnail read on line 343:

```ts
      const thumbnailGcsPath = updatedMetadata.thumbnailGcsPath as string | undefined;
```

This ensures YouTube reads the same fresh metadata that Transistor and WordPress use.

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/jobs/processor.ts
git commit -m "fix: use refreshed metadata for YouTube upload phase"
```

---

### Task 6: Verify on Staging

- [ ] **Step 1: Push to main for staging deployment**

```bash
git push origin main
```

- [ ] **Step 2: Test AI path with all fields**

On staging, create a distribution using the AI path:
1. Select a show (verify episode/season numbers auto-populate)
2. Upload a video file
3. Upload a thumbnail BEFORE clicking AI
4. Check "explicit content"
5. Click "Get AI recommendations"
6. After AI completes, verify episode/season numbers are still visible
7. Change the title
8. Change the thumbnail to a different image
9. Click "Distribute Now"
10. Check the job detail page — verify title, thumbnail, season/episode numbers, and explicit flag are all correct on each platform

- [ ] **Step 3: Test AI path without initial thumbnail**

1. Start a new distribution via AI path WITHOUT uploading a thumbnail first
2. After AI completes, drop in a thumbnail
3. Distribute
4. Verify the thumbnail appears on all platforms

- [ ] **Step 4: Test manual path still works**

1. Create a distribution using the manual path
2. Verify all fields (title, description, thumbnail, season/episode, explicit) make it to platforms
