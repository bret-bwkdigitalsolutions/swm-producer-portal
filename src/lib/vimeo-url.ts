/**
 * Extract a Vimeo video ID from various URL formats:
 *  - https://vimeo.com/123456789
 *  - https://vimeo.com/123456789/abcdef0123        (unlisted/private hash)
 *  - https://player.vimeo.com/video/123456789
 *  - https://vimeo.com/channels/staffpicks/123456789
 *
 * Returns the numeric video ID string or null if the URL is not a Vimeo URL.
 */
export function extractVimeoId(input: string): string | null {
  try {
    const url = new URL(input.trim());

    if (!url.hostname.endsWith("vimeo.com")) return null;

    // player.vimeo.com/video/ID
    const playerMatch = url.pathname.match(/^\/video\/(\d+)/);
    if (playerMatch) return playerMatch[1];

    // vimeo.com/.../ID — take the last all-digits path segment, which is the
    // video ID for plain, hashed, and channel URLs alike.
    const segments = url.pathname.split("/").filter(Boolean);
    for (let i = segments.length - 1; i >= 0; i--) {
      if (/^\d+$/.test(segments[i])) return segments[i];
    }

    return null;
  } catch {
    return null;
  }
}

/** Returns true when the string is a recognisable Vimeo video URL. */
export function isValidVimeoUrl(input: string): boolean {
  return extractVimeoId(input) !== null;
}
