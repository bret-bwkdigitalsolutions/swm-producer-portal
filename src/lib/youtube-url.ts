/**
 * Extract a YouTube video ID from various URL formats:
 *  - https://www.youtube.com/watch?v=VIDEO_ID
 *  - https://www.youtube.com/live/VIDEO_ID
 *  - https://www.youtube.com/shorts/VIDEO_ID
 *  - https://www.youtube.com/embed/VIDEO_ID
 *  - https://youtu.be/VIDEO_ID
 *  - https://youtube.com/watch?v=VIDEO_ID (no www)
 *
 * Returns the video ID string or null if the URL is not a valid YouTube URL.
 */

// YouTube video IDs are 11 chars of [A-Za-z0-9_-]
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

function isYoutubeHostname(hostname: string): boolean {
  // Exact match or subdomain — never a substring check, which would accept
  // hostnames like "youtube.com.evil.example".
  return (
    hostname === "youtube.com" ||
    hostname.endsWith(".youtube.com") ||
    hostname === "youtu.be"
  );
}

export function extractYoutubeVideoId(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }

  if (!isYoutubeHostname(url.hostname)) return null;

  let id: string | null = null;

  if (url.hostname === "youtu.be") {
    // youtu.be/VIDEO_ID
    id = url.pathname.split("/").filter(Boolean)[0] ?? null;
  } else {
    // /watch?v=VIDEO_ID
    id = url.searchParams.get("v");

    // /live/VIDEO_ID, /shorts/VIDEO_ID, /embed/VIDEO_ID
    if (!id) {
      const pathMatch = url.pathname.match(
        /^\/(?:live|shorts|embed)\/([^/?]+)/
      );
      if (pathMatch) id = pathMatch[1];
    }
  }

  if (!id || !VIDEO_ID_PATTERN.test(id)) return null;
  return id;
}

/** Returns true when the string is a recognisable YouTube video URL. */
export function isValidYoutubeUrl(input: string): boolean {
  return extractYoutubeVideoId(input) !== null;
}
