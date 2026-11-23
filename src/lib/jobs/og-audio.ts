import "server-only";

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getVimeoAccessToken } from "@/lib/analytics/credentials";
import { gcsObjectExists } from "@/lib/gcs";
import { OG_VIMEO_TOKEN_MISSING } from "@/lib/og-episode";
import {
  downloadVimeoFile,
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

/**
 * Audio for the private OG podcast.
 * An uploaded file uses the existing ffmpeg extract. A Vimeo-only episode
 * downloads a progressive file (never changes privacy) and extracts the same way.
 * A previous extract on this job is reused.
 *
 * This runs inside processJob. Other shows' ffmpeg runs there too, and when
 * the processing runtime is Cloud Run the whole job — this download and the
 * extract — is that worker. It is not a separate download on the web process.
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
    await downloadVimeoFile(file.link, localVideoPath, {
      timeoutMs: mediaToolTimeoutMs(),
    });
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
