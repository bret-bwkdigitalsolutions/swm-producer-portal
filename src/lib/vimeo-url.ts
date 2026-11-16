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

export interface ParsedOgVimeoUrl {
  videoId: string;
  /** Privacy hash from vimeo.com/id/hash or player.vimeo.com/video/id?h=hash. */
  hash: string | null;
  /** Canonical media URL stored on the OG post. */
  mediaUrl: string;
}

/**
 * OG videos are pasted as vimeo.com/<id>, vimeo.com/<id>/<hash>, or
 * player.vimeo.com/video/<id> with an optional ?h= hash. Channel and
 * showcase URLs are not accepted.
 */
export function parseOgVimeoUrl(input: string): ParsedOgVimeoUrl | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  let videoId: string | null = null;
  let hash: string | null = null;

  if (host === "player.vimeo.com") {
    const match = url.pathname.match(/^\/video\/(\d+)\/?$/);
    if (!match) return null;
    videoId = match[1];
    const queryHash = url.searchParams.get("h")?.trim() ?? "";
    if (queryHash) {
      if (!/^[A-Za-z0-9]+$/.test(queryHash)) return null;
      hash = queryHash;
    }
  } else if (host === "vimeo.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length === 1 && /^\d+$/.test(parts[0])) {
      videoId = parts[0];
    } else if (
      parts.length === 2 &&
      /^\d+$/.test(parts[0]) &&
      /^[A-Za-z0-9]+$/.test(parts[1])
    ) {
      videoId = parts[0];
      hash = parts[1];
    } else {
      return null;
    }
  } else {
    return null;
  }

  if (!videoId) return null;
  return {
    videoId,
    hash,
    mediaUrl: hash
      ? `https://vimeo.com/${videoId}/${hash}`
      : `https://vimeo.com/${videoId}`,
  };
}
