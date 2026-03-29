import "server-only";
import { db } from "@/lib/db";
import { refreshAccessToken } from "@/lib/youtube-oauth";

/**
 * Resolve an API credential for a given show and platform.
 * Falls back to network default (wpShowId=0) if show-specific not found.
 */
export async function resolveCredential(
  wpShowId: number,
  platform: string
) {
  // Try show-specific first
  const showCred = await db.platformCredential.findUnique({
    where: { wpShowId_platform: { wpShowId, platform } },
  });
  if (showCred) return showCred;

  // Fall back to network default
  if (wpShowId !== 0) {
    const networkCred = await db.platformCredential.findUnique({
      where: { wpShowId_platform: { wpShowId: 0, platform } },
    });
    return networkCred;
  }

  return null;
}

/**
 * Resolve a platform-specific identifier (URL) for a show.
 * Falls back to network default (wpShowId=0) if show-specific not found.
 */
export async function resolvePlatformId(
  wpShowId: number,
  platformLinkType: string
): Promise<string | null> {
  const showLink = await db.showPlatformLink.findUnique({
    where: { wpShowId_platform: { wpShowId, platform: platformLinkType } },
  });
  if (showLink) return showLink.url;

  if (wpShowId !== 0) {
    const networkLink = await db.showPlatformLink.findUnique({
      where: { wpShowId_platform: { wpShowId: 0, platform: platformLinkType } },
    });
    return networkLink?.url ?? null;
  }

  return null;
}

/**
 * Get a valid YouTube access token for a show, refreshing if expired.
 */
export async function getYouTubeAccessToken(
  wpShowId: number
): Promise<string | null> {
  const cred = await resolveCredential(wpShowId, "youtube");
  if (!cred || !cred.refreshToken) return null;

  const isExpired =
    !cred.accessToken ||
    !cred.tokenExpiresAt ||
    cred.tokenExpiresAt < new Date(Date.now() + 5 * 60 * 1000);

  if (!isExpired && cred.accessToken) {
    return cred.accessToken;
  }

  const { accessToken, expiresAt } = await refreshAccessToken(cred.refreshToken);

  await db.platformCredential.update({
    where: { id: cred.id },
    data: {
      accessToken,
      tokenExpiresAt: expiresAt,
      status: "valid",
    },
  });

  return accessToken;
}

/**
 * Get the Transistor API key for a show.
 */
export async function getTransistorApiKey(
  wpShowId: number
): Promise<string | null> {
  const cred = await resolveCredential(wpShowId, "transistor");
  return cred?.apiKey ?? null;
}

/**
 * Extract a Transistor show ID from its ShowPlatformLink URL.
 */
export function parseTransistorShowId(urlOrId: string): string {
  if (/^\d+$/.test(urlOrId)) return urlOrId;

  try {
    const url = new URL(urlOrId);
    const segments = url.pathname.split("/").filter(Boolean);
    return segments[segments.length - 1] || urlOrId;
  } catch {
    return urlOrId;
  }
}

/**
 * Extract a YouTube channel ID from its ShowPlatformLink URL.
 */
export function parseYouTubeChannelId(urlOrId: string): string {
  if (urlOrId.startsWith("UC")) return urlOrId;

  try {
    const url = new URL(urlOrId);
    const segments = url.pathname.split("/").filter(Boolean);
    const channelIdx = segments.indexOf("channel");
    if (channelIdx !== -1 && segments[channelIdx + 1]) {
      return segments[channelIdx + 1];
    }
    return segments[segments.length - 1] || urlOrId;
  } catch {
    return urlOrId;
  }
}
