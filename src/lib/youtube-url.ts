/**
 * Extract a YouTube video ID from various URL formats:
 *  - https://www.youtube.com/watch?v=VIDEO_ID
 *  - https://www.youtube.com/live/VIDEO_ID
 *  - https://youtu.be/VIDEO_ID
 *  - https://youtube.com/watch?v=VIDEO_ID (no www)
 *
 * Returns the video ID string or null if the URL is not a valid YouTube URL.
 */
export function extractYoutubeVideoId(input: string): string | null {
  try {
    const url = new URL(input.trim());

    // youtu.be/VIDEO_ID
    if (url.hostname === "youtu.be") {
      const id = url.pathname.slice(1);
      return id || null;
    }

    // youtube.com variants
    if (!url.hostname.includes("youtube.com")) return null;

    // /watch?v=VIDEO_ID
    const vParam = url.searchParams.get("v");
    if (vParam) return vParam;

    // /live/VIDEO_ID
    const liveMatch = url.pathname.match(/^\/live\/([^/?]+)/);
    if (liveMatch) return liveMatch[1];

    return null;
  } catch {
    return null;
  }
}

/** Returns true when the string is a recognisable YouTube video URL. */
export function isValidYoutubeUrl(input: string): boolean {
  return extractYoutubeVideoId(input) !== null;
}
