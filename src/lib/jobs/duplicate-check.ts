import "server-only";
import { db } from "@/lib/db";
import {
  getTransistorApiKey,
  getYouTubeAccessToken,
  resolvePlatformId,
  parseTransistorShowId,
} from "@/lib/analytics/credentials";
import { searchEpisodesByTitle } from "@/lib/wordpress/client";

const TRANSISTOR_API_URL = "https://api.transistor.fm/v1";
const YOUTUBE_API_URL = "https://www.googleapis.com/youtube/v3";

export interface DuplicateMatch {
  platform: string;
  externalId: string;
  externalUrl: string | null;
  title: string;
  publishedAt: string | null;
}

export interface DuplicateCheckResult {
  /** Platform name -> matches found on that platform */
  matches: Record<string, DuplicateMatch[]>;
  /** Any platform whose check could not run; informational, doesn't block. */
  errors: Array<{ platform: string; error: string }>;
}

function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Returns true when two normalized titles look like the same episode.
 * Equal after normalization, OR one fully contains the other and the shorter
 * side is at least 15 chars (avoids false positives on very short titles like
 * "Engel Angle").
 */
function titlesMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  return shorter.length >= 15 && longer.includes(shorter);
}

// --------- Per-platform searches ----------

async function checkYouTube(wpShowId: number, title: string): Promise<DuplicateMatch[]> {
  const accessToken = await getYouTubeAccessToken(wpShowId);
  if (!accessToken) return [];

  // Find the user's uploads playlist via channels?mine=true. The
  // contentDetails.relatedPlaylists.uploads playlist contains every uploaded
  // video. Listing playlistItems is 1 quota unit per call (vs 100 for search).
  const chanRes = await fetch(
    `${YOUTUBE_API_URL}/channels?part=contentDetails&mine=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!chanRes.ok) return [];
  const chanData = await chanRes.json() as {
    items?: Array<{ contentDetails?: { relatedPlaylists?: { uploads?: string } } }>;
  };
  const uploads = chanData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) return [];

  // Walk recent uploads (paginate until we exceed ~6 months back).
  const target = normalizeTitle(title);
  const matches: DuplicateMatch[] = [];
  const cutoff = Date.now() - 365 * 24 * 60 * 60 * 1000; // 1 year back
  let pageToken = "";
  for (let page = 0; page < 6; page++) {
    const url = `${YOUTUBE_API_URL}/playlistItems?part=snippet&playlistId=${uploads}&maxResults=50${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!r.ok) break;
    const j = await r.json() as {
      items?: Array<{
        snippet: {
          title: string;
          publishedAt?: string;
          resourceId: { videoId: string };
        };
      }>;
      nextPageToken?: string;
    };
    let oldestSeen = Infinity;
    for (const it of j.items ?? []) {
      const t = it.snippet.title;
      const pubMs = it.snippet.publishedAt ? Date.parse(it.snippet.publishedAt) : NaN;
      if (Number.isFinite(pubMs)) oldestSeen = Math.min(oldestSeen, pubMs);
      if (titlesMatch(normalizeTitle(t), target)) {
        matches.push({
          platform: "youtube",
          externalId: it.snippet.resourceId.videoId,
          externalUrl: `https://www.youtube.com/watch?v=${it.snippet.resourceId.videoId}`,
          title: t,
          publishedAt: it.snippet.publishedAt ?? null,
        });
      }
    }
    if (!j.nextPageToken || oldestSeen < cutoff) break;
    pageToken = j.nextPageToken;
  }
  return matches;
}

async function checkTransistor(wpShowId: number, title: string): Promise<DuplicateMatch[]> {
  const apiKey = await getTransistorApiKey(wpShowId);
  if (!apiKey) return [];
  const showLink = await resolvePlatformId(wpShowId, "transistor_show");
  if (!showLink) return [];
  const showId = parseTransistorShowId(showLink);

  const target = normalizeTitle(title);
  const matches: DuplicateMatch[] = [];
  // Walk pages until empty or we've checked ~200 episodes (4 pages).
  for (let page = 1; page <= 4; page++) {
    const r = await fetch(
      `${TRANSISTOR_API_URL}/episodes?show_id=${showId}&pagination[per]=50&pagination[page]=${page}`,
      { headers: { "x-api-key": apiKey } }
    );
    if (!r.ok) break;
    const j = await r.json() as {
      data?: Array<{ id: string; attributes: { title: string; status: string; published_at: string | null; share_url: string | null } }>;
      meta?: { totalPages?: number };
    };
    for (const ep of j.data ?? []) {
      if (ep.attributes.status !== "published") continue;
      if (titlesMatch(normalizeTitle(ep.attributes.title), target)) {
        matches.push({
          platform: "transistor",
          externalId: ep.id,
          externalUrl: ep.attributes.share_url ?? `https://share.transistor.fm/s/${ep.id}`,
          title: ep.attributes.title,
          publishedAt: ep.attributes.published_at,
        });
      }
    }
    if (page >= (j.meta?.totalPages ?? 1) || (j.data ?? []).length === 0) break;
  }
  return matches;
}

async function checkWordPress(wpShowId: number, title: string): Promise<DuplicateMatch[]> {
  const target = normalizeTitle(title);
  const posts = await searchEpisodesByTitle(title);
  const matches: DuplicateMatch[] = [];
  for (const p of posts) {
    const meta = p.meta;
    if (meta?.parent_show_id != null && Number(meta.parent_show_id) !== wpShowId) continue;
    if (titlesMatch(normalizeTitle(p.title.rendered), target)) {
      matches.push({
        platform: "website",
        externalId: String(p.id),
        externalUrl: p.link,
        title: p.title.rendered,
        publishedAt: p.date,
      });
    }
  }
  return matches;
}

/**
 * Check whether an episode with this title already exists on any of the
 * given platforms for this show. Returns matches grouped by platform.
 */
export async function checkForDuplicates(
  wpShowId: number,
  title: string,
  platforms: string[],
): Promise<DuplicateCheckResult> {
  const result: DuplicateCheckResult = { matches: {}, errors: [] };
  const want = new Set(platforms);

  await Promise.all([
    want.has("youtube") ? checkYouTube(wpShowId, title).then(
      (m) => { if (m.length) result.matches.youtube = m; },
      (e) => result.errors.push({ platform: "youtube", error: String(e) })
    ) : Promise.resolve(),
    want.has("transistor") ? checkTransistor(wpShowId, title).then(
      (m) => { if (m.length) result.matches.transistor = m; },
      (e) => result.errors.push({ platform: "transistor", error: String(e) })
    ) : Promise.resolve(),
    want.has("website") ? checkWordPress(wpShowId, title).then(
      (m) => { if (m.length) result.matches.website = m; },
      (e) => result.errors.push({ platform: "website", error: String(e) })
    ) : Promise.resolve(),
  ]);

  // Also flag duplicates from our own DistributionJob history — catches cases
  // where the platform check missed it but the portal has already distributed
  // (rare but possible if the platform API rate-limited or paginated past the
  // match). One source of truth: a successful platform record for the same
  // wpShowId + similar title.
  try {
    const recentJobs = await db.distributionJob.findMany({
      where: { wpShowId, status: "completed" },
      include: { platforms: { where: { status: "completed" } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const target = normalizeTitle(title);
    for (const j of recentJobs) {
      if (!titlesMatch(normalizeTitle(j.title), target)) continue;
      for (const p of j.platforms) {
        if (!want.has(p.platform)) continue;
        if (!p.externalId) continue;
        const list = result.matches[p.platform] ?? [];
        if (list.some((m) => m.externalId === p.externalId)) continue; // already found
        list.push({
          platform: p.platform,
          externalId: p.externalId,
          externalUrl: p.externalUrl,
          title: j.title,
          publishedAt: p.completedAt?.toISOString() ?? null,
        });
        result.matches[p.platform] = list;
      }
    }
  } catch (err) {
    result.errors.push({ platform: "portal_history", error: String(err) });
  }

  return result;
}
