import { db } from "@/lib/db";
import { getTransistorApiKey, getYouTubeAccessToken } from "@/lib/analytics/credentials";
import { uploadBuffer } from "@/lib/gcs";
import { prepareForWordPress, prepareTransistorImageUrl } from "@/lib/image";
import { getPost, updatePost, uploadMedia } from "@/lib/wordpress/client";
import { ContentType } from "@/lib/constants";
import { extractYoutubeVideoId } from "@/lib/youtube-url";
import { mergeJobMetadata } from "./job-metadata";
import { errorMessage, recordDistributionIssue } from "./distribution-issues";

/**
 * Deferred thumbnail backfill.
 *
 * When a producer doesn't upload a thumbnail, the processor used to grab
 * YouTube's auto-generated one from i.ytimg.com seconds after the upload —
 * before YouTube had produced it — and fail silently. Transistor then got no
 * episode artwork and the website post no featured image, which is what the
 * verification emails kept flagging.
 *
 * This runs a few minutes AFTER distribution finishes (so publishing is never
 * delayed): it waits for YouTube to report thumbnails available (YouTube Data
 * API processingDetails, with backoff), stores the image in GCS, then sets the
 * website featured image and the Transistor episode artwork wherever they're
 * still missing. Every failure is logged and recorded on the job.
 */

const YOUTUBE_API_URL = "https://www.googleapis.com/youtube/v3";
const TRANSISTOR_API_URL = "https://api.transistor.fm/v1";

export const thumbnailBackfillConfig = {
  /** Delay after distribution completes before the first attempt. */
  initialDelayMs: 3 * 60_000,
  /** Waits before each poll for the YouTube thumbnail (≈15 min total). */
  pollDelaysMs: [0, 60_000, 2 * 60_000, 4 * 60_000, 8 * 60_000] as number[],
  sleep: (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve()),
};

export type BackfillStepResult = "set" | "already_set" | "skipped" | "failed";

export interface ThumbnailBackfillState {
  status: "pending" | "running" | "done" | "partial" | "failed" | "skipped";
  scheduledAt: string;
  startedAt?: string;
  completedAt?: string;
  attempts?: number;
  source?: "existing" | "youtube_api" | "youtube_public";
  steps?: Record<string, BackfillStepResult>;
  error?: string;
}

const running = new Set<string>();

// --------------------------- YouTube thumbnail ------------------------------

async function downloadImage(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

/**
 * Wait (with backoff) until YouTube has thumbnails for the video, then
 * download the best one. Uses the YouTube Data API when the show's token can
 * see the video; falls back to the public i.ytimg.com URLs otherwise (e.g.
 * live recordings uploaded to another channel).
 */
export async function waitForYouTubeThumbnail(
  videoId: string,
  wpShowId: number,
  options: { useApi?: boolean } = {}
): Promise<{ buffer: Buffer; url: string; source: "youtube_api" | "youtube_public"; attempts: number } | null> {
  let token: string | null = null;
  if (options.useApi !== false) {
    try {
      token = await getYouTubeAccessToken(wpShowId);
    } catch (err) {
      console.warn(`[thumbnail-backfill] could not get YouTube token for show ${wpShowId}:`, err);
    }
  }
  let useApi = !!token;
  let attempts = 0;

  for (const delay of thumbnailBackfillConfig.pollDelaysMs) {
    await thumbnailBackfillConfig.sleep(delay);
    attempts++;

    if (useApi) {
      try {
        const res = await fetch(
          `${YOUTUBE_API_URL}/videos?id=${encodeURIComponent(videoId)}&part=snippet,processingDetails`,
          { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) }
        );
        if (res.status === 401 || res.status === 403) {
          console.warn(`[thumbnail-backfill] YouTube API ${res.status} for ${videoId} — using public thumbnail URLs`);
          useApi = false;
        } else if (res.ok) {
          const data = (await res.json()) as {
            items?: Array<{
              snippet?: { thumbnails?: Record<string, { url: string } | undefined> };
              processingDetails?: { processingStatus?: string; thumbnailsAvailability?: string };
            }>;
          };
          const item = data.items?.[0];
          if (!item) {
            // Not visible to this token (other channel / private) — try public URLs.
            useApi = false;
          } else {
            const pd = item.processingDetails;
            const available =
              pd?.thumbnailsAvailability === "available" || pd?.processingStatus === "succeeded";
            if (available) {
              const thumbs = item.snippet?.thumbnails ?? {};
              for (const key of ["maxres", "standard", "high"]) {
                const url = thumbs[key]?.url;
                if (!url) continue;
                const buffer = await downloadImage(url);
                if (buffer) return { buffer, url, source: "youtube_api", attempts };
              }
            }
            console.log(
              `[thumbnail-backfill] ${videoId}: thumbnails not ready yet (attempt ${attempts}, availability=${pd?.thumbnailsAvailability ?? "?"})`
            );
            continue;
          }
        } else {
          console.warn(`[thumbnail-backfill] YouTube API ${res.status} for ${videoId} (attempt ${attempts})`);
          continue;
        }
      } catch (err) {
        console.warn(`[thumbnail-backfill] YouTube API error for ${videoId} (attempt ${attempts}):`, err);
        continue;
      }
    }

    // Public fallback (no token, or the API can't see this video).
    for (const name of ["maxresdefault", "sddefault", "hqdefault"]) {
      const url = `https://i.ytimg.com/vi/${videoId}/${name}.jpg`;
      const buffer = await downloadImage(url);
      if (buffer) return { buffer, url, source: "youtube_public", attempts };
    }
    console.log(`[thumbnail-backfill] ${videoId}: public thumbnail not available yet (attempt ${attempts})`);
  }
  return null;
}

// --------------------------- Platform updates -------------------------------

async function backfillWebsite(postId: number, gcsPath: string, title: string): Promise<BackfillStepResult> {
  const post = await getPost<{ id: number; featured_media: number }>(ContentType.EPISODE, postId, [
    "id",
    "featured_media",
  ]);
  if (post.featured_media) return "already_set";

  const processed = await prepareForWordPress(gcsPath);
  const filename = `${title.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 50) || "episode"}.jpg`;
  const file = new File([new Uint8Array(processed.buffer)], filename, { type: processed.contentType });
  const media = await uploadMedia(file, filename);
  await updatePost(ContentType.EPISODE, postId, { featured_media: media.id });
  console.log(`[thumbnail-backfill] website post ${postId}: featured image set (media ${media.id})`);
  return "set";
}

async function backfillTransistor(
  episodeId: string,
  credentialShowId: number,
  gcsPath: string
): Promise<BackfillStepResult> {
  const apiKey = await getTransistorApiKey(credentialShowId);
  if (!apiKey) throw new Error(`no Transistor API key for show ${credentialShowId}`);

  const getRes = await fetch(`${TRANSISTOR_API_URL}/episodes/${encodeURIComponent(episodeId)}`, {
    headers: { "x-api-key": apiKey },
    signal: AbortSignal.timeout(30_000),
  });
  if (!getRes.ok) throw new Error(`GET episode ${episodeId} → HTTP ${getRes.status}`);
  const data = (await getRes.json()) as { data?: { attributes?: { image_url?: string | null } } };
  if (data.data?.attributes?.image_url) return "already_set";

  const imageUrl = await prepareTransistorImageUrl(gcsPath);
  const patchRes = await fetch(`${TRANSISTOR_API_URL}/episodes/${encodeURIComponent(episodeId)}`, {
    method: "PATCH",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ episode: { image_url: imageUrl } }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!patchRes.ok) {
    const body = await patchRes.text().catch(() => "");
    throw new Error(`PATCH episode ${episodeId} → HTTP ${patchRes.status} ${body.slice(0, 200)}`);
  }
  console.log(`[thumbnail-backfill] Transistor episode ${episodeId}: artwork set`);
  return "set";
}

// --------------------------- Orchestration ----------------------------------

async function saveState(jobId: string, state: ThumbnailBackfillState) {
  await mergeJobMetadata(jobId, { thumbnailBackfill: state }).catch((err) =>
    console.error(`[thumbnail-backfill] could not persist state for job ${jobId}:`, err)
  );
}

/**
 * Run the backfill for one job. Safe to call more than once — every platform
 * step checks whether the image is already set first.
 */
export async function backfillThumbnail(jobId: string): Promise<ThumbnailBackfillState | null> {
  if (running.has(jobId)) return null;
  running.add(jobId);
  try {
    const job = await db.distributionJob.findUnique({
      where: { id: jobId },
      include: { platforms: true },
    });
    if (!job) return null;

    const meta = (job.metadata as Record<string, unknown> | null) ?? {};
    const prev = (meta.thumbnailBackfill as ThumbnailBackfillState | undefined) ?? {
      status: "pending",
      scheduledAt: new Date().toISOString(),
    };
    const state: ThumbnailBackfillState = {
      ...prev,
      status: "running",
      startedAt: new Date().toISOString(),
      steps: {},
    };
    await saveState(jobId, state);

    const completed = (name: string) =>
      job.platforms.find((p) => p.platform === name && p.status === "completed" && p.externalId);
    const youtube = job.platforms.find((p) => p.platform === "youtube" && p.externalId);
    const website = completed("website");
    const transistor = completed("transistor");
    const networkEpisodeId =
      typeof meta.networkTransistorEpisodeId === "string" ? meta.networkTransistorEpisodeId : null;

    if (!website && !transistor && !networkEpisodeId) {
      const done: ThumbnailBackfillState = {
        ...state,
        status: "skipped",
        completedAt: new Date().toISOString(),
        error: "no completed website/Transistor targets",
      };
      await saveState(jobId, done);
      return done;
    }

    // 1. Get a thumbnail into GCS (unless one already exists).
    let gcsPath = typeof meta.thumbnailGcsPath === "string" ? meta.thumbnailGcsPath : null;
    if (gcsPath) {
      state.source = "existing";
    } else {
      const existingYoutubeUrl = typeof meta.existingYoutubeUrl === "string" ? meta.existingYoutubeUrl : null;
      const videoId =
        youtube?.externalId || (existingYoutubeUrl ? extractYoutubeVideoId(existingYoutubeUrl) : null);
      if (!videoId) {
        const done: ThumbnailBackfillState = {
          ...state,
          status: "skipped",
          completedAt: new Date().toISOString(),
          error: "no thumbnail and no YouTube video",
        };
        await saveState(jobId, done);
        return done;
      }

      try {
        const thumb = await waitForYouTubeThumbnail(videoId, job.wpShowId, {
          useApi: !existingYoutubeUrl,
        });
        if (!thumb) throw new Error("YouTube thumbnail still unavailable after waiting ~15 minutes");
        state.attempts = thumb.attempts;
        state.source = thumb.source;
        gcsPath = await uploadBuffer(`yt-thumb-${videoId}.jpg`, thumb.buffer, "image/jpeg");
        await mergeJobMetadata(jobId, { thumbnailGcsPath: gcsPath });
        console.log(`[thumbnail-backfill] job ${jobId}: YouTube thumbnail saved to GCS (${thumb.source})`);
      } catch (err) {
        const msg = errorMessage(err);
        state.steps = { ...state.steps, thumbnail: "failed" };
        await recordDistributionIssue(jobId, {
          source: "thumbnail_backfill",
          platform: "youtube",
          severity: "warning",
          message: `Could not fetch the YouTube thumbnail for website/Transistor artwork: ${msg}`,
        });
        const done: ThumbnailBackfillState = {
          ...state,
          status: "failed",
          completedAt: new Date().toISOString(),
          error: msg,
        };
        await saveState(jobId, done);
        return done;
      }
    }

    // 2. Apply it wherever it's still missing. Each step is independent.
    const steps: Record<string, BackfillStepResult> = { ...state.steps };
    const targets: Array<{ key: string; platform: string; run: () => Promise<BackfillStepResult> }> = [];
    if (website) {
      targets.push({
        key: "website",
        platform: "website",
        run: () => backfillWebsite(Number(website.externalId), gcsPath!, job.title),
      });
    }
    if (transistor) {
      targets.push({
        key: "transistor",
        platform: "transistor",
        run: () => backfillTransistor(transistor.externalId!, job.wpShowId, gcsPath!),
      });
    }
    if (networkEpisodeId) {
      targets.push({
        key: "transistor_network",
        platform: "transistor_network",
        run: () => backfillTransistor(networkEpisodeId, 0, gcsPath!),
      });
    }

    for (const t of targets) {
      try {
        steps[t.key] = await t.run();
      } catch (err) {
        steps[t.key] = "failed";
        await recordDistributionIssue(jobId, {
          source: "thumbnail_backfill",
          platform: t.platform,
          severity: "warning",
          message: `Could not set ${t.platform === "website" ? "the website featured image" : "the Transistor episode artwork"}: ${errorMessage(err)}`,
        });
      }
    }

    const anyFailed = Object.values(steps).includes("failed");
    const done: ThumbnailBackfillState = {
      ...state,
      steps,
      status: anyFailed ? "partial" : "done",
      completedAt: new Date().toISOString(),
    };
    await saveState(jobId, done);
    console.log(`[thumbnail-backfill] job ${jobId}: ${done.status} ${JSON.stringify(steps)}`);
    return done;
  } catch (err) {
    console.error(`[thumbnail-backfill] job ${jobId} failed:`, err);
    await saveState(jobId, {
      status: "failed",
      scheduledAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      error: errorMessage(err),
    });
    return null;
  } finally {
    running.delete(jobId);
  }
}

function runLater(jobId: string, delayMs: number) {
  setTimeout(() => {
    backfillThumbnail(jobId).catch((err) =>
      console.error(`[thumbnail-backfill] job ${jobId} crashed:`, err)
    );
  }, delayMs).unref?.();
}

/**
 * Schedule the backfill a few minutes out (fire-and-forget). The pending state
 * is persisted so a restart can resume it (resumeThumbnailBackfills).
 */
export async function scheduleThumbnailBackfill(jobId: string): Promise<void> {
  await saveState(jobId, { status: "pending", scheduledAt: new Date().toISOString() });
  console.log(
    `[thumbnail-backfill] job ${jobId}: scheduled in ${Math.round(thumbnailBackfillConfig.initialDelayMs / 1000)}s`
  );
  runLater(jobId, thumbnailBackfillConfig.initialDelayMs);
}

/** Startup hook: resume backfills that were pending/running when the container died. */
export async function resumeThumbnailBackfills(): Promise<void> {
  const jobs = await db.distributionJob.findMany({
    where: {
      OR: [
        { metadata: { path: ["thumbnailBackfill", "status"], equals: "pending" } },
        { metadata: { path: ["thumbnailBackfill", "status"], equals: "running" } },
      ],
    },
    select: { id: true, metadata: true },
  });

  let i = 0;
  for (const job of jobs) {
    const state = ((job.metadata as Record<string, unknown>) ?? {}).thumbnailBackfill as
      | ThumbnailBackfillState
      | undefined;
    if (!state) continue;
    const age = Date.now() - Date.parse(state.scheduledAt);
    if (Number.isNaN(age) || age > 24 * 60 * 60 * 1000) {
      await saveState(job.id, { ...state, status: "skipped", error: "abandoned (older than 24h)" });
      continue;
    }
    const delay = Math.max(thumbnailBackfillConfig.initialDelayMs - age, 15_000 + i * 15_000);
    i++;
    console.log(`[thumbnail-backfill] Resuming backfill for job ${job.id} in ${Math.round(delay / 1000)}s`);
    runLater(job.id, delay);
  }
}
