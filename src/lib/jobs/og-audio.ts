import "server-only";

import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { getVimeoAccessToken } from "@/lib/analytics/credentials";
import { gcsObjectExists } from "@/lib/gcs";
import { OG_VIMEO_TOKEN_MISSING } from "@/lib/og-episode";
import {
  fetchVimeoFileCandidates,
  pickVimeoAudioSource,
} from "@/lib/vimeo/video-files";
import { derivedGcsAudioPath, extractAudio } from "./audio-extractor";
import { audioBucketHint, uploadBucketName } from "./gcs-location";
import { mediaToolTimeoutMs } from "./processing-runtime";

export type OgAudioSource = "stored" | "upload" | "vimeo";

export interface OgTransistorAudio {
  gcsAudioPath: string;
  source: OgAudioSource;
}

function isSafeStoredAudio(path: string): boolean {
  return path.startsWith("uploads/") && !path.includes("..") && path.endsWith(".mp3");
}

async function storedAudioExists(
  objectPath: string,
  metadata: Record<string, unknown>
): Promise<boolean> {
  const hinted = audioBucketHint(metadata);
  if (hinted) return gcsObjectExists(objectPath, hinted);
  const upload = process.env.GCS_UPLOAD_BUCKET_NAME?.trim();
  const legacy = process.env.GCS_BUCKET_NAME?.trim();
  if (upload && legacy && upload !== legacy) {
    if (await gcsObjectExists(objectPath, upload)) return true;
    return gcsObjectExists(objectPath, legacy);
  }
  return gcsObjectExists(objectPath);
}

function withoutUrls(message: string): string {
  return message.replace(/https?:\/\/\S+/g, "[url]");
}

async function downloadVimeoFile(url: string, destPath: string): Promise<void> {
  try {
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(mediaToolTimeoutMs()),
      });
    } catch {
      throw new Error("Could not download the Vimeo video file.");
    }
    if (!response.ok || !response.body) {
      throw new Error(`Vimeo file download failed (HTTP ${response.status}).`);
    }
    const webBody = response.body as unknown as NodeWebReadableStream<Uint8Array>;
    await pipeline(Readable.fromWeb(webBody), createWriteStream(destPath));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not download the Vimeo video file.";
    throw new Error(withoutUrls(message));
  }
}

/**
 * Audio for the private OG podcast.
 * An uploaded file uses the existing ffmpeg extract. A Vimeo-only episode
 * downloads a progressive file (never changes privacy) and extracts the same way.
 * A previous extract on this job is reused.
 */
export async function ensureOgTransistorAudio(input: {
  jobId: string;
  wpShowId: number;
  gcsVideoPath: string | null;
  videoBucket: string | null;
  metadata: Record<string, unknown>;
  vimeoVideoId: string | null;
  vimeoHash: string | null;
}): Promise<OgTransistorAudio> {
  const stored =
    typeof input.metadata.gcsAudioPath === "string" ? input.metadata.gcsAudioPath : "";
  if (stored && isSafeStoredAudio(stored)) {
    const matchesUpload =
      !input.gcsVideoPath || stored === derivedGcsAudioPath(input.gcsVideoPath);
    if (matchesUpload && (await storedAudioExists(stored, input.metadata))) {
      return { gcsAudioPath: stored, source: "stored" };
    }
  }

  if (input.gcsVideoPath) {
    const gcsAudioPath = input.videoBucket
      ? await extractAudio(input.gcsVideoPath, { bucket: input.videoBucket })
      : await extractAudio(input.gcsVideoPath);
    return { gcsAudioPath, source: "upload" };
  }

  if (!input.vimeoVideoId) {
    throw new Error(
      "The OG needs a Vimeo URL or an uploaded video before it can be added to the private podcast."
    );
  }

  const token = await getVimeoAccessToken(input.wpShowId);
  if (!token) {
    throw new Error(OG_VIMEO_TOKEN_MISSING);
  }

  const candidates = await fetchVimeoFileCandidates({
    videoId: input.vimeoVideoId,
    hash: input.vimeoHash,
    token,
  });
  const file = pickVimeoAudioSource(candidates);
  if (!file) {
    throw new Error(
      "Vimeo did not return a downloadable file for this video. The portal does not change the video's privacy."
    );
  }
  console.log(
    `[og-audio] Job ${input.jobId}: Vimeo file ${file.quality ?? file.type ?? "video"} ` +
      `${file.height ? `${file.height}p ` : ""}${file.size ? `(${file.size} bytes)` : ""}`
  );

  const tempDir = await mkdtemp(join(tmpdir(), "swm-og-vimeo-"));
  const localVideoPath = join(tempDir, "video.mp4");
  try {
    await downloadVimeoFile(file.link, localVideoPath);
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const gcsVideoPath = `uploads/${now.getFullYear()}/${month}/${now.getTime()}-og-vimeo-${input.vimeoVideoId}.mp4`;
    const gcsAudioPath = await extractAudio(gcsVideoPath, {
      localVideoPath,
      bucket: uploadBucketName(),
    });
    return { gcsAudioPath, source: "vimeo" };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
