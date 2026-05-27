import "server-only";

import { db } from "@/lib/db";
import { resolveCredential } from "@/lib/analytics/credentials";

/**
 * Look up the YouTube cookies that should drive yt-dlp for downloads tied
 * to a given show. Resolution order:
 *   1. The PlatformCredential for this show (or wpShowId=0 network default)
 *   2. Its `connectedEmail` → YoutubeIdentity row
 *   3. That identity's `cookies` field
 *
 * Returns null when any step is missing — callers are expected to fall back
 * to the global YOUTUBE_COOKIES env var so the system stays functional
 * before identities are populated.
 */
export async function getYoutubeCookiesForShow(
  wpShowId: number
): Promise<string | null> {
  const cred = await resolveCredential(wpShowId, "youtube");
  if (!cred?.connectedEmail) return null;

  const identity = await db.youtubeIdentity.findUnique({
    where: { email: cred.connectedEmail },
    select: { cookies: true },
  });

  return identity?.cookies?.trim() ? identity.cookies : null;
}
