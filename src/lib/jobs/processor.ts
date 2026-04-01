import { db } from "@/lib/db";
import { generateAiSuggestions } from "./ai-processor";
import { extractAudio } from "./audio-extractor";
import { uploadToYouTube, addToPlaylist, setThumbnail } from "@/lib/platforms/youtube";
import { uploadToTransistor } from "@/lib/platforms/transistor";
import { publishToWordPress } from "@/lib/platforms/wordpress";
import { sendDistributionErrorNotification } from "@/lib/notifications";
import { resolvePlatformId } from "@/lib/analytics/credentials";
import { generateSignedDownloadUrl } from "@/lib/gcs";
import { createWriteStream } from "node:fs";
import { unlink, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

export interface ProcessingResult {
  jobId: string;
  status: "completed" | "awaiting_review" | "failed";
  platformResults: {
    platform: string;
    status: "completed" | "failed";
    error?: string;
  }[];
}

/**
 * Process a specific distribution job by ID.
 * Uploads to platforms in dependency order:
 *   1. YouTube (first — WordPress needs the video URL)
 *   2. Transistor (parallel-safe, uses extracted audio)
 *   3. WordPress (last — needs YouTube URL for embed)
 */
export async function processJob(jobId: string): Promise<ProcessingResult> {
  const job = await db.distributionJob.findUnique({
    where: { id: jobId },
    include: {
      platforms: true,
    },
  });

  if (!job) {
    throw new Error(`Job ${jobId} not found.`);
  }

  // Mark as processing
  await db.distributionJob.update({
    where: { id: jobId },
    data: { status: "processing" },
  });

  console.log(
    `[processor] Processing job ${job.id}: "${job.title}" (${job.platforms.length} platforms)`
  );

  const metadata = job.metadata as Record<string, unknown>;
  const platformResults: ProcessingResult["platformResults"] = [];

  // Look up show hosts for Transistor author field
  const showMeta = await db.showMetadata.findUnique({
    where: { wpShowId: job.wpShowId },
  });
  const showHosts = showMeta?.hosts ?? undefined;

  // Extract audio if needed (for Transistor — skip if already completed)
  let gcsAudioPath: string | null = null;
  const transistorNeedsWork = job.platforms.some(
    (p) => p.platform === "transistor" && p.status !== "completed"
  );
  if (transistorNeedsWork && job.gcsPath) {
    try {
      gcsAudioPath = await extractAudio(job.gcsPath);
    } catch (error) {
      console.error("[processor] Audio extraction failed:", error);
      // Mark Transistor as failed but continue with other platforms
      const transistorPlatform = job.platforms.find(
        (p) => p.platform === "transistor"
      );
      if (transistorPlatform) {
        const errMsg =
          error instanceof Error ? error.message : "Audio extraction failed";
        await db.distributionJobPlatform.update({
          where: { id: transistorPlatform.id },
          data: { status: "failed", error: errMsg },
        });
        platformResults.push({
          platform: "transistor",
          status: "failed",
          error: errMsg,
        });
      }
    }
  }

  // Download video to temp file (for YouTube upload — skip if already completed)
  let tempVideoPath: string | null = null;
  const youtubeNeedsWork = job.platforms.some(
    (p) => p.platform === "youtube" && p.status !== "completed"
  );
  if (youtubeNeedsWork && job.gcsPath) {
    try {
      const tempDir = await mkdtemp(join(tmpdir(), "swm-yt-"));
      tempVideoPath = join(tempDir, "video.mp4");
      const downloadUrl = await generateSignedDownloadUrl(job.gcsPath);
      const response = await fetch(downloadUrl);
      if (!response.ok || !response.body) {
        throw new Error(`Failed to download video: ${response.status}`);
      }
      const fileStream = createWriteStream(tempVideoPath);
      await pipeline(Readable.fromWeb(response.body as any), fileStream);
    } catch (error) {
      console.error("[processor] Video download failed:", error);
      tempVideoPath = null;
    }
  }

  // --- Phase 1: YouTube (must complete first for WordPress) ---
  let youtubeUrl: string | null = null;
  let youtubeVideoId: string | null = null;
  const youtubePlatform = job.platforms.find((p) => p.platform === "youtube");

  if (youtubePlatform && youtubePlatform.status === "completed") {
    // Already completed — preserve the result for WordPress
    youtubeUrl = youtubePlatform.externalUrl;
    youtubeVideoId = youtubePlatform.externalId;
    platformResults.push({ platform: "youtube", status: "completed" });
  } else if (youtubePlatform) {
    await db.distributionJobPlatform.update({
      where: { id: youtubePlatform.id },
      data: { status: "uploading" },
    });

    try {
      if (!tempVideoPath) {
        throw new Error("Video file not available for YouTube upload.");
      }

      const description = (metadata.description as string) ?? "";
      const chapters = (metadata.chapters as string) ?? "";
      const fullDescription = chapters
        ? `${description}\n\n${chapters}`
        : description;
      const tags = (metadata.tags as string[]) ?? [];
      const isDraft = (metadata.isDraft as boolean) ?? false;

      const result = await uploadToYouTube({
        wpShowId: job.wpShowId,
        title: job.title,
        description: fullDescription,
        tags,
        privacy: isDraft ? "unlisted" : "public",
        videoFilePath: tempVideoPath,
      });

      youtubeUrl = result.videoUrl;
      youtubeVideoId = result.videoId;

      await db.distributionJobPlatform.update({
        where: { id: youtubePlatform.id },
        data: {
          status: "completed",
          externalId: result.videoId,
          externalUrl: result.videoUrl,
          completedAt: new Date(),
        },
      });

      // Set custom thumbnail if one was uploaded
      const thumbnailGcsPath = metadata.thumbnailGcsPath as string | undefined;
      if (thumbnailGcsPath && youtubeVideoId) {
        try {
          const thumbDir = await mkdtemp(join(tmpdir(), "swm-thumb-"));
          const thumbPath = join(thumbDir, "thumbnail.jpg");
          const thumbUrl = await generateSignedDownloadUrl(thumbnailGcsPath);
          const thumbResponse = await fetch(thumbUrl);
          if (thumbResponse.ok && thumbResponse.body) {
            const thumbStream = createWriteStream(thumbPath);
            await pipeline(Readable.fromWeb(thumbResponse.body as any), thumbStream);
            await setThumbnail(job.wpShowId, youtubeVideoId, thumbPath);
            await unlink(thumbPath).catch(() => {});
          }
        } catch (error) {
          console.error("[processor] Thumbnail set failed (non-fatal):", error);
        }
      }

      // Add to show playlist if configured
      const playlistUrl = await resolvePlatformId(
        job.wpShowId,
        "youtube_playlist"
      );
      if (playlistUrl && youtubeVideoId) {
        const playlistId = playlistUrl.split("list=").pop() ?? playlistUrl;
        await addToPlaylist(job.wpShowId, playlistId, youtubeVideoId);
      }

      platformResults.push({ platform: "youtube", status: "completed" });
    } catch (error) {
      const errMsg =
        error instanceof Error ? error.message : "YouTube upload failed";
      console.error(`[processor] YouTube failed: ${errMsg}`);
      await db.distributionJobPlatform.update({
        where: { id: youtubePlatform.id },
        data: { status: "failed", error: errMsg },
      });
      platformResults.push({
        platform: "youtube",
        status: "failed",
        error: errMsg,
      });
    }
  }

  // Clean up temp video file
  if (tempVideoPath) {
    await unlink(tempVideoPath).catch(() => {});
  }

  // --- Phase 2: Transistor (independent of YouTube) ---
  const transistorPlatform = job.platforms.find(
    (p) => p.platform === "transistor"
  );

  if (transistorPlatform && transistorPlatform.status === "completed") {
    platformResults.push({ platform: "transistor", status: "completed" });
  } else if (
    transistorPlatform &&
    !platformResults.some(
      (r) => r.platform === "transistor" && r.status === "failed"
    )
  ) {
    await db.distributionJobPlatform.update({
      where: { id: transistorPlatform.id },
      data: { status: "uploading" },
    });

    try {
      if (!gcsAudioPath) {
        throw new Error("Audio file not available for Transistor upload.");
      }

      const result = await uploadToTransistor({
        wpShowId: job.wpShowId,
        title: job.title,
        description: (metadata.description as string) ?? "",
        seasonNumber: (metadata.seasonNumber as number) ?? undefined,
        episodeNumber: (metadata.episodeNumber as number) ?? undefined,
        gcsAudioPath,
        chapters: (metadata.chapters as string) ?? undefined,
        tags: (metadata.tags as string[]) ?? undefined,
        thumbnailGcsPath: (metadata.thumbnailGcsPath as string) ?? undefined,
        author: showHosts,
        transcript: (metadata.transcript as string) ?? undefined,
        youtubeVideoUrl: youtubeUrl ?? undefined,
        explicit: (metadata.explicit as boolean) ?? undefined,
      });

      await db.distributionJobPlatform.update({
        where: { id: transistorPlatform.id },
        data: {
          status: "completed",
          externalId: result.episodeId,
          externalUrl: result.episodeUrl,
          completedAt: new Date(),
        },
      });

      platformResults.push({ platform: "transistor", status: "completed" });

      // Also publish to the network Transistor feed if this show is part of
      // the Sunset Lounge network (any show that uses the network default
      // Transistor credentials — i.e. doesn't have its own override)
      try {
        const showOverride = await db.platformCredential.findUnique({
          where: { wpShowId_platform: { wpShowId: job.wpShowId, platform: "transistor" } },
        });

        // If no show-specific override exists, this show uses the network default
        // and should also be cross-posted to the network feed
        if (!showOverride) {
          const networkTransistorShow = await db.showPlatformLink.findUnique({
            where: { wpShowId_platform: { wpShowId: 0, platform: "transistor_show" } },
          });

          if (networkTransistorShow?.url) {
            console.log(
              `[processor] Cross-posting to network Transistor feed: ${networkTransistorShow.url}`
            );
            await uploadToTransistor({
              wpShowId: 0, // Use network credentials
              title: job.title,
              description: (metadata.description as string) ?? "",
              seasonNumber: (metadata.seasonNumber as number) ?? undefined,
              episodeNumber: (metadata.episodeNumber as number) ?? undefined,
              gcsAudioPath: gcsAudioPath!,
              chapters: (metadata.chapters as string) ?? undefined,
              tags: (metadata.tags as string[]) ?? undefined,
              thumbnailGcsPath: (metadata.thumbnailGcsPath as string) ?? undefined,
              author: showHosts,
              transcript: (metadata.transcript as string) ?? undefined,
              youtubeVideoUrl: youtubeUrl ?? undefined,
              explicit: (metadata.explicit as boolean) ?? undefined,
            });
            console.log("[processor] Network Transistor cross-post succeeded");
          }
        }
      } catch (networkErr) {
        // Non-fatal: log but don't fail the job
        console.error("[processor] Network Transistor cross-post failed:", networkErr);
      }
    } catch (error) {
      const errMsg =
        error instanceof Error ? error.message : "Transistor upload failed";
      console.error(`[processor] Transistor failed: ${errMsg}`);
      await db.distributionJobPlatform.update({
        where: { id: transistorPlatform.id },
        data: { status: "failed", error: errMsg },
      });
      platformResults.push({
        platform: "transistor",
        status: "failed",
        error: errMsg,
      });
    }
  }

  // --- Phase 3: WordPress (needs YouTube URL) ---
  const websitePlatform = job.platforms.find((p) => p.platform === "website");
  if (websitePlatform && websitePlatform.status === "completed") {
    platformResults.push({ platform: "website", status: "completed" });
  } else if (websitePlatform) {
    await db.distributionJobPlatform.update({
      where: { id: websitePlatform.id },
      data: { status: "uploading" },
    });

    try {
      if (!youtubeUrl) {
        throw new Error(
          "YouTube URL not available. WordPress post requires the YouTube embed."
        );
      }

      const description = (metadata.description as string) ?? "";
      const chapters = (metadata.chapters as string) ?? "";
      const isDraft = (metadata.isDraft as boolean) ?? false;
      const scheduleMode = (metadata.scheduleMode as string) ?? "now";
      const scheduledAt = (metadata.scheduledAt as string) ?? undefined;

      const wpStatus: "publish" | "draft" | "future" = isDraft
        ? "draft"
        : scheduleMode === "schedule"
          ? "future"
          : "publish";

      const result = await publishToWordPress({
        wpShowId: job.wpShowId,
        title: job.title,
        description,
        chapters: chapters || undefined,
        youtubeUrl,
        status: wpStatus,
        scheduledDate: wpStatus === "future" ? scheduledAt : undefined,
        portalUserId: job.userId,
      });

      await db.distributionJobPlatform.update({
        where: { id: websitePlatform.id },
        data: {
          status: "completed",
          externalId: String(result.postId),
          externalUrl: result.postUrl,
          completedAt: new Date(),
        },
      });

      platformResults.push({ platform: "website", status: "completed" });
    } catch (error) {
      const errMsg =
        error instanceof Error ? error.message : "WordPress publish failed";
      console.error(`[processor] WordPress failed: ${errMsg}`);
      await db.distributionJobPlatform.update({
        where: { id: websitePlatform.id },
        data: { status: "failed", error: errMsg },
      });
      platformResults.push({
        platform: "website",
        status: "failed",
        error: errMsg,
      });
    }
  }

  // --- Handle any remaining platforms (Spotify, Apple — future) ---
  for (const p of job.platforms) {
    if (!platformResults.some((r) => r.platform === p.platform)) {
      await db.distributionJobPlatform.update({
        where: { id: p.id },
        data: { status: "failed", error: `Platform "${p.platform}" is not yet supported.` },
      });
      platformResults.push({
        platform: p.platform,
        status: "failed",
        error: `Platform "${p.platform}" is not yet supported.`,
      });
    }
  }

  // --- Determine final job status ---
  const allFailed = platformResults.every((r) => r.status === "failed");
  const anyFailed = platformResults.some((r) => r.status === "failed");

  const finalStatus = allFailed ? "failed" : "completed";

  await db.distributionJob.update({
    where: { id: job.id },
    data: { status: finalStatus },
  });

  // --- Send error notification if any platform failed ---
  if (anyFailed) {
    const user = await db.user.findUnique({
      where: { id: job.userId },
      select: { name: true },
    });

    // Resolve show name
    let showName = `Show #${job.wpShowId}`;
    try {
      const { getShow } = await import("@/lib/wordpress/client");
      const show = await getShow(job.wpShowId);
      showName = show.title.rendered;
    } catch {
      // Fall back to ID
    }

    const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

    await sendDistributionErrorNotification({
      jobTitle: job.title,
      showName,
      producerName: user?.name ?? "Unknown",
      failures: platformResults
        .filter((r) => r.status === "failed")
        .map((r) => ({ platform: r.platform, error: r.error ?? "Unknown error" })),
      jobUrl: `${baseUrl}/dashboard/distribute/${job.id}`,
    });
  }

  console.log(`[processor] Job ${job.id} ${finalStatus}.`);

  return { jobId: job.id, status: finalStatus, platformResults };
}
