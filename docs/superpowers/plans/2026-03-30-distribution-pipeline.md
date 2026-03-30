# Distribution Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace simulated platform uploads with real YouTube, Transistor, and WordPress integrations, add Deepgram transcription for AI-assisted episode descriptions, and trigger processing immediately on upload completion.

**Architecture:** Platform uploaders are isolated modules in `src/lib/platforms/`. The processor orchestrates them in dependency order (YouTube first, WordPress last). Audio extraction uses ffmpeg, transcription uses Deepgram, AI recommendations use Claude. The distribution form supports two paths: manual description or AI-assisted via transcription.

**Tech Stack:** YouTube Data API v3 (fetch-based), Transistor REST API, WordPress REST API (existing client), Deepgram SDK, ffmpeg (Alpine package), Anthropic SDK (existing)

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/lib/platforms/youtube.ts` | Upload video to YouTube via Data API v3 |
| Create | `src/lib/platforms/transistor.ts` | Create episode + upload audio via Transistor API |
| Create | `src/lib/platforms/wordpress.ts` | Create episode post with YouTube embed via WP REST |
| Create | `src/lib/transcription.ts` | Deepgram API client for audio transcription |
| Modify | `src/lib/jobs/audio-extractor.ts` | Real ffmpeg audio extraction |
| Modify | `src/lib/jobs/processor.ts` | Real platform calls, execution ordering, error notifications |
| Modify | `src/lib/jobs/ai-processor.ts` | Transcript-based prompts, configurable blog analysis |
| Modify | `src/lib/notifications.ts` | Add admin error notification function |
| Modify | `src/app/api/upload/confirm/route.ts` | Trigger processing immediately |
| Modify | `src/app/dashboard/distribute/new/distribution-form.tsx` | Two-path flow with AI recommendation UI |
| Modify | `src/app/dashboard/distribute/new/actions.ts` | Support AI analysis path |
| Create | `src/app/api/distribute/analyze/route.ts` | Endpoint for AI analysis (extract → transcribe → recommend) |
| Modify | `Dockerfile` | Add ffmpeg |

---

### Task 1: Add ffmpeg to Dockerfile and Install Dependencies

**Files:**
- Modify: `Dockerfile`
- Modify: `package.json`

- [ ] **Step 1: Add ffmpeg to the runner stage of the Dockerfile**

In `Dockerfile`, add this line after the `RUN adduser` line and before `COPY --from=builder /app/public ./public`:

```dockerfile
RUN apk add --no-cache ffmpeg
```

- [ ] **Step 2: Install Deepgram SDK**

Run:
```bash
npm install @deepgram/sdk
```

- [ ] **Step 3: Verify ffmpeg is available locally for testing**

Run:
```bash
which ffmpeg
```

If not installed locally, install with `brew install ffmpeg` (macOS).

- [ ] **Step 4: Commit**

```bash
git add Dockerfile package.json package-lock.json
git commit -m "chore: add ffmpeg to Dockerfile and install Deepgram SDK"
```

---

### Task 2: Real Audio Extraction with ffmpeg

**Files:**
- Modify: `src/lib/jobs/audio-extractor.ts`

- [ ] **Step 1: Replace the placeholder with real ffmpeg implementation**

Replace the entire contents of `src/lib/jobs/audio-extractor.ts`:

```typescript
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createWriteStream } from "node:fs";
import { unlink, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { generateSignedDownloadUrl } from "@/lib/gcs";
import { Storage } from "@google-cloud/storage";

const execFileAsync = promisify(execFile);

/**
 * Extract audio track from a video stored in GCS.
 *
 * Downloads the video to a temp file, runs ffmpeg to extract audio as mp3,
 * uploads the mp3 back to GCS, and cleans up temp files.
 *
 * @param gcsVideoPath - GCS path of the source video file
 * @returns GCS path of the extracted audio file
 */
export async function extractAudio(gcsVideoPath: string): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), "swm-audio-"));
  const tempVideoPath = join(tempDir, "input.mp4");
  const tempAudioPath = join(tempDir, "output.mp3");
  const gcsAudioPath = gcsVideoPath.replace(/\.[^.]+$/, ".mp3");

  try {
    // Download video from GCS
    console.log(`[audio-extractor] Downloading video from GCS: ${gcsVideoPath}`);
    const downloadUrl = await generateSignedDownloadUrl(gcsVideoPath);
    const response = await fetch(downloadUrl);
    if (!response.ok || !response.body) {
      throw new Error(`Failed to download video: ${response.status}`);
    }
    const fileStream = createWriteStream(tempVideoPath);
    await pipeline(Readable.fromWeb(response.body as any), fileStream);

    // Extract audio with ffmpeg
    console.log("[audio-extractor] Extracting audio with ffmpeg...");
    await execFileAsync("ffmpeg", [
      "-i", tempVideoPath,
      "-vn",           // no video
      "-acodec", "libmp3lame",
      "-ab", "192k",   // 192kbps bitrate
      "-ar", "44100",  // 44.1kHz sample rate
      "-y",            // overwrite output
      tempAudioPath,
    ], { timeout: 30 * 60 * 1000 }); // 30 minute timeout

    // Upload audio to GCS
    console.log(`[audio-extractor] Uploading audio to GCS: ${gcsAudioPath}`);
    const credentialsJson = process.env.GCS_CREDENTIALS_JSON;
    const bucketName = process.env.GCS_BUCKET_NAME!;
    const storage = credentialsJson
      ? new Storage({ credentials: JSON.parse(credentialsJson) })
      : new Storage({ keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS });

    await storage.bucket(bucketName).upload(tempAudioPath, {
      destination: gcsAudioPath,
      metadata: { contentType: "audio/mpeg" },
    });

    console.log("[audio-extractor] Audio extraction complete.");
    return gcsAudioPath;
  } finally {
    // Clean up temp files
    await unlink(tempVideoPath).catch(() => {});
    await unlink(tempAudioPath).catch(() => {});
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run:
```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/jobs/audio-extractor.ts
git commit -m "feat: real audio extraction with ffmpeg"
```

---

### Task 3: Deepgram Transcription Client

**Files:**
- Create: `src/lib/transcription.ts`

- [ ] **Step 1: Create the transcription module**

Create `src/lib/transcription.ts`:

```typescript
import "server-only";

import { generateSignedDownloadUrl } from "@/lib/gcs";

export interface TranscriptSegment {
  start: number;   // seconds
  end: number;     // seconds
  text: string;
  speaker?: number; // speaker ID from diarization
}

export interface TranscriptionResult {
  fullText: string;
  segments: TranscriptSegment[];
  language: string;
  duration: number; // total audio duration in seconds
}

/**
 * Transcribe an audio file stored in GCS using Deepgram.
 *
 * @param gcsAudioPath - GCS path of the audio file
 * @returns Transcription result with timestamped segments
 */
export async function transcribeAudio(
  gcsAudioPath: string
): Promise<TranscriptionResult> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPGRAM_API_KEY is not set.");
  }

  const downloadUrl = await generateSignedDownloadUrl(gcsAudioPath);

  console.log(`[transcription] Transcribing: ${gcsAudioPath}`);

  const response = await fetch(
    "https://api.deepgram.com/v1/listen?" +
      new URLSearchParams({
        model: "nova-3",
        smart_format: "true",
        detect_language: "true",
        diarize: "true",
        paragraphs: "true",
        utterances: "true",
      }),
    {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: downloadUrl }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Deepgram API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const result = data.results?.channels?.[0]?.alternatives?.[0];

  if (!result) {
    throw new Error("Deepgram returned no transcription results.");
  }

  const segments: TranscriptSegment[] = (result.paragraphs?.paragraphs ?? []).map(
    (p: any) => ({
      start: p.start,
      end: p.end,
      text: p.sentences?.map((s: any) => s.text).join(" ") ?? "",
      speaker: p.speaker,
    })
  );

  const detectedLanguage =
    data.results?.channels?.[0]?.detected_language ?? "en";
  const duration = data.metadata?.duration ?? 0;

  console.log(
    `[transcription] Complete: ${segments.length} segments, language: ${detectedLanguage}, duration: ${Math.round(duration)}s`
  );

  return {
    fullText: result.transcript ?? "",
    segments,
    language: detectedLanguage,
    duration,
  };
}

/**
 * Format transcript segments as timestamped text for AI analysis.
 */
export function formatTranscriptForAI(segments: TranscriptSegment[]): string {
  return segments
    .map((s) => {
      const timestamp = formatTimestamp(s.start);
      const speaker = s.speaker !== undefined ? `[Speaker ${s.speaker}]` : "";
      return `[${timestamp}] ${speaker} ${s.text}`;
    })
    .join("\n");
}

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}
```

- [ ] **Step 2: Verify it compiles**

Run:
```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/transcription.ts
git commit -m "feat: add Deepgram transcription client"
```

---

### Task 4: YouTube Video Upload

**Files:**
- Create: `src/lib/platforms/youtube.ts`

- [ ] **Step 1: Create the YouTube upload module**

Create `src/lib/platforms/youtube.ts`:

```typescript
import { getYouTubeAccessToken } from "@/lib/analytics/credentials";

const YOUTUBE_UPLOAD_URL =
  "https://www.googleapis.com/upload/youtube/v3/videos";
const YOUTUBE_API_URL = "https://www.googleapis.com/youtube/v3";

export interface YouTubeUploadParams {
  wpShowId: number;
  title: string;
  description: string;
  tags: string[];
  privacy: "public" | "unlisted" | "private";
  categoryId?: string; // YouTube category ID, defaults to "22" (People & Blogs)
  videoFilePath: string; // local temp file path
}

export interface YouTubeUploadResult {
  videoId: string;
  videoUrl: string;
}

/**
 * Upload a video to YouTube using the Data API v3 resumable upload protocol.
 */
export async function uploadToYouTube(
  params: YouTubeUploadParams
): Promise<YouTubeUploadResult> {
  const { wpShowId, title, description, tags, privacy, categoryId, videoFilePath } = params;

  const accessToken = await getYouTubeAccessToken(wpShowId);
  if (!accessToken) {
    throw new Error(
      `No valid YouTube credentials found for show ${wpShowId}. Please connect YouTube in Admin > Credentials.`
    );
  }

  // 1. Initiate resumable upload session
  console.log(`[youtube] Initiating upload for "${title}"`);

  const metadata = {
    snippet: {
      title,
      description,
      tags,
      categoryId: categoryId ?? "22",
    },
    status: {
      privacyStatus: privacy,
      selfDeclaredMadeForKids: false,
    },
  };

  const initResponse = await fetch(
    `${YOUTUBE_UPLOAD_URL}?uploadType=resumable&part=snippet,status`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "video/*",
      },
      body: JSON.stringify(metadata),
    }
  );

  if (!initResponse.ok) {
    const errorText = await initResponse.text();
    throw new Error(
      `YouTube upload initiation failed (${initResponse.status}): ${errorText}`
    );
  }

  const uploadUrl = initResponse.headers.get("Location");
  if (!uploadUrl) {
    throw new Error("YouTube did not return a resumable upload URL.");
  }

  // 2. Upload video file
  console.log("[youtube] Uploading video file...");

  const { createReadStream, statSync } = await import("node:fs");
  const fileSize = statSync(videoFilePath).size;
  const fileStream = createReadStream(videoFilePath);
  const { Readable } = await import("node:stream");

  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Length": fileSize.toString(),
      "Content-Type": "video/*",
    },
    body: Readable.toWeb(fileStream) as any,
    // @ts-expect-error -- Node fetch supports duplex
    duplex: "half",
  });

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    throw new Error(
      `YouTube video upload failed (${uploadResponse.status}): ${errorText}`
    );
  }

  const videoData = await uploadResponse.json();
  const videoId = videoData.id;

  if (!videoId) {
    throw new Error("YouTube upload succeeded but no video ID was returned.");
  }

  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  console.log(`[youtube] Upload complete: ${videoUrl}`);

  return { videoId, videoUrl };
}

/**
 * Add a video to a YouTube playlist.
 */
export async function addToPlaylist(
  wpShowId: number,
  playlistId: string,
  videoId: string
): Promise<void> {
  const accessToken = await getYouTubeAccessToken(wpShowId);
  if (!accessToken) return;

  const response = await fetch(
    `${YOUTUBE_API_URL}/playlistItems?part=snippet`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        snippet: {
          playlistId,
          resourceId: { kind: "youtube#video", videoId },
        },
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error(
      `[youtube] Failed to add to playlist ${playlistId}: ${errorText}`
    );
    // Non-fatal — don't throw
  } else {
    console.log(`[youtube] Added to playlist ${playlistId}`);
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run:
```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/platforms/youtube.ts
git commit -m "feat: add YouTube video upload via Data API v3"
```

---

### Task 5: Transistor Episode Upload

**Files:**
- Create: `src/lib/platforms/transistor.ts`

- [ ] **Step 1: Create the Transistor upload module**

Create `src/lib/platforms/transistor.ts`:

```typescript
import {
  getTransistorApiKey,
  resolvePlatformId,
  parseTransistorShowId,
} from "@/lib/analytics/credentials";
import { generateSignedDownloadUrl } from "@/lib/gcs";

const BASE_URL = "https://api.transistor.fm/v1";

export interface TransistorUploadParams {
  wpShowId: number;
  title: string;
  description: string;
  seasonNumber?: number;
  episodeNumber?: number;
  gcsAudioPath: string; // GCS path to the extracted mp3
}

export interface TransistorUploadResult {
  episodeId: string;
  episodeUrl: string;
}

/**
 * Create an episode on Transistor and upload the audio file.
 */
export async function uploadToTransistor(
  params: TransistorUploadParams
): Promise<TransistorUploadResult> {
  const { wpShowId, title, description, seasonNumber, episodeNumber, gcsAudioPath } =
    params;

  const apiKey = await getTransistorApiKey(wpShowId);
  if (!apiKey) {
    throw new Error(
      `No Transistor API key found for show ${wpShowId}. Please add it in Admin > Credentials.`
    );
  }

  const showLink = await resolvePlatformId(wpShowId, "transistor_show");
  if (!showLink) {
    throw new Error(
      `No Transistor show linked for WP show ${wpShowId}. Please configure it in Admin > Shows.`
    );
  }
  const transistorShowId = parseTransistorShowId(showLink);

  // 1. Get an authorized upload URL from Transistor
  console.log(`[transistor] Requesting upload URL for "${title}"`);

  const authorizeRes = await fetch(`${BASE_URL}/episodes/authorize_upload`, {
    method: "GET",
    headers: { "x-api-key": apiKey },
  });

  if (!authorizeRes.ok) {
    const errorText = await authorizeRes.text();
    throw new Error(
      `Transistor authorize_upload failed (${authorizeRes.status}): ${errorText}`
    );
  }

  const authorizeData = await authorizeRes.json();
  const uploadUrl = authorizeData.data?.attributes?.upload_url;
  const audioUrl = authorizeData.data?.attributes?.content_url;

  if (!uploadUrl || !audioUrl) {
    throw new Error("Transistor did not return upload URL.");
  }

  // 2. Upload audio file to Transistor's S3
  console.log("[transistor] Uploading audio file...");

  const downloadUrl = await generateSignedDownloadUrl(gcsAudioPath);
  const audioResponse = await fetch(downloadUrl);
  if (!audioResponse.ok || !audioResponse.body) {
    throw new Error("Failed to download audio from GCS.");
  }

  const audioBuffer = await audioResponse.arrayBuffer();

  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "audio/mpeg" },
    body: audioBuffer,
  });

  if (!uploadRes.ok) {
    throw new Error(`Transistor audio upload failed (${uploadRes.status})`);
  }

  // 3. Create the episode with the uploaded audio URL
  console.log("[transistor] Creating episode...");

  const episodePayload: Record<string, unknown> = {
    episode: {
      show_id: transistorShowId,
      title,
      summary: description,
      audio_url: audioUrl,
      status: "published",
    },
  };

  if (seasonNumber) {
    (episodePayload.episode as Record<string, unknown>).season = seasonNumber;
  }
  if (episodeNumber) {
    (episodePayload.episode as Record<string, unknown>).number = episodeNumber;
  }

  const createRes = await fetch(`${BASE_URL}/episodes`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(episodePayload),
  });

  if (!createRes.ok) {
    const errorText = await createRes.text();
    throw new Error(
      `Transistor episode creation failed (${createRes.status}): ${errorText}`
    );
  }

  const createData = await createRes.json();
  const episodeId = createData.data?.id;
  const shareUrl =
    createData.data?.attributes?.share_url ??
    `https://share.transistor.fm/s/${episodeId}`;

  console.log(`[transistor] Episode created: ${shareUrl}`);

  return { episodeId: String(episodeId), episodeUrl: shareUrl };
}
```

- [ ] **Step 2: Verify it compiles**

Run:
```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/platforms/transistor.ts
git commit -m "feat: add Transistor episode creation and audio upload"
```

---

### Task 6: WordPress Episode Publisher

**Files:**
- Create: `src/lib/platforms/wordpress.ts`

- [ ] **Step 1: Create the WordPress publisher module**

Create `src/lib/platforms/wordpress.ts`:

```typescript
import { createPost } from "@/lib/wordpress/client";
import { ContentType } from "@/lib/constants";

export interface WordPressPublishParams {
  wpShowId: number;
  title: string;
  description: string;
  chapters?: string; // formatted chapter text
  youtubeUrl: string;
  episodeNumber?: number;
  seasonNumber?: number;
  durationMinutes?: number;
  status: "publish" | "draft" | "future";
  scheduledDate?: string; // ISO date for future posts
  portalUserId: string;
}

export interface WordPressPublishResult {
  postId: number;
  postUrl: string;
}

/**
 * Create a WordPress episode post with YouTube embed.
 */
export async function publishToWordPress(
  params: WordPressPublishParams
): Promise<WordPressPublishResult> {
  const {
    wpShowId,
    title,
    description,
    chapters,
    youtubeUrl,
    episodeNumber,
    seasonNumber,
    durationMinutes,
    status,
    scheduledDate,
    portalUserId,
  } = params;

  // Build content: description + chapters (if available)
  let content = description;
  if (chapters) {
    content += `\n\n<h3>Chapters</h3>\n<pre>${chapters}</pre>`;
  }

  console.log(`[wordpress] Creating episode post: "${title}"`);

  const payload = {
    title,
    content,
    status,
    ...(status === "future" && scheduledDate ? { date: scheduledDate } : {}),
    meta: {
      _swm_portal_user_id: portalUserId,
      _swm_show_id: wpShowId,
      _swm_youtube_url: youtubeUrl,
      ...(episodeNumber !== undefined
        ? { _swm_episode_number: episodeNumber }
        : {}),
      ...(seasonNumber !== undefined
        ? { _swm_season_number: seasonNumber }
        : {}),
      ...(durationMinutes !== undefined
        ? { _swm_duration_minutes: durationMinutes }
        : {}),
    },
  };

  const post = await createPost(ContentType.EPISODE, payload);

  console.log(`[wordpress] Episode post created: ${post.link}`);

  return { postId: post.id, postUrl: post.link };
}
```

- [ ] **Step 2: Verify it compiles**

Run:
```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/platforms/wordpress.ts
git commit -m "feat: add WordPress episode publisher"
```

---

### Task 7: Admin Error Notifications

**Files:**
- Modify: `src/lib/notifications.ts`

- [ ] **Step 1: Add the distribution error notification function**

Add to the end of `src/lib/notifications.ts` (after the existing `sendStakeholderNotification` function):

```typescript
interface DistributionErrorParams {
  jobTitle: string;
  showName: string;
  producerName: string;
  failures: { platform: string; error: string }[];
  jobUrl: string;
}

export async function sendDistributionErrorNotification({
  jobTitle,
  showName,
  producerName,
  failures,
  jobUrl,
}: DistributionErrorParams): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(
      "[notifications] RESEND_API_KEY is not set — skipping error notification."
    );
    return;
  }

  const { Resend } = await import("resend");
  const resend = new Resend(apiKey);

  const failureRows = failures
    .map(
      (f) =>
        `<tr>
          <td style="padding: 8px; color: #111; border-bottom: 1px solid #eee;">${f.platform}</td>
          <td style="padding: 8px; color: #dc2626; border-bottom: 1px solid #eee;">${f.error}</td>
        </tr>`
    )
    .join("");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
      <h2 style="margin: 0 0 16px; font-size: 20px; color: #dc2626;">
        Distribution Failed
      </h2>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
        <tr>
          <td style="padding: 8px 0; color: #666; width: 120px;">Episode</td>
          <td style="padding: 8px 0; color: #111; font-weight: 600;">${jobTitle}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">Show</td>
          <td style="padding: 8px 0; color: #111;">${showName}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">Submitted By</td>
          <td style="padding: 8px 0; color: #111;">${producerName}</td>
        </tr>
      </table>
      <h3 style="margin: 16px 0 8px; font-size: 14px; color: #111;">Failures</h3>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr>
          <th style="padding: 8px; text-align: left; color: #666; border-bottom: 2px solid #eee;">Platform</th>
          <th style="padding: 8px; text-align: left; color: #666; border-bottom: 2px solid #eee;">Error</th>
        </tr>
        ${failureRows}
      </table>
      <a href="${jobUrl}" style="display: inline-block; background: #111; color: #fff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-size: 14px; font-weight: 500;">
        View Job Details
      </a>
    </div>
  `;

  try {
    await resend.emails.send({
      from: "SWM Producer Portal <notifications@stolenwatermedia.com>",
      to: ["bret@stolenwatermedia.com"],
      subject: `Distribution failed — ${jobTitle}`,
      html,
    });
  } catch (error) {
    console.error(
      "[notifications] Failed to send distribution error email:",
      error
    );
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run:
```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/notifications.ts
git commit -m "feat: add admin error notification for distribution failures"
```

---

### Task 8: Rewrite AI Processor with Transcript-Based Prompts

**Files:**
- Modify: `src/lib/jobs/ai-processor.ts`

- [ ] **Step 1: Rewrite the AI processor with improved prompts**

Replace the entire contents of `src/lib/jobs/ai-processor.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";

export type AiSuggestionType = "chapters" | "summary" | "blog";

interface AnalysisContext {
  title: string;
  description?: string;
  transcript?: string; // timestamped transcript text
  language?: string;
}

let _client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

function buildChapterPrompt(ctx: AnalysisContext): string {
  if (!ctx.transcript) {
    return [
      "You are helping a podcast producer create chapter markers for an episode.",
      `Episode title: "${ctx.title}"`,
      `Description: ${ctx.description ?? "N/A"}`,
      "",
      "Based on the title and description, suggest a logical chapter structure.",
      "Format each chapter as: HH:MM:SS - Chapter Title",
      "Include a brief one-sentence description for each chapter.",
    ].join("\n");
  }

  return [
    "You are helping a podcast producer create timestamped chapter markers for an episode.",
    "Analyze the timestamped transcript below and identify natural topic breaks.",
    "Format each chapter as: HH:MM:SS - Chapter Title",
    "Use the actual timestamps from the transcript. Aim for chapters every 5-15 minutes depending on topic changes.",
    "Include a brief one-sentence description for each chapter.",
    "",
    `Episode title: "${ctx.title}"`,
    "",
    "Transcript:",
    ctx.transcript,
  ].join("\n");
}

function buildSummaryPrompt(ctx: AnalysisContext): string {
  const source = ctx.transcript
    ? `Transcript:\n${ctx.transcript}`
    : `Title: "${ctx.title}"\nDescription: ${ctx.description ?? "N/A"}`;

  return [
    "You are helping a podcast producer write an episode summary for podcast platforms (Apple Podcasts, Spotify, YouTube).",
    "Write a compelling 2-4 sentence summary that:",
    "- Hooks the listener with what they'll learn or experience",
    "- Mentions key topics or guests",
    "- Is optimized for search discoverability",
    "- Uses plain text only, no markdown",
    ctx.language === "es"
      ? "- Write the summary in Spanish since the episode is in Spanish"
      : "",
    "",
    source,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildBlogPrompt(ctx: AnalysisContext): string {
  const source = ctx.transcript
    ? `Transcript:\n${ctx.transcript}`
    : `Title: "${ctx.title}"\nDescription: ${ctx.description ?? "N/A"}`;

  return [
    "You are an SEO content strategist analyzing a podcast episode to find companion blog post opportunities.",
    "",
    "Your goal: identify 2-3 topics that were MENTIONED but NOT deeply explored in the episode.",
    "These topics should be:",
    "- Tangential to the episode content, not a retelling of it",
    "- Interesting enough to stand alone as a blog post",
    "- Likely to attract search engine and AI traffic",
    "- Deep enough to write 800-1200 words about",
    "",
    "For each suggestion, provide:",
    "1. A compelling, SEO-optimized blog post title",
    "2. A 2-3 sentence description of what the post would cover and why it's valuable",
    "3. 5-8 target SEO keywords",
    "4. How it connects to the episode (so we can cross-link)",
    "",
    "DO NOT suggest posts that simply summarize or recap the episode.",
    "DO suggest posts that a listener would want to read AFTER hearing the episode to learn more about something that caught their interest.",
    "",
    source,
  ].join("\n");
}

/**
 * Generate AI suggestions for a distribution job.
 *
 * @param jobId - The distribution job ID
 * @param transcript - Optional timestamped transcript text
 * @param language - Optional detected language code
 * @param types - Which suggestion types to generate (defaults to all)
 */
export async function generateAiSuggestions(
  jobId: string,
  transcript?: string | null,
  language?: string | null,
  types?: AiSuggestionType[]
): Promise<void> {
  const client = getClient();

  if (!client) {
    console.warn(
      "[ai-processor] ANTHROPIC_API_KEY is not set. Skipping AI suggestions."
    );
    return;
  }

  const job = await db.distributionJob.findUnique({ where: { id: jobId } });
  if (!job) {
    console.error(`[ai-processor] Job ${jobId} not found.`);
    return;
  }

  const metadata = job.metadata as Record<string, unknown>;
  const ctx: AnalysisContext = {
    title: job.title,
    description: (metadata.description as string) ?? undefined,
    transcript: transcript ?? undefined,
    language: language ?? undefined,
  };

  const typesToGenerate = types ?? ["chapters", "summary", "blog"];

  const suggestionConfigs: { type: AiSuggestionType; prompt: string }[] = [];

  if (typesToGenerate.includes("chapters")) {
    suggestionConfigs.push({ type: "chapters", prompt: buildChapterPrompt(ctx) });
  }
  if (typesToGenerate.includes("summary")) {
    suggestionConfigs.push({ type: "summary", prompt: buildSummaryPrompt(ctx) });
  }
  if (typesToGenerate.includes("blog")) {
    suggestionConfigs.push({ type: "blog", prompt: buildBlogPrompt(ctx) });
  }

  const results = await Promise.allSettled(
    suggestionConfigs.map(async ({ type, prompt }) => {
      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      });

      const textBlock = response.content.find((b) => b.type === "text");
      const content = textBlock ? textBlock.text : "";

      // Upsert: replace existing suggestion of same type for this job
      await db.aiSuggestion.upsert({
        where: {
          // Use a raw query since there's no compound unique on jobId+type
          // Fall back to create
          id: (
            await db.aiSuggestion.findFirst({
              where: { jobId, type },
              select: { id: true },
            })
          )?.id ?? "nonexistent",
        },
        create: { jobId, type, content, accepted: false },
        update: { content, accepted: false },
      });

      console.log(`[ai-processor] Generated "${type}" for job ${jobId}`);
    })
  );

  for (const result of results) {
    if (result.status === "rejected") {
      console.error("[ai-processor] Failed:", result.reason);
    }
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run:
```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/jobs/ai-processor.ts
git commit -m "feat: rewrite AI prompts for transcript-based analysis"
```

---

### Task 9: Rewrite Job Processor with Real Platform Uploads

**Files:**
- Modify: `src/lib/jobs/processor.ts`

- [ ] **Step 1: Replace the processor with real platform integrations**

Replace the entire contents of `src/lib/jobs/processor.ts`:

```typescript
import { db } from "@/lib/db";
import { generateAiSuggestions } from "./ai-processor";
import { extractAudio } from "./audio-extractor";
import { uploadToYouTube, addToPlaylist } from "@/lib/platforms/youtube";
import { uploadToTransistor } from "@/lib/platforms/transistor";
import { publishToWordPress } from "@/lib/platforms/wordpress";
import { sendDistributionErrorNotification } from "@/lib/notifications";
import { resolvePlatformId } from "@/lib/analytics/credentials";
import { generateSignedDownloadUrl } from "@/lib/gcs";
import { createWriteStream } from "node:fs";
import { unlink, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

export interface ProcessingResult {
  jobId: string;
  status: "completed" | "awaiting_review" | "failed";
  platformResults: {
    platform: string;
    status: "completed" | "failed";
    error?: string;
  }[];
}

/**
 * Process a specific distribution job by ID.
 * Uploads to platforms in dependency order:
 *   1. YouTube (first — WordPress needs the video URL)
 *   2. Transistor (parallel-safe, uses extracted audio)
 *   3. WordPress (last — needs YouTube URL for embed)
 */
export async function processJob(jobId: string): Promise<ProcessingResult> {
  const job = await db.distributionJob.findUnique({
    where: { id: jobId },
    include: {
      platforms: true,
    },
  });

  if (!job) {
    throw new Error(`Job ${jobId} not found.`);
  }

  // Mark as processing
  await db.distributionJob.update({
    where: { id: jobId },
    data: { status: "processing" },
  });

  console.log(
    `[processor] Processing job ${job.id}: "${job.title}" (${job.platforms.length} platforms)`
  );

  const metadata = job.metadata as Record<string, unknown>;
  const platformResults: ProcessingResult["platformResults"] = [];

  // Extract audio if needed (for Transistor)
  let gcsAudioPath: string | null = null;
  const needsAudio = job.platforms.some((p) => p.platform === "transistor");
  if (needsAudio && job.gcsPath) {
    try {
      gcsAudioPath = await extractAudio(job.gcsPath);
    } catch (error) {
      console.error("[processor] Audio extraction failed:", error);
      // Mark Transistor as failed but continue with other platforms
      const transistorPlatform = job.platforms.find(
        (p) => p.platform === "transistor"
      );
      if (transistorPlatform) {
        const errMsg =
          error instanceof Error ? error.message : "Audio extraction failed";
        await db.distributionJobPlatform.update({
          where: { id: transistorPlatform.id },
          data: { status: "failed", error: errMsg },
        });
        platformResults.push({
          platform: "transistor",
          status: "failed",
          error: errMsg,
        });
      }
    }
  }

  // Download video to temp file (for YouTube upload)
  let tempVideoPath: string | null = null;
  const needsYouTube = job.platforms.some((p) => p.platform === "youtube");
  if (needsYouTube && job.gcsPath) {
    try {
      const tempDir = await mkdtemp(join(tmpdir(), "swm-yt-"));
      tempVideoPath = join(tempDir, "video.mp4");
      const downloadUrl = await generateSignedDownloadUrl(job.gcsPath);
      const response = await fetch(downloadUrl);
      if (!response.ok || !response.body) {
        throw new Error(`Failed to download video: ${response.status}`);
      }
      const fileStream = createWriteStream(tempVideoPath);
      await pipeline(Readable.fromWeb(response.body as any), fileStream);
    } catch (error) {
      console.error("[processor] Video download failed:", error);
      tempVideoPath = null;
    }
  }

  // --- Phase 1: YouTube (must complete first for WordPress) ---
  let youtubeUrl: string | null = null;
  let youtubeVideoId: string | null = null;
  const youtubePlatform = job.platforms.find((p) => p.platform === "youtube");

  if (youtubePlatform) {
    await db.distributionJobPlatform.update({
      where: { id: youtubePlatform.id },
      data: { status: "uploading" },
    });

    try {
      if (!tempVideoPath) {
        throw new Error("Video file not available for YouTube upload.");
      }

      const description = (metadata.description as string) ?? "";
      const chapters = (metadata.chapters as string) ?? "";
      const fullDescription = chapters
        ? `${description}\n\n${chapters}`
        : description;
      const tags = (metadata.tags as string[]) ?? [];
      const isDraft = (metadata.isDraft as boolean) ?? false;

      const result = await uploadToYouTube({
        wpShowId: job.wpShowId,
        title: job.title,
        description: fullDescription,
        tags,
        privacy: isDraft ? "unlisted" : "public",
        videoFilePath: tempVideoPath,
      });

      youtubeUrl = result.videoUrl;
      youtubeVideoId = result.videoId;

      await db.distributionJobPlatform.update({
        where: { id: youtubePlatform.id },
        data: {
          status: "completed",
          externalId: result.videoId,
          externalUrl: result.videoUrl,
          completedAt: new Date(),
        },
      });

      // Add to show playlist if configured
      const playlistUrl = await resolvePlatformId(
        job.wpShowId,
        "youtube_playlist"
      );
      if (playlistUrl && youtubeVideoId) {
        const playlistId = playlistUrl.split("list=").pop() ?? playlistUrl;
        await addToPlaylist(job.wpShowId, playlistId, youtubeVideoId);
      }

      platformResults.push({ platform: "youtube", status: "completed" });
    } catch (error) {
      const errMsg =
        error instanceof Error ? error.message : "YouTube upload failed";
      console.error(`[processor] YouTube failed: ${errMsg}`);
      await db.distributionJobPlatform.update({
        where: { id: youtubePlatform.id },
        data: { status: "failed", error: errMsg },
      });
      platformResults.push({
        platform: "youtube",
        status: "failed",
        error: errMsg,
      });
    }
  }

  // Clean up temp video file
  if (tempVideoPath) {
    await unlink(tempVideoPath).catch(() => {});
  }

  // --- Phase 2: Transistor (independent of YouTube) ---
  const transistorPlatform = job.platforms.find(
    (p) => p.platform === "transistor"
  );
  // Only process if not already failed from audio extraction
  if (
    transistorPlatform &&
    !platformResults.some(
      (r) => r.platform === "transistor" && r.status === "failed"
    )
  ) {
    await db.distributionJobPlatform.update({
      where: { id: transistorPlatform.id },
      data: { status: "uploading" },
    });

    try {
      if (!gcsAudioPath) {
        throw new Error("Audio file not available for Transistor upload.");
      }

      const result = await uploadToTransistor({
        wpShowId: job.wpShowId,
        title: job.title,
        description: (metadata.description as string) ?? "",
        seasonNumber: (metadata.seasonNumber as number) ?? undefined,
        episodeNumber: (metadata.episodeNumber as number) ?? undefined,
        gcsAudioPath,
      });

      await db.distributionJobPlatform.update({
        where: { id: transistorPlatform.id },
        data: {
          status: "completed",
          externalId: result.episodeId,
          externalUrl: result.episodeUrl,
          completedAt: new Date(),
        },
      });

      platformResults.push({ platform: "transistor", status: "completed" });
    } catch (error) {
      const errMsg =
        error instanceof Error ? error.message : "Transistor upload failed";
      console.error(`[processor] Transistor failed: ${errMsg}`);
      await db.distributionJobPlatform.update({
        where: { id: transistorPlatform.id },
        data: { status: "failed", error: errMsg },
      });
      platformResults.push({
        platform: "transistor",
        status: "failed",
        error: errMsg,
      });
    }
  }

  // --- Phase 3: WordPress (needs YouTube URL) ---
  const websitePlatform = job.platforms.find((p) => p.platform === "website");
  if (websitePlatform) {
    await db.distributionJobPlatform.update({
      where: { id: websitePlatform.id },
      data: { status: "uploading" },
    });

    try {
      if (!youtubeUrl) {
        throw new Error(
          "YouTube URL not available. WordPress post requires the YouTube embed."
        );
      }

      const description = (metadata.description as string) ?? "";
      const chapters = (metadata.chapters as string) ?? "";
      const isDraft = (metadata.isDraft as boolean) ?? false;
      const scheduleMode = (metadata.scheduleMode as string) ?? "now";
      const scheduledAt = (metadata.scheduledAt as string) ?? undefined;

      const wpStatus: "publish" | "draft" | "future" = isDraft
        ? "draft"
        : scheduleMode === "schedule"
          ? "future"
          : "publish";

      const result = await publishToWordPress({
        wpShowId: job.wpShowId,
        title: job.title,
        description,
        chapters: chapters || undefined,
        youtubeUrl,
        status: wpStatus,
        scheduledDate: wpStatus === "future" ? scheduledAt : undefined,
        portalUserId: job.userId,
      });

      await db.distributionJobPlatform.update({
        where: { id: websitePlatform.id },
        data: {
          status: "completed",
          externalId: String(result.postId),
          externalUrl: result.postUrl,
          completedAt: new Date(),
        },
      });

      platformResults.push({ platform: "website", status: "completed" });
    } catch (error) {
      const errMsg =
        error instanceof Error ? error.message : "WordPress publish failed";
      console.error(`[processor] WordPress failed: ${errMsg}`);
      await db.distributionJobPlatform.update({
        where: { id: websitePlatform.id },
        data: { status: "failed", error: errMsg },
      });
      platformResults.push({
        platform: "website",
        status: "failed",
        error: errMsg,
      });
    }
  }

  // --- Handle any remaining platforms (Spotify, Apple — future) ---
  for (const p of job.platforms) {
    if (!platformResults.some((r) => r.platform === p.platform)) {
      await db.distributionJobPlatform.update({
        where: { id: p.id },
        data: { status: "failed", error: `Platform "${p.platform}" is not yet supported.` },
      });
      platformResults.push({
        platform: p.platform,
        status: "failed",
        error: `Platform "${p.platform}" is not yet supported.`,
      });
    }
  }

  // --- Determine final job status ---
  const allFailed = platformResults.every((r) => r.status === "failed");
  const anyFailed = platformResults.some((r) => r.status === "failed");

  const finalStatus = allFailed ? "failed" : "completed";

  await db.distributionJob.update({
    where: { id: job.id },
    data: { status: finalStatus },
  });

  // --- Send error notification if any platform failed ---
  if (anyFailed) {
    const user = await db.user.findUnique({
      where: { id: job.userId },
      select: { name: true },
    });

    // Resolve show name
    let showName = `Show #${job.wpShowId}`;
    try {
      const { getShow } = await import("@/lib/wordpress/client");
      const show = await getShow(job.wpShowId);
      showName = show.title.rendered;
    } catch {
      // Fall back to ID
    }

    const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

    await sendDistributionErrorNotification({
      jobTitle: job.title,
      showName,
      producerName: user?.name ?? "Unknown",
      failures: platformResults
        .filter((r) => r.status === "failed")
        .map((r) => ({ platform: r.platform, error: r.error ?? "Unknown error" })),
      jobUrl: `${baseUrl}/dashboard/distribute/${job.id}`,
    });
  }

  console.log(`[processor] Job ${job.id} ${finalStatus}.`);

  return { jobId: job.id, status: finalStatus, platformResults };
}
```

- [ ] **Step 2: Verify it compiles**

Run:
```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/jobs/processor.ts
git commit -m "feat: replace simulated uploads with real platform integrations"
```

---

### Task 10: Trigger Processing Immediately on Upload Confirm

**Files:**
- Modify: `src/app/api/upload/confirm/route.ts`

- [ ] **Step 1: Update confirm endpoint to trigger processing**

Replace the entire contents of `src/app/api/upload/confirm/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { processJob } from "@/lib/jobs/processor";

export async function POST(request: NextRequest) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { jobId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 }
    );
  }

  const { jobId } = body;
  if (!jobId) {
    return NextResponse.json(
      { error: "Missing required field: jobId." },
      { status: 400 }
    );
  }

  const job = await db.distributionJob.findUnique({
    where: { id: jobId },
    select: { id: true, userId: true, status: true, gcsPath: true, metadata: true },
  });

  if (!job) {
    return NextResponse.json(
      { error: "Distribution job not found." },
      { status: 404 }
    );
  }

  if (job.userId !== session.user.id && session.user.role !== "admin") {
    return NextResponse.json(
      { error: "You do not own this distribution job." },
      { status: 403 }
    );
  }

  if (job.status !== "uploading") {
    return NextResponse.json(
      { error: `Job is not in uploading state (current: ${job.status}).` },
      { status: 409 }
    );
  }

  if (!job.gcsPath) {
    return NextResponse.json(
      { error: "No file has been uploaded for this job." },
      { status: 400 }
    );
  }

  // Move to pending
  await db.distributionJob.update({
    where: { id: jobId },
    data: { status: "pending" },
  });

  // Check if this is a scheduled post
  const metadata = job.metadata as Record<string, unknown>;
  const scheduleMode = (metadata.scheduleMode as string) ?? "now";

  if (scheduleMode === "schedule") {
    // Leave as pending — a scheduled job cron will pick it up
    return NextResponse.json({ success: true, status: "scheduled" });
  }

  // Trigger processing immediately (non-blocking)
  processJob(jobId).catch((error) => {
    console.error(`[confirm] Background processing failed for job ${jobId}:`, error);
  });

  return NextResponse.json({ success: true, status: "processing" });
}
```

- [ ] **Step 2: Verify it compiles**

Run:
```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/upload/confirm/route.ts
git commit -m "feat: trigger distribution processing immediately on upload confirm"
```

---

### Task 11: AI Analysis API Endpoint

**Files:**
- Create: `src/app/api/distribute/analyze/route.ts`

- [ ] **Step 1: Create the analysis endpoint**

Create `src/app/api/distribute/analyze/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { extractAudio } from "@/lib/jobs/audio-extractor";
import { transcribeAudio, formatTranscriptForAI } from "@/lib/transcription";
import { generateAiSuggestions } from "@/lib/jobs/ai-processor";

/**
 * POST /api/distribute/analyze
 *
 * Triggers the AI analysis pipeline for a distribution job:
 * 1. Extract audio from video
 * 2. Transcribe via Deepgram
 * 3. Generate AI suggestions (summary, chapters, blog ideas)
 *
 * Returns the transcript and suggestions.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { jobId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { jobId } = body;
  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId." }, { status: 400 });
  }

  const job = await db.distributionJob.findUnique({
    where: { id: jobId },
    select: { id: true, userId: true, gcsPath: true, title: true, metadata: true },
  });

  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  if (job.userId !== session.user.id && session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  if (!job.gcsPath) {
    return NextResponse.json({ error: "No video uploaded." }, { status: 400 });
  }

  try {
    // 1. Extract audio
    console.log(`[analyze] Extracting audio for job ${jobId}`);
    const gcsAudioPath = await extractAudio(job.gcsPath);

    // 2. Transcribe
    console.log(`[analyze] Transcribing audio for job ${jobId}`);
    const { transcribeAudio: transcribe, formatTranscriptForAI: format } =
      await import("@/lib/transcription");
    const transcription = await transcribe(gcsAudioPath);
    const formattedTranscript = format(transcription.segments);

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
}
```

- [ ] **Step 2: Verify it compiles**

Run:
```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/distribute/analyze/route.ts
git commit -m "feat: add AI analysis endpoint for episode transcription and recommendations"
```

---

### Task 12: Distribution Form Two-Path Redesign

**Files:**
- Modify: `src/app/dashboard/distribute/new/distribution-form.tsx`

This is the largest UI change. The form needs to support two paths: manual description or AI-assisted.

- [ ] **Step 1: Rewrite the distribution form with two-path flow**

This is a large component. Replace the entire contents of `src/app/dashboard/distribute/new/distribution-form.tsx`. The key changes:

1. After video is selected, show two buttons: "I'll write my own description" and "Get AI recommendations"
2. Manual path: shows description textarea immediately
3. AI path: triggers upload + analysis pipeline, shows progress, then presents recommendations
4. Both paths converge at platform selection + publish mode
5. AI recommendations are editable before distribution

Due to the size of this component, the implementer should read the current file and the spec at `docs/superpowers/specs/2026-03-30-distribution-pipeline-design.md` section "Distribution Form Redesign" and "AI Recommendation Review UI" for full requirements.

Key state additions needed:
```typescript
type DescriptionMode = "manual" | "ai" | null;
const [descriptionMode, setDescriptionMode] = useState<DescriptionMode>(null);
const [analyzing, setAnalyzing] = useState(false);
const [analysisStep, setAnalysisStep] = useState("");
const [suggestions, setSuggestions] = useState<AiSuggestion[]>([]);
const [description, setDescription] = useState("");
const [chapters, setChapters] = useState("");
```

Key flow:
- When "Get AI recommendations" is clicked: upload video to GCS (existing flow), then call `POST /api/distribute/analyze` with the jobId
- Show progress: "Uploading video..." → "Extracting audio..." → "Transcribing..." → "Generating recommendations..."
- When analysis completes: populate `suggestions` state, show summary/chapters for editing
- Producer edits and accepts, then sees platform selection + distribute button
- On distribute: call `POST /api/upload/confirm` which triggers processing

The implementer should preserve all existing functionality (video upload, platform checkboxes, publish toggle) and add the two-path choice after video selection.

- [ ] **Step 2: Verify it compiles**

Run:
```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/distribute/new/distribution-form.tsx
git commit -m "feat: two-path distribution form with AI recommendation support"
```

---

### Task 13: Build and Deploy Verification

- [ ] **Step 1: Run the full build**

Run:
```bash
npm run build
```

Expected: Build succeeds with no errors. New routes should include `/api/distribute/analyze`.

- [ ] **Step 2: Commit any fixes found during build**

If the build reveals issues, fix them and commit:

```bash
git add -A
git commit -m "fix: address issues found during build verification"
```

- [ ] **Step 3: Push to deploy**

```bash
git push
```

Verify Railway deploys successfully. Check:
- The container starts with ffmpeg available
- Migration runner completes
- Server starts and healthcheck passes

- [ ] **Step 4: End-to-end verification checklist**

Test on the deployed app:
1. Manual path: create distribution with written description → verify YouTube, Transistor, WordPress all receive correct content
2. AI path: create distribution with "Get AI recommendations" → verify transcription completes, suggestions appear, editing works, distribution succeeds
3. Error case: create distribution targeting YouTube without valid credentials → verify admin email notification is sent
4. Scheduled post: create a scheduled distribution → verify it stays in "scheduled" status
