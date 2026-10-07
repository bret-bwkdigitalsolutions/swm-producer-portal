import { execFile, spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { unlink, mkdtemp, readdir, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { createStorageClient } from "@/lib/gcs";
import { extractYoutubeVideoId } from "@/lib/youtube-url";
import { extractVimeoId } from "@/lib/vimeo-url";
import { getYoutubeCookiesForShow } from "@/lib/youtube-identity";
import { mediaToolTimeoutMs } from "./processing-runtime";

const execFileAsync = promisify(execFile);

/**
 * yt-dlp is its own process-group leader (`detached: true`) so a timeout
 * can SIGKILL the group. That also kills ffmpeg, which yt-dlp spawns for
 * the audio extract and would otherwise keep running after yt-dlp dies.
 */
function runDetachedYtDlp(
  args: string[],
  options: { timeoutMs: number; signal?: AbortSignal }
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new Error("yt-dlp aborted"));
      return;
    }

    const child = spawn("yt-dlp", args, {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const pid = child.pid;
    let stderr = "";
    let settled = false;

    const killGroup = () => {
      if (pid == null) {
        child.kill("SIGKILL");
        return;
      }
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          // already exited
        }
      }
    };

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };

    const onAbort = () => {
      killGroup();
      finish(new Error("yt-dlp aborted"));
    };

    const timer = setTimeout(() => {
      killGroup();
      finish(
        new Error(
          `yt-dlp timed out after ${Math.round(options.timeoutMs / 1000)} seconds`
        )
      );
    }, options.timeoutMs);

    options.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout?.resume();
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      if (stderr.length < 8000) stderr += chunk;
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (code === 0) {
        if (stderr) {
          console.warn(`[video-downloader] yt-dlp stderr: ${stderr}`);
        }
        finish();
        return;
      }
      finish(
        new Error(
          `yt-dlp exited with code ${code ?? "null"}${stderr ? `: ${stderr}` : ""}`
        )
      );
    });
  });
}

async function uploadLocalFile(
  storage: ReturnType<typeof createStorageClient>,
  bucketName: string,
  localPath: string,
  gcsPath: string,
  contentType: string,
  signal?: AbortSignal
): Promise<void> {
  if (!signal) {
    await storage.bucket(bucketName).upload(localPath, {
      destination: gcsPath,
      metadata: { contentType },
    });
    return;
  }
  if (signal.aborted) {
    throw new Error("GCS upload aborted");
  }

  const file = storage.bucket(bucketName).file(gcsPath);
  const readable = createReadStream(localPath);
  const writable = file.createWriteStream({
    resumable: false,
    metadata: { contentType },
  });
  const onAbort = () => {
    const error = new Error("GCS upload aborted");
    readable.destroy(error);
    writable.destroy(error);
  };
  signal.addEventListener("abort", onAbort);
  try {
    await pipeline(readable, writable);
  } catch (error) {
    await file.delete({ ignoreNotFound: true }).catch(() => {});
    if (signal.aborted) {
      throw new Error("GCS upload aborted");
    }
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/**
 * New yt-dlp output goes to the regional bucket when one is configured.
 * The caller records that name on the job so later reads do not guess.
 */
function destinationBucket(kind: "audio" | "video"): string {
  const bucket =
    process.env.GCS_UPLOAD_BUCKET_NAME?.trim() || process.env.GCS_BUCKET_NAME?.trim();
  if (!bucket) {
    const what = kind === "audio" ? "audio" : "video";
    throw new Error(
      `GCS_BUCKET_NAME is not set — cannot upload downloaded ${what}`
    );
  }
  return bucket;
}

/**
 * Build a `<source>-<id>` label for the GCS object name. Supports the two
 * sources the portal accepts (YouTube and Vimeo); returns null for anything
 * else so callers can reject the URL with a clear message.
 */
function deriveSourceLabel(videoUrl: string): string | null {
  const youtubeId = extractYoutubeVideoId(videoUrl);
  if (youtubeId) return `youtube-${youtubeId}`;
  const vimeoId = extractVimeoId(videoUrl);
  if (vimeoId) return `vimeo-${vimeoId}`;
  return null;
}

/**
 * Download a video's audio to GCS using yt-dlp.
 *
 * yt-dlp (installed in the Docker image) is source-agnostic — it handles
 * YouTube and Vimeo natively. YouTube needs cookies to get past bot
 * detection; Vimeo generally does not. The cookies file, when present, is
 * harmless for non-YouTube sources.
 *
 * Cookie resolution prefers per-identity cookies (looked up via the show's
 * PlatformCredential.connectedEmail → YoutubeIdentity) when a wpShowId is
 * supplied. Falls back to the global YOUTUBE_COOKIES env var so the system
 * keeps working before identities are populated.
 *
 * @param videoUrl - Full YouTube or Vimeo URL
 * @param jobId - Used only for log context
 * @param wpShowId - Show that owns this download. When supplied, drives the
 *   per-identity cookie lookup; omit for contexts where no show is known.
 * @param options.timeoutMs - Kill yt-dlp and its process group after this
 *   many milliseconds. When set, yt-dlp is spawned detached so ffmpeg dies
 *   with it. Defaults to the runtime media ceiling via execFile.
 * @param options.signal - Aborts the GCS upload (the live scan's overall
 *   deadline). A partial object is deleted.
 * @returns GCS path of the downloaded audio
 */
export async function downloadVideoToGcs(
  videoUrl: string,
  jobId: string,
  wpShowId?: number,
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<string> {
  const sourceLabel = deriveSourceLabel(videoUrl);
  if (!sourceLabel) {
    throw new Error(`Invalid video URL — must be a YouTube or Vimeo URL: ${videoUrl}`);
  }

  // Build GCS destination path (same format as gcs.ts generateGcsPath)
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const timestamp = now.getTime();
  const gcsPath = `uploads/${year}/${month}/${timestamp}-${sourceLabel}.mp3`;

  const bucketName = destinationBucket("audio");
  const storage = createStorageClient();

  const tempDir = await mkdtemp(join(tmpdir(), "swm-video-dl-"));
  const outputTemplate = join(tempDir, "video.%(ext)s");

  // Prefer per-identity cookies (real owner of the channel) over the
  // shared env-var burner; the env var stays as a safety net so existing
  // shows keep downloading before identities are populated.
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
    console.log(`[video-downloader] Job ${jobId}: downloading ${sourceLabel} via yt-dlp`);

    const args = [
      "--no-playlist",
      "-x",                       // extract audio only (we only need audio for Transistor)
      "--audio-format", "mp3",
      "--audio-quality", "0",     // best quality
      "-o", outputTemplate,
      "--no-warnings",
      "--no-progress",            // suppress per-fragment progress lines that blew past maxBuffer
    ];

    if (cookiesPath) {
      args.push("--cookies", cookiesPath);
    }

    args.push(videoUrl);

    if (options?.timeoutMs != null || options?.signal) {
      await runDetachedYtDlp(args, {
        timeoutMs: options.timeoutMs ?? mediaToolTimeoutMs(),
        signal: options.signal,
      });
    } else {
      const { stderr } = await execFileAsync("yt-dlp", args, {
        timeout: mediaToolTimeoutMs(),  // 30 minutes on Railway; hours on the Cloud Run worker
        killSignal: "SIGKILL",          // Force-kill hung yt-dlp processes on timeout
        maxBuffer: 200 * 1024 * 1024,   // 200 MB — yt-dlp's combined stdout+stderr on long episodes can exceed the 1 MB default
      });
      if (stderr) {
        console.warn(`[video-downloader] Job ${jobId} stderr: ${stderr}`);
      }
    }

    // Find the downloaded file
    const files = await readdir(tempDir);
    const videoFile = files.find((f) => f.startsWith("video."));
    if (!videoFile) {
      throw new Error("yt-dlp completed but no output file found");
    }
    const tempVideoPath = join(tempDir, videoFile);

    console.log(`[video-downloader] Job ${jobId}: uploading to GCS at ${gcsPath}`);
    await uploadLocalFile(
      storage,
      bucketName,
      tempVideoPath,
      gcsPath,
      "audio/mpeg",
      options?.signal
    );

    console.log(`[video-downloader] Job ${jobId}: download complete`);
    return gcsPath;
  } finally {
    const files = await readdir(tempDir).catch(() => []);
    for (const f of files) {
      await unlink(join(tempDir, f)).catch(() => {});
    }
    await rmdir(tempDir).catch(() => {});
  }
}

/**
 * Download the full video (not audio-only) from YouTube/Vimeo to GCS.
 * Used when a Vimeo-sourced episode needs to be uploaded to YouTube —
 * YouTube requires the actual video file, not just extracted audio.
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

  const bucketName = destinationBucket("video");
  const storage = createStorageClient();

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
      // Full videos already needed an hour on Railway. The worker ceiling is longer.
      timeout: Math.max(mediaToolTimeoutMs(), 60 * 60 * 1000),
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
