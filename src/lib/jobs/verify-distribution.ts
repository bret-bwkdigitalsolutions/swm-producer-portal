import { db } from "@/lib/db";
import { getTransistorApiKey, getYouTubeAccessToken } from "@/lib/analytics/credentials";
import { checkUrlReachable, fetchWithRetry, isTransientStatus } from "./platform-fetch";
import {
  TIER_INFO,
  type Severity,
  type TierNumber,
  type TierResult,
  type PlatformTierResult,
  type VerificationIssue,
} from "./verification-types";

export type { TierResult, PlatformTierResult, VerificationIssue } from "./verification-types";

const YOUTUBE_API_URL = "https://www.googleapis.com/youtube/v3";
const TRANSISTOR_API_URL = "https://api.transistor.fm/v1";

/** Back-compat export: tier → short label used in log lines. */
export const TIER_LABELS: Record<TierNumber, string> = {
  1: "smoke",
  2: "metadata",
  3: "processing",
  4: "public",
  5: "final",
};

export function normalizeTitle(title: string): string {
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

/** Check groups. Tiers 1–4 run one group each; tier 5 (final) runs all. */
type CheckGroup = "exists" | "metadata" | "processing" | "public";

export function groupsForTier(tier: TierNumber): Set<CheckGroup> {
  switch (tier) {
    case 1: return new Set(["exists"]);
    case 2: return new Set(["metadata"]);
    case 3: return new Set(["processing"]);
    case 4: return new Set(["public"]);
    case 5: return new Set(["exists", "metadata", "processing", "public"]);
  }
}

interface CheckCtx {
  jobId: string;
  wpShowId: number;
  expectedTitle: string;
  isLiveRecording: boolean;
  isPremium: boolean;
  isDraft: boolean;
  tier: TierNumber;
  groups: Set<CheckGroup>;
}

function issue(
  platform: string,
  field: string,
  expected: string,
  actual: string,
  severity: Severity,
  transient?: boolean
): VerificationIssue {
  return { platform, field, expected, actual, severity, ...(transient ? { transient: true } : {}) };
}

/** Turn a non-ok API response into a clear critical issue. */
function apiIssue(platform: string, status: number): VerificationIssue {
  const actual =
    status === 404 ? "not found (404)"
    : status === 401 || status === 403 ? `auth failed (${status}) — check the platform credential`
    : `API ${status}`;
  return issue(platform, "api_check", "accessible", actual, "critical", isTransientStatus(status));
}

// --------------------------- Per-platform checks ----------------------------

async function youtubeChecks(videoId: string, ctx: CheckCtx): Promise<VerificationIssue[]> {
  // Live recordings were uploaded externally; the portal's OAuth may not be
  // able to read that channel, so they are not verified here.
  if (ctx.isLiveRecording) return [];

  const accessToken = await getYouTubeAccessToken(ctx.wpShowId);
  if (!accessToken) {
    return [issue("youtube", "api_check", "accessible", "no access token — reconnect YouTube", "critical")];
  }

  const res = await fetchWithRetry(
    `${YOUTUBE_API_URL}/videos?id=${encodeURIComponent(videoId)}&part=snippet,status,processingDetails`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    `YouTube videos.list ${videoId}`
  );
  if (!res.ok) return [apiIssue("youtube", res.status)];

  const data = (await res.json()) as {
    items?: Array<{
      snippet: { title: string };
      status?: {
        uploadStatus?: string;
        privacyStatus?: string;
        failureReason?: string;
        rejectionReason?: string;
        publishAt?: string;
      };
    }>;
  };
  const v = data.items?.[0];
  if (!v) return [issue("youtube", "video", "exists", "not found", "critical")];

  const issues: VerificationIssue[] = [];
  const g = ctx.groups;

  if (g.has("metadata")) {
    if (normalizeTitle(v.snippet.title) !== normalizeTitle(ctx.expectedTitle)) {
      issues.push(issue("youtube", "title", ctx.expectedTitle, v.snippet.title, "critical"));
    }
    // No thumbnail check: YouTube always returns auto-generated "high"
    // thumbnails, so the old check could never fail. A failed custom
    // thumbnail upload is recorded as a distribution issue instead.
  }

  if (g.has("processing")) {
    const us = v.status?.uploadStatus;
    if (us === "failed" || us === "rejected" || us === "deleted") {
      const reason = v.status?.failureReason ?? v.status?.rejectionReason;
      issues.push(issue("youtube", "uploadStatus", "processed", reason ? `${us} (${reason})` : us, "critical"));
    } else if (us === "uploaded") {
      // Still processing: normal early on, worth a warning if it persists.
      issues.push(issue("youtube", "uploadStatus", "processed", "still processing", "warning"));
    }
  }

  if (g.has("public")) {
    const privacy = v.status?.privacyStatus;
    const scheduledPrivate = privacy === "private";
    if (!ctx.isPremium && !scheduledPrivate) {
      const reach = await checkUrlReachable(`https://www.youtube.com/watch?v=${videoId}`);
      if (!reach.ok) {
        issues.push(issue("youtube", "public_url", "200", `${reach.status ?? "unreachable"}`, "critical", reach.transient));
      }
    }
  }
  return issues;
}

async function transistorChecks(
  episodeId: string,
  ctx: CheckCtx,
  opts: { platform: string; credentialShowId: number }
): Promise<VerificationIssue[]> {
  const { platform } = opts;
  const apiKey = await getTransistorApiKey(opts.credentialShowId);
  if (!apiKey) {
    return [issue(platform, "api_check", "accessible", "no API key", "critical")];
  }
  const res = await fetchWithRetry(
    `${TRANSISTOR_API_URL}/episodes/${encodeURIComponent(episodeId)}`,
    { headers: { "x-api-key": apiKey } },
    `Transistor episode ${episodeId}`
  );
  if (!res.ok) return [apiIssue(platform, res.status)];

  const data = (await res.json()) as {
    data?: {
      attributes: {
        title: string;
        image_url: string | null;
        status: string;
        media_url: string | null;
        share_url: string | null;
      };
    };
  };
  const ep = data.data?.attributes;
  if (!ep) return [issue(platform, "episode", "exists", "not found", "critical")];

  const issues: VerificationIssue[] = [];
  const g = ctx.groups;

  if (g.has("metadata")) {
    if (normalizeTitle(ep.title) !== normalizeTitle(ctx.expectedTitle)) {
      issues.push(issue(platform, "title", ctx.expectedTitle, ep.title, "critical"));
    }
    if (!ep.image_url) {
      // Cosmetic: Transistor falls back to the show artwork. The deferred
      // thumbnail backfill normally fills this in within ~20 minutes.
      issues.push(issue(platform, "thumbnail", "episode artwork", "none (show artwork used)", "warning"));
    }
  }

  if (g.has("processing")) {
    const okStatus =
      ep.status === "published" || ep.status === "scheduled" || (ctx.isDraft && ep.status === "draft");
    if (!okStatus) {
      issues.push(issue(platform, "status", ctx.isDraft ? "draft" : "published", ep.status, "critical"));
    }
    if (!ep.media_url) {
      issues.push(issue(platform, "media_url", "set", "null", "critical"));
    } else {
      const audio = await checkUrlReachable(ep.media_url);
      if (!audio.ok) {
        issues.push(issue(platform, "audio_url", "200", `${audio.status ?? "unreachable"}`, "critical", audio.transient));
      }
    }
  }

  if (g.has("public") && ep.share_url && !ctx.isPremium && ep.status === "published") {
    const reach = await checkUrlReachable(ep.share_url);
    if (!reach.ok) {
      issues.push(issue(platform, "public_url", "200", `${reach.status ?? "unreachable"}`, "critical", reach.transient));
    }
  }
  return issues;
}

async function websiteChecks(postId: string, ctx: CheckCtx): Promise<VerificationIssue[]> {
  const wpApiUrl = process.env.WP_API_URL;
  if (!wpApiUrl) {
    return [issue("website", "api_check", "accessible", "WP_API_URL not configured", "critical")];
  }
  const wpAuth =
    "Basic " + Buffer.from(`${process.env.WP_APP_USER}:${process.env.WP_APP_PASSWORD}`).toString("base64");
  const res = await fetchWithRetry(
    `${wpApiUrl}/swm_episode/${encodeURIComponent(postId)}?_fields=id,title,featured_media,status,link`,
    { headers: { Authorization: wpAuth } },
    `WP swm_episode ${postId}`
  );
  if (!res.ok) return [apiIssue("website", res.status)];

  const post = (await res.json()) as {
    id: number;
    title: { rendered: string };
    featured_media: number;
    status: string;
    link: string;
  };
  const issues: VerificationIssue[] = [];
  const g = ctx.groups;

  if (g.has("metadata")) {
    if (normalizeTitle(post.title.rendered) !== normalizeTitle(ctx.expectedTitle)) {
      issues.push(issue("website", "title", ctx.expectedTitle, post.title.rendered, "critical"));
    }
    if (!post.featured_media) {
      // Cosmetic: the theme falls back to the YouTube thumbnail meta. Filled
      // in by the deferred thumbnail backfill.
      issues.push(issue("website", "thumbnail", "featured image", "none", "warning"));
    }
  }

  if (g.has("processing")) {
    const okStatus =
      post.status === "publish" || post.status === "future" || (ctx.isDraft && post.status === "draft");
    if (!okStatus) {
      issues.push(issue("website", "status", ctx.isDraft ? "draft" : "publish", post.status, "critical"));
    }
  }

  // Future-dated and draft posts 404 publicly by design.
  if (g.has("public") && post.link && post.status === "publish") {
    const reach = await checkUrlReachable(post.link);
    if (!reach.ok) {
      issues.push(issue("website", "public_url", "200", `${reach.status ?? "unreachable"}`, "critical", reach.transient));
    }
  }
  return issues;
}

async function safeCheck(platform: string, fn: () => Promise<VerificationIssue[]>): Promise<PlatformTierResult> {
  try {
    const issues = await fn();
    return { platform, passed: !issues.some((i) => i.severity === "critical"), issues };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error(`[verify] ${platform} check threw:`, err);
    return {
      platform,
      passed: false,
      issues: [issue(platform, "exception", "no error", msg, "critical", true)],
    };
  }
}

// --------------------------- Public entry --------------------------------

export interface RunTierOptions {
  isLiveRecording?: boolean;
  isPremium?: boolean;
  isDraft?: boolean;
}

/**
 * Run one verification tier for all completed platforms on a job (plus the
 * network Transistor cross-post, if one was recorded) and persist the result
 * into job.metadata.verifications.
 *
 * A platform "passes" a tier when it has no critical issues; warnings are
 * recorded and shown but never fail it.
 */
export async function runVerificationTier(
  tier: TierNumber,
  jobId: string,
  wpShowId: number,
  expectedTitle: string,
  options: RunTierOptions = {}
): Promise<TierResult> {
  const [platforms, job] = await Promise.all([
    db.distributionJobPlatform.findMany({ where: { jobId, status: "completed" } }),
    db.distributionJob.findUnique({ where: { id: jobId }, select: { metadata: true } }),
  ]);
  const meta = (job?.metadata as Record<string, unknown> | null) ?? {};

  const ctx: CheckCtx = {
    jobId,
    wpShowId,
    expectedTitle,
    isLiveRecording: options.isLiveRecording ?? false,
    isPremium: options.isPremium ?? false,
    isDraft: options.isDraft ?? false,
    tier,
    groups: groupsForTier(tier),
  };

  const checks: Array<Promise<PlatformTierResult>> = platforms.map((p) => {
    if (!p.externalId) {
      return Promise.resolve({
        platform: p.platform,
        passed: false,
        issues: [issue(p.platform, "externalId", "set", "missing", "critical")],
      });
    }
    const id = p.externalId;
    if (p.platform === "youtube") return safeCheck("youtube", () => youtubeChecks(id, ctx));
    if (p.platform === "transistor") {
      return safeCheck("transistor", () =>
        transistorChecks(id, ctx, { platform: "transistor", credentialShowId: wpShowId })
      );
    }
    if (p.platform === "website") return safeCheck("website", () => websiteChecks(id, ctx));
    return Promise.resolve({ platform: p.platform, passed: true, issues: [] });
  });

  // Network Transistor cross-post (Sunset Lounge feed) — recorded by the
  // processor since it has no DistributionJobPlatform row of its own.
  const networkEpisodeId = meta.networkTransistorEpisodeId;
  if (typeof networkEpisodeId === "string" && networkEpisodeId) {
    checks.push(
      safeCheck("transistor_network", () =>
        transistorChecks(networkEpisodeId, ctx, { platform: "transistor_network", credentialShowId: 0 })
      )
    );
  }

  const platformResults = await Promise.all(checks);
  const tierResult: TierResult = { tier, ranAt: new Date().toISOString(), platforms: platformResults };

  // Persist into job.metadata.verifications. Read + merge under the same row
  // lock so concurrent tiers can't drop each other's results.
  try {
    await db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ metadata: unknown }>>`
        SELECT metadata FROM distribution_jobs WHERE id = ${jobId} FOR UPDATE
      `;
      if (rows.length === 0) return;
      const m = (rows[0].metadata as Record<string, unknown>) ?? {};
      const existing = (m.verifications as TierResult[] | undefined) ?? [];
      m.verifications = [...existing.filter((v) => v.tier !== tier), tierResult];
      await tx.distributionJob.update({
        where: { id: jobId },
        data: { metadata: JSON.parse(JSON.stringify(m)) },
      });
    });
  } catch (err) {
    console.warn("[verify] could not persist tier result:", err);
  }

  const failed = platformResults.filter((p) => !p.passed).map((p) => p.platform);
  const warned = platformResults
    .filter((p) => p.passed && p.issues.length > 0)
    .map((p) => p.platform);
  console.log(
    `[verify] tier ${tier} (${TIER_LABELS[tier]}, ${TIER_INFO[tier].whenLabel}) for job ${jobId}: ` +
      (failed.length ? `FAILED ${failed.join(", ")}` : "PASSED") +
      (warned.length ? ` (warnings: ${warned.join(", ")})` : "")
  );
  for (const p of platformResults) {
    for (const i of p.issues) {
      console.log(
        `[verify]   ${i.severity ?? "critical"} ${i.platform}.${i.field}: expected "${i.expected}", got "${i.actual}"${i.transient ? " (transient)" : ""}`
      );
    }
  }

  return tierResult;
}
