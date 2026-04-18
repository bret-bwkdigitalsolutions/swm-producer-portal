import { db } from "@/lib/db";
import { getTransistorApiKey, getYouTubeAccessToken } from "@/lib/analytics/credentials";

const YOUTUBE_API_URL = "https://www.googleapis.com/youtube/v3";
const TRANSISTOR_API_URL = "https://api.transistor.fm/v1";

/** Abort signal with a 30-second timeout for platform API calls. */
function fetchTimeout(): AbortSignal {
  return AbortSignal.timeout(30_000);
}

/**
 * Normalize a title for comparison by folding smart quotes, em-dashes,
 * and other typographic substitutions that platforms apply automatically.
 */
function normalizeTitle(title: string): string {
  return title
    // Decode HTML numeric entities (WP returns &#8217; etc.)
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    // Decode named HTML entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // Fold smart quotes to straight quotes
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    // Fold em/en dashes
    .replace(/[\u2013\u2014]/g, "-")
    // Collapse whitespace
    .replace(/\s+/g, " ")
    .trim();
}

interface VerificationIssue {
  platform: string;
  field: string;
  expected: string;
  actual: string;
}

interface VerificationResult {
  jobId: string;
  verified: boolean;
  issues: VerificationIssue[];
}

/**
 * Verify that title and thumbnail made it to each platform after distribution.
 * Checks the actual platform APIs to confirm data matches what we sent.
 *
 * Called automatically after distribution completes. Non-fatal — logs issues
 * and sends a notification if anything is missing, but doesn't fail the job.
 *
 * @param isLiveRecording - When true, skip YouTube verification (video was
 *   uploaded externally and our OAuth token may not have read access).
 */
export async function verifyDistribution(
  jobId: string,
  wpShowId: number,
  expectedTitle: string,
  isLiveRecording = false,
): Promise<VerificationResult> {
  const platforms = await db.distributionJobPlatform.findMany({
    where: { jobId, status: "completed" },
  });

  // Run checks in parallel and collect results as arrays (avoids shared mutable array)
  const checkResults = await Promise.all(
    platforms.map(async (platform): Promise<VerificationIssue[]> => {
      try {
        switch (platform.platform) {
          case "youtube":
            // Skip verification for live recordings — the video was uploaded
            // externally and our OAuth token may not have read access.
            if (isLiveRecording) return [];
            if (platform.externalId) {
              return verifyYouTube(wpShowId, platform.externalId, expectedTitle);
            }
            return [];

          case "transistor":
            if (platform.externalId) {
              return verifyTransistor(wpShowId, platform.externalId, expectedTitle);
            }
            return [];

          case "website":
            if (platform.externalId) {
              return verifyWordPress(platform.externalId, expectedTitle);
            }
            return [];

          default:
            return [];
        }
      } catch (error) {
        console.error(
          `[verify] Failed to verify ${platform.platform}:`,
          error instanceof Error ? error.message : error
        );
        return [{
          platform: platform.platform,
          field: "api_check",
          expected: "accessible",
          actual: `verification failed: ${error instanceof Error ? error.message : "unknown error"}`,
        }];
      }
    })
  );

  const issues = checkResults.flat();
  const verified = issues.length === 0;

  // Store verification result on the job (guard against deleted job)
  try {
    const job = await db.distributionJob.findUnique({
      where: { id: jobId },
      select: { metadata: true },
    });
    if (job) {
      const meta = (job.metadata as Record<string, unknown>) ?? {};
      meta.verification = {
        verified,
        verifiedAt: new Date().toISOString(),
        issues: issues.map((i) => ({ ...i })),
      };
      await db.distributionJob.update({
        where: { id: jobId },
        data: { metadata: JSON.parse(JSON.stringify(meta)) },
      });
    }
  } catch (error) {
    console.warn("[verify] Could not persist verification result:", error);
  }

  if (verified) {
    console.log(`[verify] Job ${jobId}: all platforms verified ✓`);
  } else {
    console.warn(
      `[verify] Job ${jobId}: ${issues.length} issue(s) found:`,
      issues.map((i) => `${i.platform}.${i.field}: expected "${i.expected}", got "${i.actual}"`).join("; ")
    );
  }

  return { jobId, verified, issues };
}

// --- Platform-specific checks ---

async function verifyYouTube(
  wpShowId: number,
  videoId: string,
  expectedTitle: string
): Promise<VerificationIssue[]> {
  const accessToken = await getYouTubeAccessToken(wpShowId);
  if (!accessToken) {
    return [{
      platform: "youtube",
      field: "api_check",
      expected: "accessible",
      actual: "no access token available",
    }];
  }

  const res = await fetch(
    `${YOUTUBE_API_URL}/videos?id=${videoId}&part=snippet`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: fetchTimeout(),
    }
  );

  if (!res.ok) {
    return [{
      platform: "youtube",
      field: "api_check",
      expected: "accessible",
      actual: `API returned ${res.status}`,
    }];
  }

  const data = (await res.json()) as {
    items?: Array<{
      snippet: {
        title: string;
        thumbnails: Record<string, { url: string }>;
      };
    }>;
  };

  const video = data.items?.[0];
  if (!video) {
    return [{
      platform: "youtube",
      field: "video",
      expected: "exists",
      actual: "not found",
    }];
  }

  const issues: VerificationIssue[] = [];

  if (normalizeTitle(video.snippet.title) !== normalizeTitle(expectedTitle)) {
    issues.push({
      platform: "youtube",
      field: "title",
      expected: expectedTitle,
      actual: video.snippet.title,
    });
  }

  const thumbs = video.snippet.thumbnails;
  if (!thumbs.maxres && !thumbs.high) {
    issues.push({
      platform: "youtube",
      field: "thumbnail",
      expected: "custom thumbnail (maxres or high)",
      actual: "only default thumbnails present",
    });
  }

  return issues;
}

async function verifyTransistor(
  wpShowId: number,
  episodeId: string,
  expectedTitle: string
): Promise<VerificationIssue[]> {
  const apiKey = await getTransistorApiKey(wpShowId);
  if (!apiKey) {
    return [{
      platform: "transistor",
      field: "api_check",
      expected: "accessible",
      actual: "no API key available",
    }];
  }

  const res = await fetch(`${TRANSISTOR_API_URL}/episodes/${episodeId}`, {
    headers: { "x-api-key": apiKey },
    signal: fetchTimeout(),
  });

  if (!res.ok) {
    return [{
      platform: "transistor",
      field: "api_check",
      expected: "accessible",
      actual: `API returned ${res.status}`,
    }];
  }

  const data = (await res.json()) as {
    data?: {
      attributes: {
        title: string;
        image_url: string | null;
      };
    };
  };

  const episode = data.data;
  if (!episode) {
    return [{
      platform: "transistor",
      field: "episode",
      expected: "exists",
      actual: "not found",
    }];
  }

  const issues: VerificationIssue[] = [];

  if (normalizeTitle(episode.attributes.title) !== normalizeTitle(expectedTitle)) {
    issues.push({
      platform: "transistor",
      field: "title",
      expected: expectedTitle,
      actual: episode.attributes.title,
    });
  }

  if (!episode.attributes.image_url) {
    issues.push({
      platform: "transistor",
      field: "thumbnail",
      expected: "image_url present",
      actual: "null or empty",
    });
  }

  return issues;
}

async function verifyWordPress(
  postId: string,
  expectedTitle: string
): Promise<VerificationIssue[]> {
  const wpApiUrl = process.env.WP_API_URL;
  if (!wpApiUrl) {
    return [{
      platform: "website",
      field: "api_check",
      expected: "accessible",
      actual: "WP_API_URL not configured",
    }];
  }

  const wpAuth =
    "Basic " +
    Buffer.from(
      `${process.env.WP_APP_USER}:${process.env.WP_APP_PASSWORD}`
    ).toString("base64");

  const res = await fetch(
    `${wpApiUrl}/swm_episode/${postId}?_fields=id,title,featured_media`,
    {
      headers: { Authorization: wpAuth },
      signal: fetchTimeout(),
    }
  );

  if (!res.ok) {
    return [{
      platform: "website",
      field: "api_check",
      expected: "accessible",
      actual: `API returned ${res.status}`,
    }];
  }

  const post = (await res.json()) as {
    id: number;
    title: { rendered: string };
    featured_media: number;
  };

  const issues: VerificationIssue[] = [];

  if (normalizeTitle(post.title.rendered) !== normalizeTitle(expectedTitle)) {
    issues.push({
      platform: "website",
      field: "title",
      expected: expectedTitle,
      actual: post.title.rendered,
    });
  }

  if (!post.featured_media || post.featured_media === 0) {
    issues.push({
      platform: "website",
      field: "thumbnail",
      expected: "featured_media set",
      actual: "no featured image",
    });
  }

  return issues;
}
