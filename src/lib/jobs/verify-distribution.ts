import { db } from "@/lib/db";
import { getTransistorApiKey, getYouTubeAccessToken } from "@/lib/analytics/credentials";

const YOUTUBE_API_URL = "https://www.googleapis.com/youtube/v3";
const TRANSISTOR_API_URL = "https://api.transistor.fm/v1";

/** Abort signal with a 30-second timeout for platform API calls. */
function fetchTimeout(): AbortSignal {
  return AbortSignal.timeout(30_000);
}

function normalizeTitle(title: string): string {
  return title
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export interface VerificationIssue {
  platform: string;
  field: string;
  expected: string;
  actual: string;
}

export interface PlatformTierResult {
  platform: string;
  passed: boolean;
  issues: VerificationIssue[];
}

export interface TierResult {
  tier: 1 | 2 | 3 | 4;
  ranAt: string;
  platforms: PlatformTierResult[];
}

export const TIER_LABELS: Record<1 | 2 | 3 | 4, string> = {
  1: "smoke",       // 30s — does the resource exist?
  2: "metadata",    // 2 min — title, thumbnail match
  3: "processing",  // 10 min — uploaded/processed status, audio/post reachable
  4: "public",      // 30 min — public URL HEAD check
};

/**
 * HEAD-check a URL. Considers 2xx and 3xx as reachable. Used for tier 3 & 4.
 */
async function checkUrlReachable(url: string): Promise<{ ok: boolean; status: number | null }> {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow", signal: fetchTimeout() });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: null };
  }
}

interface CheckCtx {
  jobId: string;
  wpShowId: number;
  expectedTitle: string;
  isLiveRecording: boolean;
}

// --------------------------- Per-platform tier checks -----------------------

async function ytTier(
  tier: 1 | 2 | 3 | 4,
  videoId: string,
  ctx: CheckCtx,
): Promise<VerificationIssue[]> {
  if (ctx.isLiveRecording) return []; // skip — externally uploaded
  const accessToken = await getYouTubeAccessToken(ctx.wpShowId);
  if (!accessToken) {
    return [{ platform: "youtube", field: "api_check", expected: "accessible", actual: "no access token" }];
  }

  const parts =
    tier === 3 ? "snippet,status,processingDetails" :
    tier === 2 ? "snippet,status" :
    "snippet";

  const res = await fetch(
    `${YOUTUBE_API_URL}/videos?id=${videoId}&part=${parts}`,
    { headers: { Authorization: `Bearer ${accessToken}` }, signal: fetchTimeout() }
  );
  if (!res.ok) {
    return [{ platform: "youtube", field: "api_check", expected: "accessible", actual: `API ${res.status}` }];
  }

  const data = await res.json() as {
    items?: Array<{
      snippet: { title: string; thumbnails: Record<string, { url: string }> };
      status?: { uploadStatus?: string; privacyStatus?: string };
    }>;
  };
  const v = data.items?.[0];
  if (!v) return [{ platform: "youtube", field: "video", expected: "exists", actual: "not found" }];

  const issues: VerificationIssue[] = [];
  if (tier === 1) return issues; // smoke: existence is enough

  if (tier >= 2) {
    if (normalizeTitle(v.snippet.title) !== normalizeTitle(ctx.expectedTitle)) {
      issues.push({ platform: "youtube", field: "title", expected: ctx.expectedTitle, actual: v.snippet.title });
    }
    const thumbs = v.snippet.thumbnails;
    if (!thumbs.maxres && !thumbs.high) {
      issues.push({ platform: "youtube", field: "thumbnail", expected: "custom thumbnail", actual: "default only" });
    }
  }
  if (tier >= 3) {
    const us = v.status?.uploadStatus;
    if (us !== "processed") {
      issues.push({ platform: "youtube", field: "uploadStatus", expected: "processed", actual: us ?? "unknown" });
    }
  }
  if (tier === 4) {
    const reach = await checkUrlReachable(`https://www.youtube.com/watch?v=${videoId}`);
    if (!reach.ok) {
      issues.push({ platform: "youtube", field: "public_url", expected: "200", actual: `${reach.status ?? "unreachable"}` });
    }
  }
  return issues;
}

async function transistorTier(
  tier: 1 | 2 | 3 | 4,
  episodeId: string,
  ctx: CheckCtx,
): Promise<VerificationIssue[]> {
  const apiKey = await getTransistorApiKey(ctx.wpShowId);
  if (!apiKey) {
    return [{ platform: "transistor", field: "api_check", expected: "accessible", actual: "no API key" }];
  }
  const res = await fetch(`${TRANSISTOR_API_URL}/episodes/${episodeId}`, {
    headers: { "x-api-key": apiKey }, signal: fetchTimeout(),
  });
  if (!res.ok) {
    return [{ platform: "transistor", field: "api_check", expected: "accessible", actual: `API ${res.status}` }];
  }
  const data = await res.json() as {
    data?: { attributes: { title: string; image_url: string | null; status: string; media_url: string | null; share_url: string | null } };
  };
  const ep = data.data;
  if (!ep) return [{ platform: "transistor", field: "episode", expected: "exists", actual: "not found" }];

  const issues: VerificationIssue[] = [];
  if (tier === 1) return issues;

  if (tier >= 2) {
    if (normalizeTitle(ep.attributes.title) !== normalizeTitle(ctx.expectedTitle)) {
      issues.push({ platform: "transistor", field: "title", expected: ctx.expectedTitle, actual: ep.attributes.title });
    }
    if (!ep.attributes.image_url) {
      issues.push({ platform: "transistor", field: "thumbnail", expected: "image_url present", actual: "null" });
    }
  }
  if (tier >= 3) {
    if (ep.attributes.status !== "published") {
      issues.push({ platform: "transistor", field: "status", expected: "published", actual: ep.attributes.status });
    }
    if (ep.attributes.media_url) {
      const audio = await checkUrlReachable(ep.attributes.media_url);
      if (!audio.ok) {
        issues.push({ platform: "transistor", field: "audio_url", expected: "200", actual: `${audio.status ?? "unreachable"}` });
      }
    } else {
      issues.push({ platform: "transistor", field: "media_url", expected: "set", actual: "null" });
    }
  }
  if (tier === 4 && ep.attributes.share_url) {
    const reach = await checkUrlReachable(ep.attributes.share_url);
    if (!reach.ok) {
      issues.push({ platform: "transistor", field: "public_url", expected: "200", actual: `${reach.status ?? "unreachable"}` });
    }
  }
  return issues;
}

async function wpTier(
  tier: 1 | 2 | 3 | 4,
  postId: string,
  ctx: CheckCtx,
): Promise<VerificationIssue[]> {
  const wpApiUrl = process.env.WP_API_URL;
  if (!wpApiUrl) {
    return [{ platform: "website", field: "api_check", expected: "accessible", actual: "WP_API_URL not configured" }];
  }
  const wpAuth = "Basic " + Buffer.from(`${process.env.WP_APP_USER}:${process.env.WP_APP_PASSWORD}`).toString("base64");
  const res = await fetch(
    `${wpApiUrl}/swm_episode/${postId}?_fields=id,title,featured_media,status,link`,
    { headers: { Authorization: wpAuth }, signal: fetchTimeout() }
  );
  if (!res.ok) {
    return [{ platform: "website", field: "api_check", expected: "accessible", actual: `API ${res.status}` }];
  }
  const post = await res.json() as { id: number; title: { rendered: string }; featured_media: number; status: string; link: string };
  const issues: VerificationIssue[] = [];
  if (tier === 1) return issues;

  if (tier >= 2) {
    if (normalizeTitle(post.title.rendered) !== normalizeTitle(ctx.expectedTitle)) {
      issues.push({ platform: "website", field: "title", expected: ctx.expectedTitle, actual: post.title.rendered });
    }
    if (!post.featured_media) {
      issues.push({ platform: "website", field: "thumbnail", expected: "featured_media set", actual: "none" });
    }
  }
  if (tier >= 3) {
    if (post.status !== "publish") {
      issues.push({ platform: "website", field: "status", expected: "publish", actual: post.status });
    }
  }
  if (tier === 4 && post.link) {
    const reach = await checkUrlReachable(post.link);
    if (!reach.ok) {
      issues.push({ platform: "website", field: "public_url", expected: "200", actual: `${reach.status ?? "unreachable"}` });
    }
  }
  return issues;
}

// --------------------------- Public entry --------------------------------

/**
 * Run a single verification tier for all completed platforms on a job and
 * persist the result to job metadata.
 */
export async function runVerificationTier(
  tier: 1 | 2 | 3 | 4,
  jobId: string,
  wpShowId: number,
  expectedTitle: string,
  isLiveRecording = false,
): Promise<TierResult> {
  const platforms = await db.distributionJobPlatform.findMany({
    where: { jobId, status: "completed" },
  });
  const ctx: CheckCtx = { jobId, wpShowId, expectedTitle, isLiveRecording };

  const platformResults: PlatformTierResult[] = await Promise.all(
    platforms.map(async (p): Promise<PlatformTierResult> => {
      try {
        let issues: VerificationIssue[] = [];
        if (!p.externalId) {
          issues = [{ platform: p.platform, field: "externalId", expected: "set", actual: "missing" }];
        } else if (p.platform === "youtube") {
          issues = await ytTier(tier, p.externalId, ctx);
        } else if (p.platform === "transistor") {
          issues = await transistorTier(tier, p.externalId, ctx);
        } else if (p.platform === "website") {
          issues = await wpTier(tier, p.externalId, ctx);
        }
        return { platform: p.platform, passed: issues.length === 0, issues };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown";
        return {
          platform: p.platform, passed: false,
          issues: [{ platform: p.platform, field: "exception", expected: "no error", actual: msg }],
        };
      }
    })
  );

  const tierResult: TierResult = {
    tier,
    ranAt: new Date().toISOString(),
    platforms: platformResults,
  };

  // Persist into job.metadata.verifications (array)
  try {
    const job = await db.distributionJob.findUnique({
      where: { id: jobId }, select: { metadata: true },
    });
    if (job) {
      const meta = (job.metadata as Record<string, unknown>) ?? {};
      const existing = (meta.verifications as TierResult[] | undefined) ?? [];
      // Replace any prior entry for this tier (handles re-runs)
      const filtered = existing.filter((v) => v.tier !== tier);
      meta.verifications = [...filtered, tierResult];
      await db.distributionJob.update({
        where: { id: jobId },
        data: { metadata: JSON.parse(JSON.stringify(meta)) },
      });
    }
  } catch (err) {
    console.warn("[verify] could not persist tier result:", err);
  }

  const pass = platformResults.every((p) => p.passed);
  console.log(
    `[verify] tier ${tier} (${TIER_LABELS[tier]}) for job ${jobId}: ${pass ? "PASSED" : "FAILED"}`,
    pass ? "" : platformResults.filter((p) => !p.passed).map((p) => p.platform).join(", ")
  );

  return tierResult;
}
