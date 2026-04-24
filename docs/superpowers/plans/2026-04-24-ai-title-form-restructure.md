# AI Title Generation & Distribution Form Restructure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the distribution form so the AI path suggests title, episode/season numbers alongside description/chapters/tags, and auto-fetch YouTube thumbnails when a YouTube URL is provided.

**Architecture:** The form flow changes from "enter metadata → choose path" to "provide video → choose path → review all fields." A new `"title"` AI suggestion type is added alongside the existing summary/chapters/keywords types. The analyze endpoint gains a `getRecentEpisodeTitles()` call to provide show-specific title history to the prompt. YouTube thumbnails are previewed client-side via `<img>` and fetched server-side during GCS upload.

**Tech Stack:** Next.js server actions, React client components, Anthropic Claude API, WordPress REST API, Vitest

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/lib/wordpress/client.ts` | Add function | `getRecentEpisodeTitles()` — fetch last 10 episode titles for a show |
| `src/lib/jobs/ai-processor.ts` | Add type + prompt | `"title"` suggestion type, `buildTitlePrompt()` |
| `src/app/api/distribute/analyze/route.ts` | Modify | Return episode/season numbers, include title in suggestions |
| `src/app/dashboard/distribute/new/distribution-form.tsx` | Major restructure | Move fields below path choice, populate from AI, YouTube thumbnail preview |
| `src/app/dashboard/distribute/new/actions.ts` | Minor | Relax title validation for AI path, add show name lookup |
| `src/app/api/upload/thumbnail/route.ts` | Modify | Accept `youtubeVideoId` as fallback when no file uploaded |
| `tests/app/distribute/actions.test.ts` | Modify | Add test for AI path placeholder title |

---

### Task 1: Add `getRecentEpisodeTitles` to WordPress Client

**Files:**
- Modify: `src/lib/wordpress/client.ts:116-136`

- [ ] **Step 1: Add the `getRecentEpisodeTitles` function**

Add this function after the existing `getLatestEpisodeNumbers` function (after line 136) in `src/lib/wordpress/client.ts`:

```ts
/**
 * Get recent published episode titles for a show, used for AI title style matching.
 */
export async function getRecentEpisodeTitles(
  wpShowId: number,
  count: number = 10
): Promise<string[]> {
  try {
    const posts = await wpFetch<WpPost[]>(
      `/swm_episode?per_page=${count}&orderby=date&order=desc&status=publish&_fields=id,title&meta_key=parent_show_id&meta_value=${wpShowId}`
    );
    return posts.map((p) => decodeHtmlEntities(p.title.rendered));
  } catch {
    return [];
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/wordpress/client.ts
git commit -m "feat: add getRecentEpisodeTitles for AI title context"
```

---

### Task 2: Add "title" AI Suggestion Type

**Files:**
- Modify: `src/lib/jobs/ai-processor.ts:1-11` (type), `src/lib/jobs/ai-processor.ts:131-177` (prompt + generation)

- [ ] **Step 1: Update the `AiSuggestionType` union**

In `src/lib/jobs/ai-processor.ts`, line 4, change:

```ts
export type AiSuggestionType = "chapters" | "summary" | "blog" | "keywords";
```

To:

```ts
export type AiSuggestionType = "chapters" | "summary" | "blog" | "keywords" | "title";
```

- [ ] **Step 2: Add the `buildTitlePrompt` function**

Add this function after `buildKeywordsPrompt` (after line 131) in `src/lib/jobs/ai-processor.ts`:

```ts
function buildTitlePrompt(ctx: AnalysisContext, recentTitles: string[], showName?: string): string {
  const source = ctx.transcript
    ? `Transcript:\n${ctx.transcript}`
    : `Description: ${ctx.description ?? "N/A"}`;

  const titleExamples = recentTitles.length > 0
    ? `\nRecent episode titles from this show (match this style and voice):\n${recentTitles.map((t, i) => `${i + 1}. ${t}`).join("\n")}`
    : "";

  return [
    "You are helping a podcast producer title their new episode.",
    showName ? `The show is called "${showName}".` : "",
    "Generate a single episode title that:",
    "- Reflects the main topic or theme discussed in the episode",
    "- Matches the style, voice, and format of this show's previous titles",
    "- Is compelling and would make a listener want to click",
    "- Uses plain text only, no quotes or markdown",
    ctx.language === "es"
      ? "- Write the title in Spanish since the episode is in Spanish"
      : "",
    "",
    "Output ONLY the title. No preamble, no explanation, no quotes — just the title text.",
    titleExamples,
    "",
    source,
  ]
    .filter(Boolean)
    .join("\n");
}
```

- [ ] **Step 3: Update `AnalysisContext` to support `recentTitles`**

The `buildTitlePrompt` function takes `recentTitles` as a separate parameter (not part of `AnalysisContext`) since it's only used by the title prompt. No changes to the interface needed.

- [ ] **Step 4: Add title generation to `generateAiSuggestions`**

In `src/lib/jobs/ai-processor.ts`, update the function signature to accept `recentTitles`:

Change line 141:

```ts
export async function generateAiSuggestions(
  jobId: string,
  transcript?: string | null,
  language?: string | null,
  types?: AiSuggestionType[]
): Promise<void> {
```

To:

```ts
export async function generateAiSuggestions(
  jobId: string,
  transcript?: string | null,
  language?: string | null,
  types?: AiSuggestionType[],
  recentTitles?: string[],
  showName?: string
): Promise<void> {
```

Then in the suggestion config block (after line 189, where keywords is pushed), add:

```ts
  if (typesToGenerate.includes("title")) {
    suggestionConfigs.push({
      type: "title",
      prompt: buildTitlePrompt(ctx, recentTitles ?? [], showName),
    });
  }
```

- [ ] **Step 5: Update the default types array**

Change line 177:

```ts
  const typesToGenerate = types ?? ["chapters", "summary", "blog", "keywords"];
```

To:

```ts
  const typesToGenerate = types ?? ["chapters", "summary", "blog", "keywords", "title"];
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/jobs/ai-processor.ts
git commit -m "feat: add title AI suggestion type with show history context"
```

---

### Task 3: Update Analyze Endpoint to Return Title + Episode/Season

**Files:**
- Modify: `src/app/api/distribute/analyze/route.ts`

- [ ] **Step 1: Add imports**

In `src/app/api/distribute/analyze/route.ts`, add to the imports at the top:

```ts
import { getRecentEpisodeTitles, getLatestEpisodeNumbers, getShow } from "@/lib/wordpress/client";
```

- [ ] **Step 2: Fetch episode context and pass to AI**

After the job lookup (line 37-44), add fetching of show context. Replace the AI suggestions block (lines 91-97) with:

```ts
    // 3. Fetch show context for title generation
    const [recentTitles, epNumbers, show] = await Promise.all([
      getRecentEpisodeTitles(job.wpShowId),
      getLatestEpisodeNumbers(job.wpShowId),
      getShow(job.wpShowId).catch(() => null),
    ]);
    const nextEpisodeNumber = epNumbers.episodeNumber != null ? epNumbers.episodeNumber + 1 : null;
    const seasonNumber = epNumbers.seasonNumber;
    const showName = show?.title.rendered ?? undefined;

    // 4. Generate AI suggestions (including title)
    console.log(`[analyze] Generating AI suggestions for job ${jobId}`);
    await generateAiSuggestions(
      jobId,
      formattedTranscript,
      transcription.language,
      undefined,
      recentTitles,
      showName
    );
```

Note: We need to add `wpShowId` to the job select. Update line 39:

```ts
    select: { id: true, userId: true, gcsPath: true, title: true, metadata: true, wpShowId: true },
```

- [ ] **Step 3: Add episode/season to the response**

Update the response (lines 105-111) to include episode/season:

```ts
    return NextResponse.json({
      success: true,
      transcript: transcription.fullText,
      language: transcription.language,
      duration: transcription.duration,
      suggestions,
      episodeNumber: nextEpisodeNumber,
      seasonNumber,
    });
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/distribute/analyze/route.ts
git commit -m "feat: return AI title suggestion and episode/season from analyze endpoint"
```

---

### Task 4: Update Thumbnail Upload to Support YouTube Fallback

**Files:**
- Modify: `src/app/api/upload/thumbnail/route.ts`

- [ ] **Step 1: Add YouTube thumbnail fetch fallback**

In `src/app/api/upload/thumbnail/route.ts`, update the handler to accept a `youtubeVideoId` field as a fallback when no file is uploaded. Replace lines 22-31:

```ts
  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const jobId = formData.get("jobId") as string | null;

  if (!file || !jobId) {
    return NextResponse.json(
      { error: "Missing file or jobId." },
      { status: 400 }
    );
  }
```

With:

```ts
  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const jobId = formData.get("jobId") as string | null;
  const youtubeVideoId = formData.get("youtubeVideoId") as string | null;

  if (!jobId) {
    return NextResponse.json(
      { error: "Missing jobId." },
      { status: 400 }
    );
  }

  if (!file && !youtubeVideoId) {
    return NextResponse.json(
      { error: "Missing file or youtubeVideoId." },
      { status: 400 }
    );
  }
```

- [ ] **Step 2: Add YouTube thumbnail fetch logic**

After the job ownership check (after line 65), replace the try/catch block (lines 67-89) with:

```ts
  try {
    let buffer: Buffer;
    let contentType: string;
    let filename: string;

    if (file) {
      // Standard file upload path
      if (!ALLOWED_TYPES.includes(file.type)) {
        return NextResponse.json(
          { error: `Unsupported image type: ${file.type}` },
          { status: 400 }
        );
      }
      if (file.size > MAX_SIZE) {
        return NextResponse.json(
          { error: "Image exceeds 15 MB limit." },
          { status: 400 }
        );
      }
      buffer = Buffer.from(await file.arrayBuffer());
      contentType = file.type;
      filename = file.name;
    } else {
      // YouTube thumbnail fallback — fetch server-side to avoid CORS
      const urls = [
        `https://img.youtube.com/vi/${youtubeVideoId}/maxresdefault.jpg`,
        `https://img.youtube.com/vi/${youtubeVideoId}/hqdefault.jpg`,
      ];

      let fetched = false;
      for (const url of urls) {
        const res = await fetch(url);
        if (res.ok) {
          buffer = Buffer.from(await res.arrayBuffer());
          contentType = "image/jpeg";
          filename = `youtube-${youtubeVideoId}.jpg`;
          fetched = true;
          break;
        }
      }

      if (!fetched!) {
        return NextResponse.json(
          { error: "Could not fetch YouTube thumbnail." },
          { status: 400 }
        );
      }
    }

    const gcsPath = await uploadBuffer(filename!, buffer!, contentType!);

    // Store thumbnail path in job metadata
    const existingMetadata = (job.metadata as Record<string, unknown>) ?? {};
    await db.distributionJob.update({
      where: { id: jobId },
      data: {
        metadata: { ...existingMetadata, thumbnailGcsPath: gcsPath },
      },
    });

    console.log(`[thumbnail] Uploaded to GCS: ${gcsPath}`);

    return NextResponse.json({ gcsPath });
  } catch (error) {
    console.error("[thumbnail] Upload failed:", error);
    return NextResponse.json(
      { error: "Failed to upload thumbnail." },
      { status: 500 }
    );
  }
```

- [ ] **Step 3: Move the file type/size validation**

Note: The ALLOWED_TYPES and MAX_SIZE checks were previously before the job lookup. In the new code they are inside the `if (file)` branch of the try block. Remove the old validation checks from lines 33-45 since they've been moved into the try block.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/upload/thumbnail/route.ts
git commit -m "feat: support YouTube thumbnail fallback in thumbnail upload endpoint"
```

---

### Task 5: Update `submitDistribution` for AI Path Placeholder Title

**Files:**
- Modify: `src/app/dashboard/distribute/new/actions.ts:64-76`
- Modify: `tests/app/distribute/actions.test.ts`

- [ ] **Step 1: Write a failing test for AI path placeholder title**

Add this test to the `submitDistribution` describe block in `tests/app/distribute/actions.test.ts`:

```ts
  it("accepts a placeholder title for AI path (description not required)", async () => {
    const fd = makeFormData({
      show_id: "42",
      title: "AI analysis in progress",
      description: "AI-generated description pending",
      platform_youtube: "on",
      video_file_name: "episode.mp4",
      video_file_size: "1000000",
      video_content_type: "video/mp4",
    });
    const result = await submitDistribution({}, fd);
    expect(result.success).toBe(true);
  });
```

- [ ] **Step 2: Run tests to verify the test passes**

Run: `npm test -- tests/app/distribute/actions.test.ts`

This should already pass since the placeholder values satisfy existing validation. But confirm it works.

- [ ] **Step 3: Commit**

```bash
git add tests/app/distribute/actions.test.ts
git commit -m "test: add AI path placeholder title test case"
```

---

### Task 6: Restructure Distribution Form — Move Fields Below Path Choice

This is the largest task. It restructures the form JSX so title, season/episode, and explicit appear after the AI/manual choice rather than before it.

**Files:**
- Modify: `src/app/dashboard/distribute/new/distribution-form.tsx`

- [ ] **Step 1: Update the `AiSuggestion` interface**

In `distribution-form.tsx`, line 58, update the type to include `"title"`:

```ts
interface AiSuggestion {
  id: string;
  type: "chapters" | "summary" | "blog" | "keywords" | "title";
  content: string;
  accepted: boolean;
}
```

- [ ] **Step 2: Add YouTube thumbnail preview state**

After line 109 (`const [youtubeUrlInput, setYoutubeUrlInput] = useState("");`), add:

```ts
  const [youtubeThumbUrl, setYoutubeThumbUrl] = useState<string | null>(null);
```

- [ ] **Step 3: Update `startAiAnalysis` — remove title/episode/season from initial job creation**

In `startAiAnalysis` (lines 281-291), the FormData construction currently includes title, season, episode, and explicit. Since these fields no longer exist above the AI choice, we need to use placeholders. Replace lines 281-291:

```ts
      const fd = new FormData();
      fd.set("show_id", showId);
      fd.set("title", title);
      fd.set("description", "AI-generated description pending");
      fd.set("platform_youtube", "on");
      if (publishState.status === "draft") fd.set("status", "draft");
      if (seasonNumber) fd.set("season_number", seasonNumber);
      if (episodeNumber) fd.set("episode_number", episodeNumber);
      // Read explicit checkbox from the form
      const explicitCheckbox = formRef.current?.querySelector<HTMLInputElement>('#explicit');
      if (explicitCheckbox?.checked) fd.set("explicit", "true");
```

With:

```ts
      // Use placeholder title — real title comes from AI suggestions
      const showName = shows.find((s) => s.id === showId)?.title ?? "Episode";
      const fd = new FormData();
      fd.set("show_id", showId);
      fd.set("title", `AI analysis in progress — ${showName}`);
      fd.set("description", "AI-generated description pending");
      fd.set("platform_youtube", "on");
      if (publishState.status === "draft") fd.set("status", "draft");
```

- [ ] **Step 4: Populate title and episode/season from analyze response**

In `startAiAnalysis`, after the suggestions are processed (after line 378 where `setSuggestedTags` is called), add title and episode/season population:

```ts
      // Populate AI-suggested title
      const titleSuggestion = aiSuggestions.find((s) => s.type === "title");
      if (titleSuggestion) {
        setTitle(titleSuggestion.content);
      }

      // Populate episode/season from analyze response (deterministic: last + 1)
      if (data.episodeNumber != null) {
        setEpisodeNumber(String(data.episodeNumber));
      }
      if (data.seasonNumber != null) {
        setSeasonNumber(String(data.seasonNumber));
      }
```

- [ ] **Step 5: Update the `startAiAnalysis` dependency array**

The dependency array at lines 391-405 needs `shows` added since we now reference it for the placeholder title. Add `shows` to the array.

- [ ] **Step 6: Update `uploadThumbnailToGCS` to support YouTube fallback**

Replace the `uploadThumbnailToGCS` callback (lines 141-158):

```ts
  const uploadThumbnailToGCS = useCallback(async (jobId: string) => {
    const file = thumbnailFileRef.current;

    const formData = new FormData();
    formData.append("jobId", jobId);

    if (file) {
      formData.append("file", file);
    } else if (videoSource === "youtube" && youtubeUrlInput) {
      // Fall back to YouTube thumbnail if no manual file uploaded
      const { extractYoutubeVideoId } = await import("@/lib/youtube-url");
      const videoId = extractYoutubeVideoId(youtubeUrlInput);
      if (videoId) {
        formData.append("youtubeVideoId", videoId);
      } else {
        return; // No thumbnail to upload
      }
    } else {
      return; // No thumbnail to upload
    }

    const res = await fetch("/api/upload/thumbnail", {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Upload failed" }));
      console.error("[thumbnail] Upload failed:", err.error);
    }
  }, [videoSource, youtubeUrlInput]);
```

- [ ] **Step 7: Update YouTube URL `onChange` to set thumbnail preview**

In the YouTube URL input onChange handler (line 782-791), add thumbnail preview logic. Replace:

```ts
              onChange={(e) => {
                  setYoutubeUrlInput(e.target.value);
                  if (aiUploadedJobId) {
                    setDescriptionMode(null);
                    setSuggestions([]);
                    setAiUploadedJobId(null);
                    thumbnailUploadedNameRef.current = null;
                    setTags(frequentTags[showId] ?? []);
                    setSuggestedTags([]);
                  }
                }}
```

With:

```ts
              onChange={(e) => {
                  const url = e.target.value;
                  setYoutubeUrlInput(url);
                  // Show YouTube thumbnail preview
                  const { extractYoutubeVideoId } = require("@/lib/youtube-url");
                  const videoId = extractYoutubeVideoId(url);
                  setYoutubeThumbUrl(
                    videoId ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` : null
                  );
                  if (aiUploadedJobId) {
                    setDescriptionMode(null);
                    setSuggestions([]);
                    setAiUploadedJobId(null);
                    thumbnailUploadedNameRef.current = null;
                    setTags(frequentTags[showId] ?? []);
                    setSuggestedTags([]);
                  }
                }}
```

Wait — `isValidYoutubeUrl` is already imported at line 44, and `extractYoutubeVideoId` is in the same module. Update the import at line 44:

```ts
import { isValidYoutubeUrl, extractYoutubeVideoId } from "@/lib/youtube-url";
```

Then use `extractYoutubeVideoId` directly (no require/import):

```ts
              onChange={(e) => {
                  const url = e.target.value;
                  setYoutubeUrlInput(url);
                  // Show YouTube thumbnail preview
                  const videoId = extractYoutubeVideoId(url);
                  setYoutubeThumbUrl(
                    videoId ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` : null
                  );
                  if (aiUploadedJobId) {
                    setDescriptionMode(null);
                    setSuggestions([]);
                    setAiUploadedJobId(null);
                    thumbnailUploadedNameRef.current = null;
                    setTags(frequentTags[showId] ?? []);
                    setSuggestedTags([]);
                  }
                }}
```

- [ ] **Step 8: Move form fields — remove title/episode/season/explicit from current position**

Delete lines 821-879 (the episode title input, season/episode number grid, and explicit checkbox). These will be re-added in the next step.

- [ ] **Step 9: Move thumbnail and add YouTube preview**

The thumbnail section currently lives at lines 881-913 (after the fields we just removed). Move it to right after the YouTube URL input section (after line 799), before the path choice. Also add a YouTube thumbnail preview. Replace the thumbnail section with:

```tsx
          {/* Thumbnail upload + YouTube preview */}
          {videoSourceReady && (
            <div className="space-y-2">
              <Label htmlFor="thumbnail">Thumbnail</Label>
              {/* YouTube thumbnail preview */}
              {youtubeThumbUrl && !thumbnailFileName && (
                <div className="space-y-1">
                  <img
                    src={youtubeThumbUrl}
                    alt="YouTube thumbnail"
                    className="w-full max-w-xs rounded-lg border"
                    onError={(e) => {
                      // Fall back to hqdefault if maxresdefault doesn't exist
                      const img = e.currentTarget;
                      if (img.src.includes("maxresdefault")) {
                        img.src = img.src.replace("maxresdefault", "hqdefault");
                      }
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    YouTube thumbnail (auto-detected). Upload below to override.
                  </p>
                </div>
              )}
              <label
                htmlFor="thumbnail"
                className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-input px-4 py-6 text-center transition-colors hover:border-primary/50 hover:bg-muted/30"
              >
                <UploadIcon className="size-6 text-muted-foreground" />
                {thumbnailFileName ? (
                  <span className="text-sm font-medium">
                    {thumbnailFileName}
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    {youtubeThumbUrl ? "Upload to override YouTube thumbnail" : "Upload episode thumbnail image"}
                  </span>
                )}
                <input
                  id="thumbnail"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  disabled={isDisabled}
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    thumbnailFileRef.current = file;
                    setThumbnailFileName(file?.name ?? null);
                  }}
                />
              </label>
            </div>
          )}
```

- [ ] **Step 10: Add metadata fields to the AI review section**

In the AI suggestions review block (line 971, `{descriptionMode === "ai" && suggestions.length > 0 && (`), add title, episode/season, and explicit fields at the TOP of the review section, before the description. After the opening `<div className="space-y-4">` on line 972, add:

```tsx
              {/* AI-suggested title */}
              <div className="space-y-2">
                <Label htmlFor="ai-title">
                  Episode Title{" "}
                  <span className="text-xs text-muted-foreground">
                    (AI-suggested, edit as needed)
                  </span>
                </Label>
                <Input
                  id="ai-title"
                  name="title"
                  disabled={isDisabled}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              {/* Season & Episode numbers */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="ai-season">Season Number</Label>
                  <Input
                    id="ai-season"
                    name="season_number"
                    type="number"
                    min={1}
                    placeholder="Optional"
                    disabled={isDisabled}
                    value={seasonNumber}
                    onChange={(e) => setSeasonNumber(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ai-episode">Episode Number</Label>
                  <Input
                    id="ai-episode"
                    name="episode_number"
                    type="number"
                    min={1}
                    placeholder="Optional"
                    disabled={isDisabled}
                    value={episodeNumber}
                    onChange={(e) => setEpisodeNumber(e.target.value)}
                  />
                </div>
              </div>

              {/* Content warning */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="explicit"
                  name="explicit"
                  value="true"
                  className="rounded border-gray-300"
                />
                <Label htmlFor="explicit" className="cursor-pointer text-sm">
                  Contains explicit/mature content
                </Label>
              </div>
```

- [ ] **Step 11: Add metadata fields to the manual path**

After the manual description textarea block (after line 968, the closing of `{descriptionMode === "manual" && (`), add the same title/episode/season/explicit fields for the manual path. After the manual description `</div>` closing bracket and before `{/* AI suggestions review */}`, add:

```tsx
          {/* Manual path — title, episode/season, explicit */}
          {descriptionMode === "manual" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="title">
                  Episode Title <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="title"
                  name="title"
                  placeholder="e.g., Episode 42: The Cold Case"
                  required
                  disabled={isDisabled}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="season_number">Season Number</Label>
                  <Input
                    id="season_number"
                    name="season_number"
                    type="number"
                    min={1}
                    placeholder="Optional"
                    disabled={isDisabled}
                    value={seasonNumber}
                    onChange={(e) => setSeasonNumber(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="episode_number">Episode Number</Label>
                  <Input
                    id="episode_number"
                    name="episode_number"
                    type="number"
                    min={1}
                    placeholder="Optional"
                    disabled={isDisabled}
                    value={episodeNumber}
                    onChange={(e) => setEpisodeNumber(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="explicit"
                  name="explicit"
                  value="true"
                  className="rounded border-gray-300"
                />
                <Label htmlFor="explicit" className="cursor-pointer text-sm">
                  Contains explicit/mature content
                </Label>
              </div>
            </>
          )}
```

- [ ] **Step 12: Update the path choice button labels**

Update the AI button text (line 943-947) to better reflect that AI now handles everything, not just description:

```tsx
                  <span className="text-sm font-medium">
                    Get AI recommendations
                  </span>
                  <span className="text-xs text-muted-foreground">
                    AI suggests title, description, chapters &amp; tags
                  </span>
```

And the manual button text (line 926-931):

```tsx
                  <span className="text-sm font-medium">
                    I&apos;ll fill in the details myself
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Enter title, description, and metadata manually
                  </span>
```

- [ ] **Step 13: Update the submit button disabled state**

The submit button (line 1075) checks `!description.trim()`. For the AI path it should also check for title. Update:

```ts
              disabled={isDisabled || !description.trim() || !title.trim()}
```

- [ ] **Step 14: Commit**

```bash
git add src/app/dashboard/distribute/new/distribution-form.tsx
git commit -m "feat: restructure distribution form — move metadata below path choice, add AI title and YouTube thumbnail preview"
```

---

### Task 7: Build and Verify

- [ ] **Step 1: Run tests**

Run: `npm test`

Expected: All tests pass.

- [ ] **Step 2: Run build**

Run: `npm run build`

Expected: Build succeeds with no type errors.

- [ ] **Step 3: Fix any build/type issues**

If there are TypeScript errors or build issues, fix them. Common things to check:
- `uploadThumbnailToGCS` dependency array may need updating in `distributeAfterAi`'s dependency array (line 517) since its dependencies changed
- The `shows` prop is used in `startAiAnalysis` now — verify it's in the dependency array
- Hidden `name="title"` inputs — make sure there's no duplicate `name="title"` between the AI path hidden input and the new visible input. The old hidden `<input type="hidden" name="title">` should be removed since both paths now have visible title inputs with `name="title"`.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve build issues from form restructure"
```

---

### Task 8: Push and Test on Staging

- [ ] **Step 1: Push to main for staging deployment**

```bash
git push origin fix/ai-path-data-loss:main
```

Or merge the branch first if preferred.

- [ ] **Step 2: Test AI path**

On staging:
1. Select a show
2. Upload a video file (or provide YouTube URL)
3. Choose "Get AI recommendations"
4. Verify: title field appears pre-filled with AI suggestion
5. Verify: episode/season numbers are auto-populated
6. Edit the title if desired
7. Select platforms and distribute
8. Check the job detail — verify all fields made it through

- [ ] **Step 3: Test YouTube thumbnail auto-preview**

1. Select a show
2. Choose "Recorded live on YouTube"
3. Paste a YouTube URL
4. Verify: YouTube thumbnail preview appears automatically
5. Distribute without uploading a custom thumbnail
6. Verify: YouTube thumbnail appears on all platforms

- [ ] **Step 4: Test manual path**

1. Select a show
2. Upload a video file
3. Choose "I'll fill in the details myself"
4. Verify: title, description, episode/season, explicit fields all appear
5. Verify: episode/season are auto-populated from WP
6. Fill in details and distribute
7. Verify all fields on the job detail page
