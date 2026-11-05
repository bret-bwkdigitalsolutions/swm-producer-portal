import { extractYoutubeVideoId, youtubeWatchUrl } from "@/lib/youtube-url";

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Canonical watch URL for the live video stored on a distribution job.
 * Prefers `liveYoutubeVideoId`; falls back to parsing `liveStreamUrl`.
 */
export function liveStreamWatchUrl(
  metadata: Record<string, unknown>
): string | null {
  const fromId = youtubeWatchUrl(trimmed(metadata.liveYoutubeVideoId));
  if (fromId) return fromId;

  const raw = trimmed(metadata.liveStreamUrl);
  if (!raw) return null;
  const id = extractYoutubeVideoId(raw);
  return id ? youtubeWatchUrl(id) : null;
}

/**
 * Live video to distribute when `existingYoutubeUrl` was never set.
 *
 * The live URL on the distribute form names the live post to replace. It
 * is not the published cut when the producer uploaded a finished file
 * (`videoFileName` and a GCS object) or supplied a Vimeo source — those
 * jobs still upload a new YouTube video. Reuse the live video only when
 * there is no producer file in GCS and no Vimeo source, so WordPress still
 * gets an embed and we do not upload an audio-only download.
 */
export function reusedLiveYoutubeUrl(
  metadata: Record<string, unknown>,
  gcsPath: string | null
): string | null {
  if (trimmed(metadata.existingYoutubeUrl)) return null;
  if (trimmed(metadata.existingVimeoUrl)) return null;
  if (trimmed(metadata.videoFileName) && gcsPath) return null;
  return liveStreamWatchUrl(metadata);
}
