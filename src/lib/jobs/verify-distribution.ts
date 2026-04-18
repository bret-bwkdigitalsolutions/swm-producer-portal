import { db } from "@/lib/db";
import { getTransistorApiKey, getYouTubeAccessToken } from "@/lib/analytics/credentials";

const YOUTUBE_API_URL = "https://www.googleapis.com/youtube/v3";
const TRANSISTOR_API_URL = "https://api.transistor.fm/v1";

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
 */
export async function verifyDistribution(
  jobId: string,
  wpShowId: number,
  expectedTitle: string
): Promise<VerificationResult> {
  const platforms = await db.distributionJobPlatform.findMany({
    where: { jobId, status: "completed" },
  });

  const issues: VerificationIssue[] = [];

  const checks = platforms.map(async (platform) => {
    try {
      switch (platform.platform) {
        case "youtube":
          if (platform.externalId) {
            const ytIssues = await verifyYouTube(
              wpShowId,
              platform.externalId,
              expectedTitle
            );
            issues.push(...ytIssues);
          }
          break;

        case "transistor":
          if (platform.externalId) {
            const trIssues = await verifyTransistor(
              wpShowId,
              platform.externalId,
              expectedTitle
            );
            issues.push(...trIssues);
          }
          break;

        case "website":
          if (platform.externalId) {
            const wpIssues = await verifyWordPress(
              platform.externalId,
              expectedTitle
            );
            issues.push(...wpIssues);
          }
          break;
      }
    } catch (error) {
      console.error(
        `[verify] Failed to verify ${platform.platform}:`,
        error instanceof Error ? error.message : error
      );
      issues.push({
        platform: platform.platform,
        field: "api_check",
        expected: "accessible",
        actual: `verification failed: ${error instanceof Error ? error.message : "unknown error"}`,
      });
    }
  });

  await Promise.all(checks);

  const verified = issues.length === 0;

  // Store verification result on the job
  const job = await db.distributionJob.findUnique({
    where: { id: jobId },
    select: { metadata: true },
  });
  const meta = (job?.metadata as Record<string, unknown>) ?? {};
  meta.verification = {
    verified,
    verifiedAt: new Date().toISOString(),
    issues,
  };
  await db.distributionJob.update({
    where: { id: jobId },
    data: { metadata: meta as any },
  });

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
    { headers: { Authorization: `Bearer ${accessToken}` } }
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

  if (video.snippet.title !== expectedTitle) {
    issues.push({
      platform: "youtube",
      field: "title",
      expected: expectedTitle,
      actual: video.snippet.title,
    });
  }

  // YouTube always has a default thumbnail, but check for maxres or high
  // which indicates a custom thumbnail was set (or the video has been processed)
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

  if (episode.attributes.title !== expectedTitle) {
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
    { headers: { Authorization: wpAuth } }
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

  // Decode HTML entities for comparison (WP encodes & as &amp; etc.)
  const actualTitle = post.title.rendered
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");

  if (actualTitle !== expectedTitle) {
    issues.push({
      platform: "website",
      field: "title",
      expected: expectedTitle,
      actual: actualTitle,
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
