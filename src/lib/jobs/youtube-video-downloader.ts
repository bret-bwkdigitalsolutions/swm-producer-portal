import ytdl from "@distube/ytdl-core";
import { createWriteStream } from "node:fs";
import { unlink, mkdtemp, rmdir } from "node:fs/promises";
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
    const url = new URL(youtubeUrl);
    if (!url.hostname.includes("youtube.com")) {
      throw new Error(`Invalid YouTube URL: ${youtubeUrl}`);
    }
    videoId = url.searchParams.get("v");
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Invalid YouTube URL")) {
      throw err;
    }
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
    await rmdir(tempDir).catch(() => {});
  }
}
