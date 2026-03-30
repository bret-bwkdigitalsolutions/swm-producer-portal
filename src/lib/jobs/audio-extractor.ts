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
