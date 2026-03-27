import { db } from "@/lib/db";
import { generateAiSuggestions } from "./ai-processor";
import { extractAudio } from "./audio-extractor";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProcessingResult {
  jobId: string;
  status: "processing" | "awaiting_review" | "failed";
  platformResults: {
    platform: string;
    status: "completed" | "failed";
    error?: string;
  }[];
}

// ---------------------------------------------------------------------------
// Platform upload simulation
// ---------------------------------------------------------------------------

/**
 * Simulate uploading content to a platform. In production this will be
 * replaced with actual API calls to YouTube, Spotify, Apple, etc.
 */
async function simulatePlatformUpload(
  platform: string,
  _jobTitle: string
): Promise<{ externalId: string; externalUrl: string }> {
  // Simulate varying upload durations per platform
  const delayMs: Record<string, number> = {
    youtube: 2000,
    spotify: 1500,
    apple: 1500,
    transistor: 1000,
    patreon: 800,
    website: 500,
  };

  const delay = delayMs[platform] ?? 1000;
  await new Promise((resolve) => setTimeout(resolve, delay));

  console.log(`[processor] Simulated upload to ${platform} completed`);

  return {
    externalId: `sim_${platform}_${Date.now()}`,
    externalUrl: `https://${platform}.example.com/episode/${Date.now()}`,
  };
}

// ---------------------------------------------------------------------------
// Single platform processing
// ---------------------------------------------------------------------------

async function processPlatform(
  platformRecord: { id: string; platform: string },
  jobTitle: string,
  gcsPath: string | null
): Promise<{ platform: string; status: "completed" | "failed"; error?: string }> {
  const { id: platformId, platform } = platformRecord;

  try {
    // Mark as uploading
    await db.distributionJobPlatform.update({
      where: { id: platformId },
      data: { status: "uploading" },
    });

    // For audio-only platforms, extract audio first
    if (platform === "transistor" && gcsPath) {
      await extractAudio(gcsPath);
    }

    // Mark as processing
    await db.distributionJobPlatform.update({
      where: { id: platformId },
      data: { status: "processing" },
    });

    // Simulate the actual upload
    const { externalId, externalUrl } = await simulatePlatformUpload(
      platform,
      jobTitle
    );

    // Mark as completed
    await db.distributionJobPlatform.update({
      where: { id: platformId },
      data: {
        status: "completed",
        externalId,
        externalUrl,
        completedAt: new Date(),
      },
    });

    console.log(`[processor] Platform "${platform}" completed successfully`);
    return { platform, status: "completed" };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error(
      `[processor] Platform "${platform}" failed: ${errorMessage}`
    );

    await db.distributionJobPlatform.update({
      where: { id: platformId },
      data: {
        status: "failed",
        error: errorMessage,
      },
    });

    return { platform, status: "failed", error: errorMessage };
  }
}

// ---------------------------------------------------------------------------
// Main job processor
// ---------------------------------------------------------------------------

/**
 * Find and process the next pending distribution job.
 *
 * Returns `null` if there are no pending jobs. Otherwise returns a
 * `ProcessingResult` describing what happened.
 */
export async function processNextJob(): Promise<ProcessingResult | null> {
  // Atomically claim the oldest pending job
  // Using a transaction to avoid race conditions with concurrent workers
  const job = await db.$transaction(async (tx) => {
    const pending = await tx.distributionJob.findFirst({
      where: { status: "pending" },
      orderBy: { createdAt: "asc" },
      include: { platforms: true },
    });

    if (!pending) return null;

    // Mark as processing so no other worker picks it up
    await tx.distributionJob.update({
      where: { id: pending.id },
      data: { status: "processing" },
    });

    return pending;
  });

  if (!job) {
    console.log("[processor] No pending jobs found.");
    return null;
  }

  console.log(
    `[processor] Processing job ${job.id}: "${job.title}" (${job.platforms.length} platforms)`
  );

  // Process each platform — continue even if some fail
  const platformResults = await Promise.all(
    job.platforms.map((p) =>
      processPlatform(
        { id: p.id, platform: p.platform },
        job.title,
        job.gcsPath
      )
    )
  );

  const allFailed = platformResults.every((r) => r.status === "failed");
  const anySucceeded = platformResults.some((r) => r.status === "completed");

  if (allFailed) {
    // If every platform failed the job is failed
    await db.distributionJob.update({
      where: { id: job.id },
      data: { status: "failed" },
    });

    console.log(`[processor] Job ${job.id} failed — all platforms failed.`);
    return { jobId: job.id, status: "failed", platformResults };
  }

  // At least one platform succeeded — trigger AI processing
  if (anySucceeded) {
    try {
      const metadata = job.metadata as Record<string, unknown>;
      const transcript = (metadata.transcript as string) ?? null;
      await generateAiSuggestions(job.id, transcript);
    } catch (error) {
      // AI failures should not tank the job
      console.error(
        `[processor] AI processing failed for job ${job.id}:`,
        error
      );
    }
  }

  // Move job to awaiting_review — producer needs to review AI suggestions
  await db.distributionJob.update({
    where: { id: job.id },
    data: { status: "awaiting_review" },
  });

  console.log(`[processor] Job ${job.id} moved to awaiting_review.`);
  return { jobId: job.id, status: "awaiting_review", platformResults };
}
