# Video Download for Transistor Manual Upload — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Download Video" button on distribution job detail pages (admin-only) so the admin can download the original video file and manually upload it to Transistor for video podcast distribution.

**Architecture:** New API route generates a signed GCS download URL for jobs that have an uploaded video. For YouTube/Vimeo URL-sourced jobs that only have audio in GCS, the API downloads the full video via yt-dlp first, stores the GCS path in job metadata, then returns the signed URL. The button appears in the job detail view for admin users only.

**Tech Stack:** Next.js API route, GCS signed URLs, yt-dlp (video mode), Prisma metadata update

---

### Task 1: Add video download function to video-downloader.ts

**Files:**
- Modify: `src/lib/jobs/video-downloader.ts`

This adds a new export that downloads the **full video** (not audio-only) from YouTube/Vimeo to GCS. The existing `downloadVideoToGcs` extracts audio only (`-x` flag). The new function keeps the video as-is.

- [ ] **Step 1: Add `downloadFullVideoToGcs` function**

Add this function below the existing `downloadVideoToGcs` in `src/lib/jobs/video-downloader.ts`:

```typescript
/**
 * Download the full video (not audio-only) from YouTube/Vimeo to GCS.
 * Used for manual Transistor video uploads where the admin needs the
 * original video file. Unlike downloadVideoToGcs, this does NOT extract
 * audio — it keeps the best available video+audio muxed into mp4.
 *
 * @param videoUrl - Full YouTube or Vimeo URL
 * @param jobId - For log context
 * @param wpShowId - Show that owns this download (drives cookie lookup)
 * @returns GCS path of the downloaded video
 */
export async function downloadFullVideoToGcs(
  videoUrl: string,
  jobId: string,
  wpShowId?: number
): Promise<string> {
  const sourceLabel = deriveSourceLabel(videoUrl);
  if (!sourceLabel) {
    throw new Error(`Invalid video URL — must be a YouTube or Vimeo URL: ${videoUrl}`);
  }

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const timestamp = now.getTime();
  const gcsPath = `uploads/${year}/${month}/${timestamp}-${sourceLabel}-video.mp4`;

  const bucketName = process.env.GCS_BUCKET_NAME;
  if (!bucketName) {
    throw new Error("GCS_BUCKET_NAME is not set");
  }
  const credentialsJson = process.env.GCS_CREDENTIALS_JSON;
  let storage: Storage;
  if (credentialsJson) {
    storage = new Storage({ credentials: JSON.parse(credentialsJson) });
  } else {
    storage = new Storage({ keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS });
  }

  const tempDir = await mkdtemp(join(tmpdir(), "swm-video-full-dl-"));
  const outputTemplate = join(tempDir, "video.%(ext)s");

  let cookieValue: string | null = null;
  if (typeof wpShowId === "number") {
    cookieValue = await getYoutubeCookiesForShow(wpShowId);
  }
  if (!cookieValue && process.env.YOUTUBE_COOKIES) {
    cookieValue = process.env.YOUTUBE_COOKIES;
  }

  let cookiesPath: string | null = null;
  if (cookieValue) {
    cookiesPath = join(tempDir, "cookies.txt");
    await writeFile(cookiesPath, cookieValue, { encoding: "utf-8", mode: 0o600 });
  }

  try {
    console.log(`[video-downloader] Job ${jobId}: downloading full video ${sourceLabel} via yt-dlp`);

    const args = [
      "--no-playlist",
      "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
      "--merge-output-format", "mp4",
      "-o", outputTemplate,
      "--no-warnings",
      "--no-progress",
    ];

    if (cookiesPath) {
      args.push("--cookies", cookiesPath);
    }

    args.push(videoUrl);

    const { stderr } = await execFileAsync("yt-dlp", args, {
      timeout: 60 * 60 * 1000,       // 60 minutes — full video downloads are larger
      killSignal: "SIGKILL",
      maxBuffer: 200 * 1024 * 1024,
    });

    if (stderr) {
      console.warn(`[video-downloader] Job ${jobId} video stderr: ${stderr}`);
    }

    const files = await readdir(tempDir);
    const videoFile = files.find((f) => f.startsWith("video.") && f !== "video.part");
    if (!videoFile) {
      throw new Error("yt-dlp completed but no output video file found");
    }
    const tempVideoPath = join(tempDir, videoFile);

    console.log(`[video-downloader] Job ${jobId}: uploading full video to GCS at ${gcsPath}`);
    await storage.bucket(bucketName).upload(tempVideoPath, {
      destination: gcsPath,
      metadata: { contentType: "video/mp4" },
    });

    console.log(`[video-downloader] Job ${jobId}: full video download complete`);
    return gcsPath;
  } finally {
    const files = await readdir(tempDir).catch(() => []);
    for (const f of files) {
      await unlink(join(tempDir, f)).catch(() => {});
    }
    await rmdir(tempDir).catch(() => {});
  }
}
```

- [ ] **Step 2: Verify the file builds**

Run: `npx tsc --noEmit`
Expected: No errors related to video-downloader.ts

- [ ] **Step 3: Commit**

```bash
git add src/lib/jobs/video-downloader.ts
git commit -m "feat: add downloadFullVideoToGcs for video podcast downloads"
```

---

### Task 2: Create the download-video API route

**Files:**
- Create: `src/app/api/distribute/[id]/download-video/route.ts`

This API route handles the "Download Video" button click. It checks admin auth, determines whether the video is already in GCS (upload-based job) or needs downloading (URL-sourced job), and returns a signed download URL.

- [ ] **Step 1: Create the API route**

Create `src/app/api/distribute/[id]/download-video/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { generateSignedDownloadUrl } from "@/lib/gcs";
import { downloadFullVideoToGcs } from "@/lib/jobs/video-downloader";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const job = await db.distributionJob.findUnique({
    where: { id },
    select: {
      id: true,
      gcsPath: true,
      wpShowId: true,
      title: true,
      metadata: true,
    },
  });

  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const metadata = job.metadata as Record<string, unknown>;

  // Case 1: Upload-based job — video file is already in GCS at job.gcsPath
  if (job.gcsPath && !metadata.existingYoutubeUrl && !metadata.existingVimeoUrl) {
    const url = await generateSignedDownloadUrl(job.gcsPath, 4 * 60 * 60 * 1000); // 4 hours
    return NextResponse.json({ downloadUrl: url });
  }

  // Case 2: URL-sourced job — check if we've already downloaded the full video
  const existingVideoGcsPath = metadata.gcsFullVideoPath as string | undefined;
  if (existingVideoGcsPath) {
    const url = await generateSignedDownloadUrl(existingVideoGcsPath, 4 * 60 * 60 * 1000);
    return NextResponse.json({ downloadUrl: url });
  }

  // Case 3: URL-sourced job — need to download the full video first
  const videoUrl = (metadata.existingYoutubeUrl ?? metadata.existingVimeoUrl) as string | undefined;
  if (!videoUrl) {
    return NextResponse.json(
      { error: "No video source found for this job" },
      { status: 400 }
    );
  }

  try {
    const gcsPath = await downloadFullVideoToGcs(videoUrl, job.id, job.wpShowId);

    // Cache the GCS path in metadata so future clicks don't re-download
    await db.distributionJob.update({
      where: { id: job.id },
      data: {
        metadata: {
          ...metadata,
          gcsFullVideoPath: gcsPath,
        },
      },
    });

    const url = await generateSignedDownloadUrl(gcsPath, 4 * 60 * 60 * 1000);
    return NextResponse.json({ downloadUrl: url });
  } catch (error) {
    console.error(`[download-video] Failed to download video for job ${job.id}:`, error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to download video" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Verify the file builds**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/app/api/distribute/\[id\]/download-video/route.ts
git commit -m "feat: add download-video API route for admin video downloads"
```

---

### Task 3: Add the Download Video button to JobDetailView

**Files:**
- Modify: `src/app/dashboard/distribute/[id]/page.tsx` — pass `isAdmin` to the client component
- Modify: `src/app/dashboard/distribute/[id]/job-detail-view.tsx` — add the button

The button appears for admin users on jobs with a `completed` or `failed` status (meaning the video source exists). It shows a loading spinner during URL-sourced downloads, then opens the signed URL in a new tab.

- [ ] **Step 1: Pass `isAdmin` and `hasVideo` from the server page**

In `src/app/dashboard/distribute/[id]/page.tsx`, add `isAdmin` and `hasVideo` to the serialized job object. After line 49 (`metadata: job.metadata as Record<string, unknown>,`), add:

```typescript
    isAdmin: session.user.role === "admin",
    hasVideo: !!(
      job.gcsPath ||
      (job.metadata as Record<string, unknown>).existingYoutubeUrl ||
      (job.metadata as Record<string, unknown>).existingVimeoUrl
    ),
```

- [ ] **Step 2: Update the SerializedJob interface in job-detail-view.tsx**

Add these two fields to the `SerializedJob` interface:

```typescript
  isAdmin: boolean;
  hasVideo: boolean;
```

- [ ] **Step 3: Add the DownloadVideoButton component in job-detail-view.tsx**

Add this import at the top with the other lucide imports:

```typescript
  DownloadIcon,
```

Add this component before the `JobDetailView` function:

```typescript
function DownloadVideoButton({ jobId }: { jobId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/distribute/${jobId}/download-video`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Download failed");
        return;
      }
      window.open(data.downloadUrl, "_blank");
    } catch {
      setError("Network error — try again");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <Button
        variant="outline"
        size="sm"
        onClick={handleDownload}
        disabled={loading}
      >
        {loading ? (
          <Loader2Icon className="size-3.5 animate-spin" />
        ) : (
          <DownloadIcon className="size-3.5" />
        )}
        {loading ? "Preparing video…" : "Download Video"}
      </Button>
      {error && (
        <p className="mt-1 text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Render the button in the header area**

In the `JobDetailView` function, find the header `<div>` that contains the status badge and delete button (around line 332). Add the download button between the status badge and the delete button, so the buttons section becomes:

```typescript
        <div className="flex items-center gap-2">
          <Badge className={STATUS_COLORS[liveStatus] ?? ""}>
            {STATUS_LABELS[liveStatus] ?? liveStatus}
          </Badge>
          {job.isAdmin && job.hasVideo && (
            <DownloadVideoButton jobId={job.id} />
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={deleting}
            onClick={handleDelete}
            className={confirmDelete ? "border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground" : ""}
          >
            {deleting ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <Trash2Icon className="size-3.5" />
            )}
            {confirmDelete ? "Confirm delete" : "Delete"}
          </Button>
        </div>
```

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/distribute/\[id\]/page.tsx src/app/dashboard/distribute/\[id\]/job-detail-view.tsx
git commit -m "feat: add Download Video button for admin on distribution jobs"
```

---

### Task 4: Clean up GCS full video on job deletion

**Files:**
- Modify: `src/app/dashboard/distribute/[id]/actions.ts`

When a job is deleted, also delete the cached full video file from GCS (if it was downloaded for a URL-sourced job).

- [ ] **Step 1: Update deleteJob to clean up gcsFullVideoPath**

In `src/app/dashboard/distribute/[id]/actions.ts`, inside the `deleteJob` function, find the GCS cleanup block (around line 189-201). After the audio path cleanup, add cleanup for the full video path:

```typescript
    const fullVideoPath = metadata?.gcsFullVideoPath as string | undefined;
    if (fullVideoPath) {
      await deleteFile(fullVideoPath).catch((e) =>
        console.error("[deleteJob] Failed to delete full video from GCS:", e)
      );
    }
```

- [ ] **Step 2: Verify the build**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/distribute/\[id\]/actions.ts
git commit -m "fix: clean up cached full video from GCS on job deletion"
```
