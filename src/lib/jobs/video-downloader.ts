import { execFile } from "node:child_process";
import { unlink, mkdtemp, readdir, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Storage } from "@google-cloud/storage";
import { extractYoutubeVideoId } from "@/lib/youtube-url";
import { extractVimeoId } from "@/lib/vimeo-url";
import { getYoutubeCookiesForShow } from "@/lib/youtube-identity";

const execFileAsync = promisify(execFile);

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
 * @returns GCS path of the downloaded audio
 */
export async function downloadVideoToGcs(
  videoUrl: string,
  jobId: string,
  wpShowId?: number
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

  const bucketName = process.env.GCS_BUCKET_NAME;
  if (!bucketName) {
    throw new Error("GCS_BUCKET_NAME is not set — cannot upload downloaded audio");
  }
  const credentialsJson = process.env.GCS_CREDENTIALS_JSON;
  let storage: Storage;
  if (credentialsJson) {
    let credentials: object;
    try {
      credentials = JSON.parse(credentialsJson);
    } catch {
      throw new Error("GCS_CREDENTIALS_JSON is not valid JSON — check the Railway environment variable");
    }
    storage = new Storage({ credentials });
  } else {
    storage = new Storage({ keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS });
  }

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

    const { stderr } = await execFileAsync("yt-dlp", args, {
      timeout: 30 * 60 * 1000,        // 30 minute timeout — long Vimeo episodes (2000+ DASH fragments) can exceed 10 min
      killSignal: "SIGKILL",          // Force-kill hung yt-dlp processes on timeout
      maxBuffer: 200 * 1024 * 1024,   // 200 MB — yt-dlp's combined stdout+stderr on long episodes can exceed the 1 MB default
    });

    if (stderr) {
      console.warn(`[video-downloader] Job ${jobId} stderr: ${stderr}`);
    }

    // Find the downloaded file
    const files = await readdir(tempDir);
    const videoFile = files.find((f) => f.startsWith("video."));
    if (!videoFile) {
      throw new Error("yt-dlp completed but no output file found");
    }
    const tempVideoPath = join(tempDir, videoFile);

    console.log(`[video-downloader] Job ${jobId}: uploading to GCS at ${gcsPath}`);
    await storage.bucket(bucketName).upload(tempVideoPath, {
      destination: gcsPath,
      metadata: { contentType: "audio/mpeg" },
    });

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
    throw new Error("GCS_BUCKET_NAME is not set — cannot upload downloaded video");
  }
  const credentialsJson = process.env.GCS_CREDENTIALS_JSON;
  let storage: Storage;
  if (credentialsJson) {
    let credentials: object;
    try {
      credentials = JSON.parse(credentialsJson);
    } catch {
      throw new Error("GCS_CREDENTIALS_JSON is not valid JSON — check the Railway environment variable");
    }
    storage = new Storage({ credentials });
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
