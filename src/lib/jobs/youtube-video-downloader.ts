import { execFile } from "node:child_process";
import { unlink, mkdtemp, readdir, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Storage } from "@google-cloud/storage";
import { extractYoutubeVideoId } from "@/lib/youtube-url";

const execFileAsync = promisify(execFile);

/**
 * Download a YouTube video to GCS using yt-dlp.
 *
 * Uses yt-dlp (installed in the Docker image) which handles YouTube's
 * bot detection far better than ytdl-core. Downloads to a temp file,
 * uploads to GCS, cleans up, and returns the GCS path.
 *
 * @param youtubeUrl - Full YouTube URL (watch, live, or youtu.be format)
 * @param jobId - Used only for log context
 * @returns GCS path of the downloaded video
 */
export async function downloadYouTubeVideoToGcs(
  youtubeUrl: string,
  jobId: string
): Promise<string> {
  const videoId = extractYoutubeVideoId(youtubeUrl);
  if (!videoId) {
    throw new Error(`Invalid YouTube URL: ${youtubeUrl}`);
  }

  // Build GCS destination path (same format as gcs.ts generateGcsPath)
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const timestamp = now.getTime();
  const gcsPath = `uploads/${year}/${month}/${timestamp}-youtube-${videoId}.mp4`;

  const bucketName = process.env.GCS_BUCKET_NAME!;
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

  const tempDir = await mkdtemp(join(tmpdir(), "swm-yt-dl-"));
  const outputTemplate = join(tempDir, "video.%(ext)s");

  try {
    console.log(`[yt-downloader] Job ${jobId}: downloading YouTube video ${videoId} via yt-dlp`);

    await execFileAsync("yt-dlp", [
      "--no-playlist",
      "--merge-output-format", "mp4",
      "-o", outputTemplate,
      "--no-warnings",
      "--quiet",
      youtubeUrl,
    ], { timeout: 10 * 60 * 1000 }); // 10 minute timeout

    // Find the downloaded file
    const files = await readdir(tempDir);
    const videoFile = files.find((f) => f.startsWith("video."));
    if (!videoFile) {
      throw new Error("yt-dlp completed but no output file found");
    }
    const tempVideoPath = join(tempDir, videoFile);

    console.log(`[yt-downloader] Job ${jobId}: uploading to GCS at ${gcsPath}`);
    await storage.bucket(bucketName).upload(tempVideoPath, {
      destination: gcsPath,
      metadata: { contentType: "video/mp4" },
    });

    console.log(`[yt-downloader] Job ${jobId}: download complete`);
    return gcsPath;
  } finally {
    const files = await readdir(tempDir).catch(() => []);
    for (const f of files) {
      await unlink(join(tempDir, f)).catch(() => {});
    }
    await rmdir(tempDir).catch(() => {});
  }
}
