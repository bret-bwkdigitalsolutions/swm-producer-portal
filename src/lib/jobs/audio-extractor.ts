import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Storage } from "@google-cloud/storage";
import { downloadGcsObjectToFile } from "./gcs-download";

const execFileAsync = promisify(execFile);

/** GCS object name of the mp3 extracted from a video object. */
export function derivedGcsAudioPath(gcsVideoPath: string): string {
  return gcsVideoPath.replace(/\.[^.]+$/, ".mp3");
}

export interface ExtractAudioOptions {
  /**
   * Already-downloaded source video. When set, the GCS object is not read
   * again. The caller keeps ownership of this file — it is not deleted here,
   * including when ffmpeg or the audio upload fails.
   */
  localVideoPath?: string;
}

/**
 * Extract audio track from a video stored in GCS.
 *
 * Downloads the video to a temp file (unless `localVideoPath` is provided),
 * runs ffmpeg to extract audio as mp3, uploads the mp3 back to GCS, and
 * cleans up temp files.
 *
 * @param gcsVideoPath - GCS path of the source video file
 * @returns GCS path of the extracted audio file
 */
export async function extractAudio(
  gcsVideoPath: string,
  options?: ExtractAudioOptions
): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), "swm-audio-"));
  const borrowedVideo = options?.localVideoPath;
  const tempVideoPath = borrowedVideo ?? join(tempDir, "input.mp4");
  const tempAudioPath = join(tempDir, "output.mp3");
  const gcsAudioPath = derivedGcsAudioPath(gcsVideoPath);

  try {
    if (!borrowedVideo) {
      // Download video from GCS
      console.log(`[audio-extractor] Downloading video from GCS: ${gcsVideoPath}`);
      await downloadGcsObjectToFile(gcsVideoPath, tempVideoPath);
    } else {
      console.log(
        `[audio-extractor] Extracting audio from local file (no GCS download): ${borrowedVideo}`
      );
    }

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
    // tempDir holds the downloaded video (when we own it) and the mp3.
    // A borrowed video lives outside tempDir and is left for the caller.
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
