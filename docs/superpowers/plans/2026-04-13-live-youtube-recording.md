# Live YouTube Recording Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow producers to provide an existing YouTube URL instead of uploading a video file, so episodes recorded live on YouTube can be distributed to Transistor and the website without re-uploading.

**Architecture:** A new `downloadYouTubeVideoToGcs` module downloads the YouTube video to GCS using `@distube/ytdl-core` (pure Node.js library). The distribution form gains a "source" toggle (upload file vs. existing YouTube URL). The server action, confirm API, and analyze API each accept a live YouTube job (no GCS file yet). The processor downloads the video at the start of processing if `existingYoutubeUrl` is in metadata and `gcsPath` is null — after that, all existing audio extraction, Transistor, and WordPress logic runs identically.

**Tech Stack:** `@distube/ytdl-core` (YouTube download), Next.js 16 App Router, Server Actions, `@google-cloud/storage`, Vitest + jsdom

---

## File Map

| Status | File | Change |
|--------|------|--------|
| Create | `src/lib/jobs/youtube-video-downloader.ts` | Downloads YouTube video to GCS |
| Create | `tests/lib/jobs/youtube-video-downloader.test.ts` | Unit tests |
| Modify | `src/app/dashboard/distribute/new/actions.ts` | Accept `existingYoutubeUrl`, relax video file validation |
| Modify | `src/app/api/upload/confirm/route.ts` | Allow no gcsPath when `existingYoutubeUrl` in metadata |
| Modify | `src/app/api/distribute/analyze/route.ts` | Download YouTube video before analysis if no gcsPath |
| Modify | `src/lib/jobs/processor.ts` | Download video + set youtubeUrl from existingYoutubeUrl |
| Modify | `src/app/dashboard/distribute/new/distribution-form.tsx` | Source toggle UI, wire YouTube path |

---

## Task 1: YouTube Video Downloader module

**Files:**
- Create: `src/lib/jobs/youtube-video-downloader.ts`
- Create: `tests/lib/jobs/youtube-video-downloader.test.ts`

### Context

`audio-extractor.ts` shows the pattern: download to temp file → process → upload to GCS → cleanup. We follow the same pattern. GCS path format from `src/lib/gcs.ts`: `uploads/{year}/{month}/{timestamp}-{filename}`.

`@distube/ytdl-core` is the maintained fork of `ytdl-core`. It returns a Node.js `Readable` stream. We use `filter: "audioandvideo"` so we get a single combined stream (typically 360p–720p) — smaller than video-only HD streams but sufficient since we only need the audio track downstream.

- [ ] **Step 1: Install `@distube/ytdl-core`**

```bash
npm install @distube/ytdl-core
```

Expected: package added to `node_modules` and `package.json` dependencies.

- [ ] **Step 2: Write the failing tests**

Create `tests/lib/jobs/youtube-video-downloader.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Must mock I/O before importing the module
vi.mock("@distube/ytdl-core", () => {
  const { Readable } = require("node:stream");
  const mockYtdl = vi.fn((_url: string) => {
    const stream = new Readable({ read() {} });
    process.nextTick(() => {
      stream.push(Buffer.from("fake-video-data"));
      stream.push(null);
    });
    return stream;
  });
  return { default: mockYtdl };
});

const mockBucketUpload = vi.fn().mockResolvedValue([]);
vi.mock("@google-cloud/storage", () => ({
  Storage: vi.fn(() => ({
    bucket: vi.fn(() => ({ upload: mockBucketUpload })),
  })),
}));

vi.mock("node:fs", () => ({
  createWriteStream: vi.fn(() => {
    const { Writable } = require("node:stream");
    return new Writable({ write(_chunk: any, _enc: any, cb: () => void) { cb(); } });
  }),
}));

vi.mock("node:stream/promises", () => ({
  pipeline: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("node:fs/promises", () => ({
  mkdtemp: vi.fn().mockResolvedValue("/tmp/swm-yt-dl-test"),
  unlink: vi.fn().mockResolvedValue(undefined),
  rmdir: vi.fn().mockResolvedValue(undefined),
}));

import { downloadYouTubeVideoToGcs } from "@/lib/jobs/youtube-video-downloader";
import ytdl from "@distube/ytdl-core";

describe("downloadYouTubeVideoToGcs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GCS_BUCKET_NAME = "test-bucket";
    process.env.GCS_CREDENTIALS_JSON = JSON.stringify({ type: "service_account" });
  });

  it("returns a GCS path containing the video ID", async () => {
    const result = await downloadYouTubeVideoToGcs(
      "https://www.youtube.com/watch?v=abc123xyz",
      "job-1"
    );
    expect(result).toMatch(/uploads\/\d{4}\/\d{2}\/\d+-youtube-abc123xyz\.mp4/);
  });

  it("calls ytdl with the YouTube URL and audioandvideo filter", async () => {
    await downloadYouTubeVideoToGcs(
      "https://www.youtube.com/watch?v=abc123xyz",
      "job-1"
    );
    expect(ytdl).toHaveBeenCalledWith(
      "https://www.youtube.com/watch?v=abc123xyz",
      expect.objectContaining({ filter: "audioandvideo" })
    );
  });

  it("uploads to GCS with the generated path", async () => {
    const result = await downloadYouTubeVideoToGcs(
      "https://www.youtube.com/watch?v=abc123xyz",
      "job-1"
    );
    expect(mockBucketUpload).toHaveBeenCalledWith(
      "/tmp/swm-yt-dl-test/video.mp4",
      expect.objectContaining({ destination: result })
    );
  });

  it("throws for a URL with no video ID", async () => {
    await expect(
      downloadYouTubeVideoToGcs("https://www.youtube.com/playlist?list=abc", "job-1")
    ).rejects.toThrow("Invalid YouTube URL: missing video ID");
  });

  it("throws for a non-YouTube URL", async () => {
    await expect(
      downloadYouTubeVideoToGcs("https://vimeo.com/123456", "job-1")
    ).rejects.toThrow("Invalid YouTube URL");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npm test -- tests/lib/jobs/youtube-video-downloader.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/jobs/youtube-video-downloader'`

- [ ] **Step 4: Implement `youtube-video-downloader.ts`**

Create `src/lib/jobs/youtube-video-downloader.ts`:

```typescript
import ytdl from "@distube/ytdl-core";
import { createWriteStream } from "node:fs";
import { unlink, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Storage } from "@google-cloud/storage";

/**
 * Download a YouTube video to GCS.
 *
 * Downloads to a temp file using @distube/ytdl-core (combined audio+video stream),
 * uploads to GCS, cleans up temp file, and returns the GCS path.
 *
 * @param youtubeUrl - Full YouTube watch URL (e.g. https://www.youtube.com/watch?v=VIDEO_ID)
 * @param jobId - Used only for log context
 * @returns GCS path of the downloaded video
 */
export async function downloadYouTubeVideoToGcs(
  youtubeUrl: string,
  jobId: string
): Promise<string> {
  // Validate and extract video ID
  let videoId: string | null = null;
  try {
    videoId = new URL(youtubeUrl).searchParams.get("v");
  } catch {
    throw new Error(`Invalid YouTube URL: ${youtubeUrl}`);
  }
  if (!videoId) {
    throw new Error(`Invalid YouTube URL: missing video ID (${youtubeUrl})`);
  }

  // Build GCS destination path (same format as gcs.ts generateGcsPath)
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const timestamp = now.getTime();
  const gcsPath = `uploads/${year}/${month}/${timestamp}-youtube-${videoId}.mp4`;

  const bucketName = process.env.GCS_BUCKET_NAME!;
  const credentialsJson = process.env.GCS_CREDENTIALS_JSON;
  const storage = credentialsJson
    ? new Storage({ credentials: JSON.parse(credentialsJson) })
    : new Storage({ keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS });

  const tempDir = await mkdtemp(join(tmpdir(), "swm-yt-dl-"));
  const tempVideoPath = join(tempDir, "video.mp4");

  try {
    console.log(`[yt-downloader] Job ${jobId}: downloading YouTube video ${videoId}`);

    const videoStream = ytdl(youtubeUrl, { filter: "audioandvideo" });
    const fileStream = createWriteStream(tempVideoPath);
    await pipeline(videoStream, fileStream);

    console.log(`[yt-downloader] Job ${jobId}: uploading to GCS at ${gcsPath}`);
    await storage.bucket(bucketName).upload(tempVideoPath, {
      destination: gcsPath,
      metadata: { contentType: "video/mp4" },
    });

    console.log(`[yt-downloader] Job ${jobId}: download complete`);
    return gcsPath;
  } finally {
    await unlink(tempVideoPath).catch(() => {});
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test -- tests/lib/jobs/youtube-video-downloader.test.ts
```

Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add src/lib/jobs/youtube-video-downloader.ts tests/lib/jobs/youtube-video-downloader.test.ts package.json package-lock.json
git commit -m "feat: add YouTube video downloader module for live recordings"
```

---

## Task 2: Server action — accept existingYoutubeUrl

**Files:**
- Modify: `src/app/dashboard/distribute/new/actions.ts`

### Context

`submitDistribution` validates that `videoFileName` is present. For live YouTube jobs, there is no video file to upload — instead `existing_youtube_url` is in the FormData. We need to:
1. Parse `existing_youtube_url` from formData
2. Require EITHER `videoFileName` OR `existingYoutubeUrl` (not both — invalid state)
3. Store `existingYoutubeUrl` in `metadata`

- [ ] **Step 1: Write the failing test**

Add to `tests/app/distribute/actions.test.ts` (create this file if it doesn't exist — check first):

```bash
ls tests/app/ 2>/dev/null || echo "no tests/app dir"
```

If it doesn't exist, create `tests/app/distribute/actions.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

// Mock auth and db
vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({
    user: {
      id: "user-1",
      role: "admin",
      hasDistributionAccess: true,
    },
  }),
}));

const mockCreate = vi.fn().mockResolvedValue({ id: "job-1" });
const mockCreateMany = vi.fn().mockResolvedValue({});
const mockActivityCreate = vi.fn().mockResolvedValue({});
const mockFindUnique = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(async (fn: any) =>
      fn({
        distributionJob: { create: mockCreate },
        distributionJobPlatform: { createMany: mockCreateMany },
        activityLog: { create: mockActivityCreate },
      })
    ),
    userShowAccess: { findUnique: mockFindUnique },
  },
}));

import { submitDistribution } from "@/app/dashboard/distribute/new/actions";

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, val] of Object.entries(fields)) {
    fd.set(key, val);
  }
  return fd;
}

const BASE_FIELDS = {
  show_id: "42",
  title: "Test Episode",
  description: "Episode description",
  platform_youtube: "on",
};

describe("submitDistribution", () => {
  it("accepts a video file upload (existing behavior)", async () => {
    const fd = makeFormData({
      ...BASE_FIELDS,
      video_file_name: "episode.mp4",
      video_file_size: "1000000",
      video_content_type: "video/mp4",
    });
    const result = await submitDistribution({}, fd);
    expect(result.success).toBe(true);
    expect(result.jobId).toBe("job-1");
    const createdData = mockCreate.mock.calls[0][0].data;
    expect(createdData.metadata.videoFileName).toBe("episode.mp4");
    expect(createdData.metadata.existingYoutubeUrl).toBeUndefined();
  });

  it("accepts an existing YouTube URL instead of a file", async () => {
    const fd = makeFormData({
      ...BASE_FIELDS,
      existing_youtube_url: "https://www.youtube.com/watch?v=abc123",
    });
    mockCreate.mockClear();
    const result = await submitDistribution({}, fd);
    expect(result.success).toBe(true);
    const createdData = mockCreate.mock.calls[0][0].data;
    expect(createdData.metadata.existingYoutubeUrl).toBe(
      "https://www.youtube.com/watch?v=abc123"
    );
    expect(createdData.metadata.videoFileName).toBeNull();
  });

  it("fails validation when neither video file nor YouTube URL is provided", async () => {
    const fd = makeFormData(BASE_FIELDS);
    const result = await submitDistribution({}, fd);
    expect(result.success).toBe(false);
    expect(result.errors?.video_file).toBeDefined();
  });
});
```

- [ ] **Step 2: Run to verify test fails**

```bash
npm test -- tests/app/distribute/actions.test.ts
```

Expected: FAIL on "accepts an existing YouTube URL" and "fails validation when neither..."

- [ ] **Step 3: Update `submitDistribution` in `actions.ts`**

In `src/app/dashboard/distribute/new/actions.ts`, make these changes:

After `const videoContentType = formData.get("video_content_type") as string | null;` (line ~49), add:

```typescript
const existingYoutubeUrl = formData.get("existing_youtube_url") as string | null;
```

Replace the existing `if (!videoFileName)` validation block:

```typescript
// Before (remove this):
if (!videoFileName) {
  errors.video_file = ["Please select a video file."];
}

// After (replace with):
if (!videoFileName && !existingYoutubeUrl) {
  errors.video_file = ["Please select a video file or provide a YouTube URL."];
}
```

In the `metadata` object, add `existingYoutubeUrl` and make `videoFileName` nullable:

```typescript
const metadata = {
  description: description!.trim(),
  tags: parsedTags,
  isDraft,
  scheduleMode: isDraft ? "now" : (scheduleMode ?? "now"),
  scheduledAt: scheduleMode === "schedule" && !isDraft ? scheduledAt : null,
  youtubePrivacy: isDraft ? "unlisted" : "public",
  videoFileName,
  videoFileSize: videoFileSize ? parseInt(videoFileSize, 10) : 0,
  videoContentType,
  seasonNumber: seasonNumber ? parseInt(seasonNumber, 10) : undefined,
  episodeNumber: episodeNumber ? parseInt(episodeNumber, 10) : undefined,
  explicit,
  ...(existingYoutubeUrl ? { existingYoutubeUrl } : {}),
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/app/distribute/actions.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/distribute/new/actions.ts tests/app/distribute/actions.test.ts
git commit -m "feat: accept existingYoutubeUrl in submitDistribution action"
```

---

## Task 3: API routes — confirm and analyze

**Files:**
- Modify: `src/app/api/upload/confirm/route.ts`
- Modify: `src/app/api/distribute/analyze/route.ts`

### Context

**Confirm route** (`/api/upload/confirm`): currently returns 400 if `job.gcsPath` is null. For a live YouTube job, there is no uploaded file yet — `gcsPath` is null but `metadata.existingYoutubeUrl` is set. We allow these jobs to proceed by checking metadata.

**Analyze route** (`/api/distribute/analyze`): currently returns 400 if `job.gcsPath` is null. For a live YouTube job, download the video to GCS first, update `job.gcsPath` in the DB, then proceed with the existing audio extraction → transcription → AI pipeline.

Both routes need to import `downloadYouTubeVideoToGcs`.

- [ ] **Step 1: Update the confirm route**

In `src/app/api/upload/confirm/route.ts`, replace the gcsPath check block:

```typescript
// Before (remove this):
if (!job.gcsPath) {
  return NextResponse.json(
    { error: "No file has been uploaded for this job." },
    { status: 400 }
  );
}

// After (replace with):
if (!job.gcsPath) {
  const jobMetadata = job.metadata as Record<string, unknown>;
  if (!jobMetadata.existingYoutubeUrl) {
    return NextResponse.json(
      { error: "No file has been uploaded for this job." },
      { status: 400 }
    );
  }
  // Live YouTube job — no GCS upload needed, allow proceeding without a file
}
```

- [ ] **Step 2: Update the analyze route**

In `src/app/api/distribute/analyze/route.ts`, add the import at the top:

```typescript
import { downloadYouTubeVideoToGcs } from "@/lib/jobs/youtube-video-downloader";
```

Replace the existing gcsPath check:

```typescript
// Before (remove this):
if (!job.gcsPath) {
  return NextResponse.json({ error: "No video uploaded." }, { status: 400 });
}

// After (replace with):
let gcsPath = job.gcsPath;
if (!gcsPath) {
  const jobMeta = job.metadata as Record<string, unknown>;
  const existingYoutubeUrl = jobMeta.existingYoutubeUrl as string | undefined;
  if (!existingYoutubeUrl) {
    return NextResponse.json({ error: "No video uploaded." }, { status: 400 });
  }
  console.log(`[analyze] Downloading YouTube video for job ${jobId}`);
  gcsPath = await downloadYouTubeVideoToGcs(existingYoutubeUrl, jobId);
  await db.distributionJob.update({
    where: { id: jobId },
    data: { gcsPath },
  });
}
```

Then replace the `extractAudio(job.gcsPath)` call (in the try block below) with `extractAudio(gcsPath)`.

The full updated try block:

```typescript
try {
  // 1. Extract audio
  console.log(`[analyze] Extracting audio for job ${jobId}`);
  const gcsAudioPath = await extractAudio(gcsPath);  // <-- was job.gcsPath

  // 2. Transcribe
  console.log(`[analyze] Transcribing audio for job ${jobId}`);
  const transcription = await transcribeAudio(gcsAudioPath);
  const formattedTranscript = formatTranscriptForAI(transcription.segments);

  // Store transcript in job metadata
  const metadata = job.metadata as Record<string, unknown>;
  await db.distributionJob.update({
    where: { id: jobId },
    data: {
      metadata: {
        ...metadata,
        transcript: transcription.fullText,
        transcriptLanguage: transcription.language,
        audioDuration: transcription.duration,
        gcsAudioPath,
      },
    },
  });

  // 3. Generate AI suggestions
  console.log(`[analyze] Generating AI suggestions for job ${jobId}`);
  await generateAiSuggestions(
    jobId,
    formattedTranscript,
    transcription.language
  );

  // Fetch the generated suggestions
  const suggestions = await db.aiSuggestion.findMany({
    where: { jobId },
    select: { id: true, type: true, content: true, accepted: true },
  });

  return NextResponse.json({
    success: true,
    transcript: transcription.fullText,
    language: transcription.language,
    duration: transcription.duration,
    suggestions,
  });
} catch (error) {
  const message = error instanceof Error ? error.message : "Analysis failed";
  console.error(`[analyze] Failed for job ${jobId}:`, error);
  return NextResponse.json({ error: message }, { status: 500 });
}
```

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all existing tests still pass (no regressions).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/upload/confirm/route.ts src/app/api/distribute/analyze/route.ts
git commit -m "feat: allow live YouTube jobs in confirm and analyze routes"
```

---

## Task 4: Processor — handle live YouTube recordings

**Files:**
- Modify: `src/lib/jobs/processor.ts`

### Context

`processJobInner` in `processor.ts` needs two changes:

1. **Download if needed:** At the start (before audio extraction), if `metadata.existingYoutubeUrl` is set and `job.gcsPath` is null, download the YouTube video to GCS and update `job.gcsPath`.

2. **Set youtubeUrl:** The `youtubeUrl` variable must be initialized from `metadata.existingYoutubeUrl` when present, so WordPress gets the URL even if "youtube" is not a selected platform.

3. **Handle youtube platform:** If `youtubePlatform` exists and `existingYoutubeUrl` is set, mark it as completed immediately (no upload needed) with the provided URL.

Key lines to be aware of:
- Line ~136: `const metadata = job.metadata as Record<string, unknown>;`
- Line ~146: `let gcsAudioPath: string | null = null;` — audio extraction block  
- Line ~223: `let tempVideoPath: string | null = null;` — video download for YouTube upload
- Line ~245: `let youtubeUrl: string | null = null;` — YouTube URL initialization
- Line ~249: `if (youtubePlatform && youtubePlatform.status === "completed")` — YouTube platform check

Add the import at the top of the file:

```typescript
import { downloadYouTubeVideoToGcs } from "./youtube-video-downloader";
```

- [ ] **Step 1: Add download step and effectiveGcsPath**

After line ~136 (`const metadata = job.metadata as Record<string, unknown>;`), insert:

```typescript
const existingYoutubeUrl = metadata.existingYoutubeUrl as string | undefined;

// For live YouTube recordings: download the video to GCS if not already done.
// After this point, effectiveGcsPath is set and all downstream processing
// (audio extraction, Transistor, WordPress) runs identically to a normal upload.
let effectiveGcsPath: string | null = job.gcsPath;
if (existingYoutubeUrl && !effectiveGcsPath) {
  console.log(`[processor] Live YouTube recording — downloading ${existingYoutubeUrl}`);
  const downloadedPath = await downloadYouTubeVideoToGcs(existingYoutubeUrl, job.id);
  await db.distributionJob.update({
    where: { id: job.id },
    data: { gcsPath: downloadedPath },
  });
  effectiveGcsPath = downloadedPath;
  console.log(`[processor] YouTube video downloaded to GCS: ${downloadedPath}`);
}
```

- [ ] **Step 2: Replace job.gcsPath references with effectiveGcsPath**

There are two `job.gcsPath` references after the insertion point:
- `if (transistorNeedsWork && job.gcsPath)` → `if (transistorNeedsWork && effectiveGcsPath)`
- `if (youtubeNeedsWork && job.gcsPath)` → `if (youtubeNeedsWork && effectiveGcsPath)`

Also update the audio extraction call:
```typescript
// Before:
gcsAudioPath = await extractAudio(job.gcsPath);
// After:
gcsAudioPath = await extractAudio(effectiveGcsPath);
```

And the video download line for YouTube:
```typescript
// Before:
const downloadUrl = await generateSignedDownloadUrl(job.gcsPath);
// After:
const downloadUrl = await generateSignedDownloadUrl(effectiveGcsPath);
```

- [ ] **Step 3: Initialize youtubeUrl from existingYoutubeUrl**

Replace the current YouTube URL initialization (around line ~245):

```typescript
// Before:
let youtubeUrl: string | null = null;
let youtubeVideoId: string | null = null;

// After:
let youtubeUrl: string | null = existingYoutubeUrl ?? null;
let youtubeVideoId: string | null = youtubeUrl
  ? new URL(youtubeUrl).searchParams.get("v")
  : null;
```

- [ ] **Step 4: Handle youtube platform with existingYoutubeUrl**

After the `if (youtubePlatform && youtubePlatform.status === "completed")` block, add a new `else if` BEFORE the existing `else if (youtubePlatform)` upload block:

```typescript
} else if (youtubePlatform && existingYoutubeUrl) {
  // Live recording — this video is already on YouTube at the provided URL.
  // Mark the platform as completed without re-uploading.
  await db.distributionJobPlatform.update({
    where: { id: youtubePlatform.id },
    data: {
      status: "completed",
      externalId: new URL(existingYoutubeUrl).searchParams.get("v") ?? "",
      externalUrl: existingYoutubeUrl,
      completedAt: new Date(),
    },
  });
  platformResults.push({ platform: "youtube", status: "completed" });
} else if (youtubePlatform) {
  // Normal YouTube upload path (existing code)
  // ...
```

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/jobs/processor.ts
git commit -m "feat: processor downloads YouTube video and skips upload for live recordings"
```

---

## Task 5: Distribution form — source toggle UI

**Files:**
- Modify: `src/app/dashboard/distribute/new/distribution-form.tsx`

### Context

The form currently shows a file upload dropzone. We need to add a source toggle above the dropzone. When "Recorded on YouTube" is selected, show a URL input instead. All state callbacks (`startAiAnalysis`, `uploadAndConfirmManual`) need to skip the video upload step for YouTube source and use the provided URL.

**New state to add:**
```typescript
const [videoSource, setVideoSource] = useState<"upload" | "youtube">("upload");
const [youtubeUrlInput, setYoutubeUrlInput] = useState("");
```

**Updated computed values:**
```typescript
// Replace: const showModeChoice = !!videoFileName && !descriptionMode;
const videoSourceReady =
  videoSource === "upload" ? !!videoFileName : youtubeUrlInput.trim().startsWith("https://www.youtube.com/watch?v=");
const showModeChoice = videoSourceReady && !descriptionMode;
```

**New import needed:**
```typescript
import { LinkIcon } from "lucide-react";
```

- [ ] **Step 1: Add new state variables after `thumbnailFileRef`**

After `const thumbnailFileRef = useRef<File | null>(null);` (around line 103), add:

```typescript
const [videoSource, setVideoSource] = useState<"upload" | "youtube">("upload");
const [youtubeUrlInput, setYoutubeUrlInput] = useState("");
```

- [ ] **Step 2: Update `showModeChoice` and add `videoSourceReady`**

Replace `const showModeChoice = !!videoFileName && !descriptionMode;` (around line 498) with:

```typescript
const videoSourceReady =
  videoSource === "upload"
    ? !!videoFileName
    : youtubeUrlInput.trim().startsWith("https://www.youtube.com/watch?v=");
const showModeChoice = videoSourceReady && !descriptionMode;
```

- [ ] **Step 3: Update `startAiAnalysis` for YouTube source**

`startAiAnalysis` is a `useCallback`. The changes:
1. Build FormData differently based on `videoSource`
2. Skip `uploadVideoToGCS` when source is "youtube"
3. Show "Downloading video from YouTube..." message for the analyze step

Replace the `startAiAnalysis` useCallback body:

```typescript
const startAiAnalysis = useCallback(async () => {
  if (!formRef.current) return;

  setAnalyzing(true);
  setAnalysisError(null);
  setSuggestions([]);
  setAnalysisStep("Creating job...");

  try {
    const fd = new FormData();
    fd.set("show_id", showId);
    fd.set("title", title);
    fd.set("description", "AI-generated description pending");
    fd.set("platform_youtube", "on");
    if (publishState.status === "draft") fd.set("status", "draft");

    if (videoSource === "upload") {
      fd.set("video_file_name", videoFileName ?? "");
      fd.set("video_file_size", videoFileSize.toString());
      fd.set("video_content_type", videoContentType);
    } else {
      fd.set("existing_youtube_url", youtubeUrlInput);
    }

    const result = await submitDistribution({}, fd);
    if (!result.success || !result.jobId) {
      throw new Error(result.message ?? "Failed to create job");
    }

    const jobId = result.jobId;
    setAiUploadedJobId(jobId);

    if (videoSource === "upload") {
      setAnalysisStep("Uploading video...");
      await Promise.all([
        uploadVideoToGCS(jobId),
        uploadThumbnailToGCS(jobId),
      ]);
    } else {
      await uploadThumbnailToGCS(jobId);
    }

    setAnalysisStep("Preparing...");
    const confirmRes = await fetch("/api/upload/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, skipProcessing: true }),
    });
    if (!confirmRes.ok) {
      const err = await confirmRes.json();
      throw new Error(err.error ?? "Failed to confirm upload");
    }

    setAnalysisStep(
      videoSource === "youtube"
        ? "Downloading video from YouTube... this may take several minutes"
        : "Transcribing... this may take a few minutes"
    );
    const analyzeRes = await fetch("/api/distribute/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId }),
    });

    if (!analyzeRes.ok) {
      const err = await analyzeRes.json();
      throw new Error(err.error ?? "Analysis failed");
    }

    setAnalysisStep("Generating recommendations...");
    const data = await analyzeRes.json();
    const aiSuggestions: AiSuggestion[] = data.suggestions ?? [];
    setSuggestions(aiSuggestions);

    const summarySuggestion = aiSuggestions.find((s) => s.type === "summary");
    if (summarySuggestion) {
      const footer = descriptionFooters[showId];
      const desc = footer
        ? `${summarySuggestion.content}\n\n${footer}`
        : summarySuggestion.content;
      setDescription(desc);
    }
    const chaptersSuggestion = aiSuggestions.find((s) => s.type === "chapters");
    if (chaptersSuggestion) {
      setChapters(chaptersSuggestion.content);
    }

    const keywordsSuggestion = aiSuggestions.find((s) => s.type === "keywords");
    if (keywordsSuggestion) {
      const aiKeywords = keywordsSuggestion.content
        .split("\n")
        .map((k) => k.trim())
        .filter(Boolean);
      const alreadySelected = new Set(tags);
      const aiNew = aiKeywords.filter((k) => !alreadySelected.has(k));
      const freqRemaining = (frequentTags[showId] ?? []).filter(
        (t) => !alreadySelected.has(t) && !aiNew.includes(t)
      );
      setSuggestedTags([...aiNew, ...freqRemaining]);
    }

    setAnalysisStep("");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Analysis failed";
    setAnalysisError(message);
    setAnalysisStep("");
  } finally {
    setAnalyzing(false);
    setUploading(false);
  }
}, [
  showId,
  title,
  videoSource,
  videoFileName,
  videoFileSize,
  videoContentType,
  youtubeUrlInput,
  publishState.status,
  uploadVideoToGCS,
  uploadThumbnailToGCS,
  descriptionFooters,
  tags,
  frequentTags,
]);
```

- [ ] **Step 4: Update `uploadAndConfirmManual` for YouTube source**

Replace the `uploadAndConfirmManual` useCallback body:

```typescript
const uploadAndConfirmManual = useCallback(
  async (jobId: string) => {
    try {
      if (videoSource === "upload") {
        await Promise.all([
          uploadVideoToGCS(jobId),
          uploadThumbnailToGCS(jobId),
        ]);
      } else {
        await uploadThumbnailToGCS(jobId);
      }

      const confirmRes = await fetch("/api/upload/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      if (!confirmRes.ok) {
        const err = await confirmRes.json();
        throw new Error(err.error ?? "Failed to confirm upload");
      }

      router.push(`/dashboard/distribute/${jobId}`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Upload failed";
      setUploadError(message);
      setUploading(false);
    }
  },
  [videoSource, uploadVideoToGCS, uploadThumbnailToGCS, router]
);
```

- [ ] **Step 5: Add the source toggle + YouTube URL input to the JSX**

Add `LinkIcon` to the lucide-react import:

```typescript
import {
  Loader2Icon,
  CheckCircle2Icon,
  AlertCircleIcon,
  UploadIcon,
  MonitorPlayIcon,
  RadioIcon,
  HeadphonesIcon,
  CastIcon,
  GlobeIcon,
  PenLineIcon,
  SparklesIcon,
  LinkIcon,          // <-- add this
} from "lucide-react";
```

Replace the entire "Video file select" section (the `<div className="space-y-2">` containing `<Label htmlFor="video_file">`) with:

```tsx
{/* Video source toggle */}
<div className="space-y-2">
  <Label>Video Source</Label>
  <div className="grid grid-cols-2 gap-3">
    <button
      type="button"
      onClick={() => {
        setVideoSource("upload");
        setYoutubeUrlInput("");
        setDescriptionMode(null);
        setSuggestions([]);
        setAiUploadedJobId(null);
        setTags(frequentTags[showId] ?? []);
        setSuggestedTags([]);
      }}
      disabled={isDisabled}
      className={`flex items-center justify-center gap-2 rounded-lg border-2 px-4 py-3 text-sm font-medium transition-colors ${
        videoSource === "upload"
          ? "border-primary bg-primary/5 text-primary"
          : "border-input hover:border-primary/50 hover:bg-muted/30"
      }`}
    >
      <UploadIcon className="size-4" />
      Upload video file
    </button>
    <button
      type="button"
      onClick={() => {
        setVideoSource("youtube");
        videoFileRef.current = null;
        setVideoFileName(null);
        setVideoFileSize(0);
        setVideoContentType("");
        setDescriptionMode(null);
        setSuggestions([]);
        setAiUploadedJobId(null);
        setTags(frequentTags[showId] ?? []);
        setSuggestedTags([]);
      }}
      disabled={isDisabled}
      className={`flex items-center justify-center gap-2 rounded-lg border-2 px-4 py-3 text-sm font-medium transition-colors ${
        videoSource === "youtube"
          ? "border-primary bg-primary/5 text-primary"
          : "border-input hover:border-primary/50 hover:bg-muted/30"
      }`}
    >
      <LinkIcon className="size-4" />
      Recorded live on YouTube
    </button>
  </div>
</div>

{/* Upload dropzone — only shown when source is "upload" */}
{videoSource === "upload" && (
  <div className="space-y-2">
    <Label htmlFor="video_file">
      Video File <span className="text-destructive">*</span>
    </Label>
    <label
      htmlFor="video_file"
      className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-input px-4 py-8 text-center transition-colors hover:border-primary/50 hover:bg-muted/30"
    >
      <UploadIcon className="size-8 text-muted-foreground" />
      {videoFileName ? (
        <span className="text-sm font-medium">{videoFileName}</span>
      ) : (
        <span className="text-sm text-muted-foreground">
          Click to upload or drag and drop a video file
        </span>
      )}
      <input
        id="video_file"
        type="file"
        accept="video/*"
        className="sr-only"
        disabled={isDisabled}
        onChange={(e) => {
          const file = e.target.files?.[0] ?? null;
          videoFileRef.current = file;
          setVideoFileName(file?.name ?? null);
          setVideoFileSize(file?.size ?? 0);
          setVideoContentType(file?.type ?? "");
          setDescriptionMode(null);
          setSuggestions([]);
          setAiUploadedJobId(null);
          setTags(frequentTags[showId] ?? []);
          setSuggestedTags([]);
        }}
      />
    </label>
  </div>
)}

{/* YouTube URL input — only shown when source is "youtube" */}
{videoSource === "youtube" && (
  <div className="space-y-2">
    <Label htmlFor="youtube_url_input">
      YouTube URL <span className="text-destructive">*</span>
    </Label>
    <Input
      id="youtube_url_input"
      type="url"
      placeholder="https://www.youtube.com/watch?v=..."
      value={youtubeUrlInput}
      onChange={(e) => {
        setYoutubeUrlInput(e.target.value);
        // Reset mode if URL changes after suggestions were generated
        if (aiUploadedJobId) {
          setDescriptionMode(null);
          setSuggestions([]);
          setAiUploadedJobId(null);
          setTags(frequentTags[showId] ?? []);
          setSuggestedTags([]);
        }
      }}
      disabled={isDisabled}
    />
    <p className="text-xs text-muted-foreground">
      Paste the URL of the YouTube video that was recorded live. The system will download it to extract audio for Transistor and generate AI suggestions.
    </p>
  </div>
)}
```

- [ ] **Step 6: Update hidden fields block**

Replace the hidden fields block that currently renders when `videoFileName` is set:

```tsx
{/* Hidden fields for video metadata */}
{videoSource === "upload" && videoFileName && (
  <>
    <input type="hidden" name="video_file_name" value={videoFileName} />
    <input
      type="hidden"
      name="video_file_size"
      value={videoFileSize.toString()}
    />
    <input
      type="hidden"
      name="video_content_type"
      value={videoContentType}
    />
  </>
)}
{videoSource === "youtube" && youtubeUrlInput && (
  <input type="hidden" name="existing_youtube_url" value={youtubeUrlInput} />
)}
```

- [ ] **Step 7: Update thumbnail visibility**

The thumbnail currently renders when `videoFileName` is set. Change it to render when `videoSourceReady`:

```tsx
{/* Thumbnail upload — visible once video source is ready */}
{videoSourceReady && (
  <div className="space-y-2">
    {/* ... existing thumbnail content unchanged ... */}
  </div>
)}
```

- [ ] **Step 8: Build to check for TypeScript errors**

```bash
npm run build 2>&1 | tail -30
```

Expected: Build succeeds with no TypeScript errors. If there are type errors, fix them before proceeding.

- [ ] **Step 9: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 10: Commit**

```bash
git add src/app/dashboard/distribute/new/distribution-form.tsx
git commit -m "feat: add live YouTube recording source toggle to distribution form"
```

---

## Task 6: Push to main

- [ ] **Step 1: Run the full test suite one more time**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Push**

```bash
git push origin main
```

---

## Self-Review

### Spec coverage

| Requirement | Task |
|------------|------|
| Producer can provide YouTube URL instead of video file | Task 5 |
| Form shows toggle between upload and YouTube URL | Task 5 |
| YouTube video downloaded to GCS for audio extraction | Task 1 + Task 4 |
| Transistor audio extraction works identically | Task 4 (effectiveGcsPath) |
| AI analysis / transcription works for YouTube source | Task 3 (analyze route) |
| WordPress gets the YouTube URL for the embed | Task 4 (youtubeUrl init) |
| YouTube platform is marked complete (not re-uploaded) | Task 4 (else if block) |
| Server action validates either video file OR youtube URL | Task 2 |
| Confirm route allows no gcsPath for YouTube jobs | Task 3 |

All requirements covered. No gaps found.

### Placeholder scan

No TBD/TODO placeholders. All code blocks are complete.

### Type consistency

- `existingYoutubeUrl` is consistently `string | undefined` in metadata reads (typed with `as string | undefined`)
- `effectiveGcsPath` is `string | null` — same type as `job.gcsPath`
- `videoSource: "upload" | "youtube"` — consistent across form state and callbacks
- `youtubeUrlInput: string` — plain string, trimmed before validation in `videoSourceReady`
