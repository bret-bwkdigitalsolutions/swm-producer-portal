import { db } from "@/lib/db";
import type { DistributionJobPlatform } from "@prisma/client";
import { generateAiSuggestions } from "./ai-processor";
import { extractAudio } from "./audio-extractor";
import { transcribeAudio, formatTranscriptForAI, formatTranscriptForDisplay } from "@/lib/transcription";
import { uploadToYouTube, addToPlaylist, setThumbnail } from "@/lib/platforms/youtube";
import { uploadToTransistor } from "@/lib/platforms/transistor";
import { publishToWordPress } from "@/lib/platforms/wordpress";
import { sendDistributionErrorNotification, sendVerificationFailureNotification } from "@/lib/notifications";
import { verifyDistribution } from "./verify-distribution";
import { resolvePlatformId } from "@/lib/analytics/credentials";
import { generateSignedDownloadUrl, uploadBuffer } from "@/lib/gcs";
import { extractYoutubeVideoId } from "@/lib/youtube-url";
import { downloadYouTubeVideoToGcs } from "./youtube-video-downloader";
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
// 30 minutes — large videos need time for YouTube + 2x Transistor uploads
const JOB_TIMEOUT_MS = 30 * 60 * 1000;

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

  // Wrap the actual work in a timeout so hangs (e.g. thumbnail upload)
  // don't leave the job stuck in "processing" forever.
  try {
    return await Promise.race([
      processJobInner(job),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Job timed out after 30 minutes")),
          JOB_TIMEOUT_MS
        )
      ),
    ]);
  } catch (error) {
    const errMsg =
      error instanceof Error ? error.message : "Processing failed unexpectedly";
    console.error(`[processor] Job ${jobId} failed with timeout or error: ${errMsg}`);

    // Mark any in-progress platforms as failed
    for (const platform of job.platforms) {
      if (platform.status !== "completed" && platform.status !== "failed") {
        await db.distributionJobPlatform.update({
          where: { id: platform.id },
          data: { status: "failed", error: errMsg },
        }).catch(() => {}); // best-effort
      }
    }

    await db.distributionJob.update({
      where: { id: jobId },
      data: { status: "failed" },
    }).catch(() => {}); // best-effort

    // Send error notification
    try {
      const user = await db.user.findUnique({
        where: { id: job.userId },
        select: { name: true },
      });

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
        failures: [{ platform: "system", error: errMsg }],
        jobUrl: `${baseUrl}/dashboard/distribute/${job.id}`,
      });
    } catch {
      // Don't let notification failure mask the real error
    }

    return {
      jobId: job.id,
      status: "failed",
      platformResults: job.platforms.map((p) => ({
        platform: p.platform,
        status: "failed" as const,
        error: errMsg,
      })),
    };
  }
}

async function processJobInner(
  job: Awaited<ReturnType<typeof db.distributionJob.findUnique>> & { platforms: DistributionJobPlatform[] }
): Promise<ProcessingResult> {

  console.log(
    `[processor] Processing job ${job.id}: "${job.title}" (${job.platforms.length} platforms)`
  );

  const metadata = job.metadata as Record<string, unknown>;
  const platformResults: ProcessingResult["platformResults"] = [];

  const existingYoutubeUrl = metadata.existingYoutubeUrl as string | undefined;

  // For live YouTube recordings: download audio from YouTube to GCS.
  // This gives us an mp3 directly — no need for the extractAudio step.
  let effectiveGcsPath: string | null = job.gcsPath;
  // On retry, gcsPath is already set from the first run. If this is a live
  // recording, that file is already an mp3 — skip extractAudio.
  let youtubeAudioPath: string | null =
    existingYoutubeUrl && effectiveGcsPath ? effectiveGcsPath : null;
  if (existingYoutubeUrl && !effectiveGcsPath) {
    console.log(`[processor] Live YouTube recording — downloading audio from ${existingYoutubeUrl}`);
    const downloadedPath = await downloadYouTubeVideoToGcs(existingYoutubeUrl, job.id);
    await db.distributionJob.update({
      where: { id: job.id },
      data: { gcsPath: downloadedPath },
    });
    effectiveGcsPath = downloadedPath;
    youtubeAudioPath = downloadedPath; // Already audio — skip extractAudio later
    console.log(`[processor] YouTube audio downloaded to GCS: ${downloadedPath}`);
  }

  // Look up show hosts for Transistor author field
  const showMeta = await db.showMetadata.findUnique({
    where: { wpShowId: job.wpShowId },
  });
  const showHosts = showMeta?.hosts ?? undefined;

  // Extract audio if needed (for Transistor — skip if already completed)
  let gcsAudioPath: string | null = youtubeAudioPath; // Already set if downloaded from YouTube
  const transistorNeedsWork = job.platforms.some(
    (p) => p.platform === "transistor" && p.status !== "completed"
  );
  if (transistorNeedsWork && effectiveGcsPath && !gcsAudioPath) {
    try {
      gcsAudioPath = await extractAudio(effectiveGcsPath);
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

  // --- Transcription + AI Processing ---
  let transcript: string | null = null;
  if (gcsAudioPath) {
    try {
      console.log("[processor] Starting transcription...");
      const transcriptionResult = await transcribeAudio(gcsAudioPath);
      const formattedTranscript = formatTranscriptForAI(transcriptionResult.segments);
      const displayTranscript = formatTranscriptForDisplay(transcriptionResult.segments);
      transcript = displayTranscript;

      // Store transcript in job metadata
      const currentMetadata = job.metadata as Record<string, unknown>;
      await db.distributionJob.update({
        where: { id: job.id },
        data: {
          metadata: {
            ...currentMetadata,
            transcript: transcriptionResult.fullText,
            transcriptDisplay: displayTranscript,
            transcriptTimestamped: formattedTranscript,
            detectedLanguage: transcriptionResult.language,
            audioDuration: transcriptionResult.duration,
          },
        },
      });

      // Generate AI suggestions from transcript
      console.log("[processor] Generating AI suggestions...");
      await generateAiSuggestions(job.id, formattedTranscript, transcriptionResult.language);
      console.log("[processor] AI suggestions complete.");
    } catch (error) {
      console.error("[processor] Transcription/AI processing failed (non-fatal):", error);
      // Non-fatal: continue with platform uploads even if transcription fails
      // Try AI suggestions without transcript (uses title/description)
      try {
        await generateAiSuggestions(job.id);
      } catch (aiErr) {
        console.error("[processor] AI suggestions also failed:", aiErr);
      }
    }
  }

  // Refresh metadata after potential transcript update
  const updatedJob = await db.distributionJob.findUnique({
    where: { id: job.id },
    select: { metadata: true },
  });
  const updatedMetadata = (updatedJob?.metadata as Record<string, unknown>) ?? metadata;

  // Download video to temp file (for YouTube upload — skip if already completed)
  let tempVideoPath: string | null = null;
  const youtubeNeedsWork = job.platforms.some(
    (p) => p.platform === "youtube" && p.status !== "completed"
  );
  if (youtubeNeedsWork && effectiveGcsPath && !existingYoutubeUrl) {
    try {
      const tempDir = await mkdtemp(join(tmpdir(), "swm-yt-"));
      tempVideoPath = join(tempDir, "video.mp4");
      const downloadUrl = await generateSignedDownloadUrl(effectiveGcsPath);
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
  let youtubeUrl: string | null = existingYoutubeUrl ?? null;
  let youtubeVideoId: string | null = youtubeUrl
    ? extractYoutubeVideoId(youtubeUrl)
    : null;
  const youtubePlatform = job.platforms.find((p) => p.platform === "youtube");

  if (youtubePlatform && youtubePlatform.status === "completed") {
    // Already completed — preserve the result for WordPress
    youtubeUrl = youtubePlatform.externalUrl;
    youtubeVideoId = youtubePlatform.externalId;
    platformResults.push({ platform: "youtube", status: "completed" });
  } else if (youtubePlatform && existingYoutubeUrl) {
    // Live recording — this video is already on YouTube at the provided URL.
    // Mark the platform as completed without re-uploading.
    await db.distributionJobPlatform.update({
      where: { id: youtubePlatform.id },
      data: {
        status: "completed",
        externalId: extractYoutubeVideoId(existingYoutubeUrl) ?? "",
        externalUrl: existingYoutubeUrl,
        completedAt: new Date(),
      },
    });
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
      const scheduleMode = (metadata.scheduleMode as string) ?? "now";
      const scheduledAt = scheduleMode === "schedule"
        ? (metadata.scheduledAt as string) ?? undefined
        : undefined;

      const result = await uploadToYouTube({
        wpShowId: job.wpShowId,
        title: job.title,
        description: fullDescription,
        tags,
        privacy: isDraft ? "unlisted" : "public",
        videoFilePath: tempVideoPath,
        scheduledAt,
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
          const ext = thumbnailGcsPath.match(/\.(jpe?g|png|webp)$/i)?.[0] ?? ".jpg";
          const mimeMap: Record<string, string> = {
            ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".png": "image/png", ".webp": "image/webp",
          };
          const thumbContentType = mimeMap[ext.toLowerCase()] ?? "image/jpeg";

          const thumbDir = await mkdtemp(join(tmpdir(), "swm-thumb-"));
          const thumbPath = join(thumbDir, `thumbnail${ext}`);
          const thumbUrl = await generateSignedDownloadUrl(thumbnailGcsPath);
          const thumbResponse = await fetch(thumbUrl);
          if (thumbResponse.ok && thumbResponse.body) {
            const thumbStream = createWriteStream(thumbPath);
            await pipeline(Readable.fromWeb(thumbResponse.body as any), thumbStream);
            await setThumbnail(job.wpShowId, youtubeVideoId, thumbPath, thumbContentType);
            await unlink(thumbPath).catch(() => {});
            console.log(`[processor] YouTube thumbnail set from ${thumbnailGcsPath}`);
          } else {
            console.error(`[processor] Failed to download thumbnail from GCS (${thumbResponse.status})`);
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

      // Also add to the network YouTube playlist if this show is part of
      // the Sunset Lounge network (uses network default YouTube credentials)
      if (youtubeVideoId) {
        try {
          const showOverride = await db.platformCredential.findUnique({
            where: { wpShowId_platform: { wpShowId: job.wpShowId, platform: "youtube" } },
          });

          if (!showOverride) {
            const networkPlaylist = await db.showPlatformLink.findUnique({
              where: { wpShowId_platform: { wpShowId: 0, platform: "youtube_playlist" } },
            });

            if (networkPlaylist?.url) {
              const networkPlaylistId = networkPlaylist.url.split("list=").pop() ?? networkPlaylist.url;
              console.log(
                `[processor] Adding to network YouTube playlist: ${networkPlaylistId}`
              );
              await addToPlaylist(0, networkPlaylistId, youtubeVideoId);
              console.log("[processor] Network YouTube playlist add succeeded");
            }
          }
        } catch (networkErr) {
          // Non-fatal: log but don't fail the job
          console.error("[processor] Network YouTube playlist add failed:", networkErr);
        }
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

  // Fallback: if no thumbnail was uploaded but we have a YouTube video ID,
  // pull the thumbnail from YouTube and store it in GCS for Transistor/WordPress.
  if (!updatedMetadata.thumbnailGcsPath && youtubeVideoId) {
    try {
      // Try maxresdefault first (1280x720), fall back to hqdefault (480x360)
      let thumbResponse = await fetch(
        `https://i.ytimg.com/vi/${youtubeVideoId}/maxresdefault.jpg`
      );
      if (!thumbResponse.ok) {
        thumbResponse = await fetch(
          `https://i.ytimg.com/vi/${youtubeVideoId}/hqdefault.jpg`
        );
      }

      if (thumbResponse.ok) {
        const buffer = Buffer.from(await thumbResponse.arrayBuffer());
        const gcsPath = await uploadBuffer(
          `yt-thumb-${youtubeVideoId}.jpg`,
          buffer,
          "image/jpeg"
        );

        updatedMetadata.thumbnailGcsPath = gcsPath;

        // Persist to DB so retries and blog posts can also use it
        const currentMeta =
          (
            await db.distributionJob.findUnique({
              where: { id: job.id },
              select: { metadata: true },
            })
          )?.metadata as Record<string, unknown> | null;
        await db.distributionJob.update({
          where: { id: job.id },
          data: { metadata: { ...currentMeta, thumbnailGcsPath: gcsPath } },
        });

        console.log(
          `[processor] YouTube thumbnail fallback saved to GCS: ${gcsPath}`
        );
      }
    } catch (error) {
      console.error(
        "[processor] YouTube thumbnail fallback failed (non-fatal):",
        error
      );
    }
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
        description: (updatedMetadata.description as string) ?? "",
        seasonNumber: (updatedMetadata.seasonNumber as number) ?? undefined,
        episodeNumber: (updatedMetadata.episodeNumber as number) ?? undefined,
        gcsAudioPath,
        chapters: (updatedMetadata.chapters as string) ?? undefined,
        tags: (updatedMetadata.tags as string[]) ?? undefined,
        thumbnailGcsPath: (updatedMetadata.thumbnailGcsPath as string) ?? undefined,
        author: showHosts,
        transcript: transcript ?? (updatedMetadata.transcript as string) ?? undefined,
        youtubeVideoUrl: youtubeUrl ?? undefined,
        explicit: (updatedMetadata.explicit as boolean) ?? undefined,
        isDraft: (updatedMetadata.isDraft as boolean) ?? false,
        scheduledAt: (updatedMetadata.scheduleMode as string) === "schedule"
          ? (updatedMetadata.scheduledAt as string) ?? undefined
          : undefined,
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
              description: (updatedMetadata.description as string) ?? "",
              seasonNumber: (updatedMetadata.seasonNumber as number) ?? undefined,
              episodeNumber: (updatedMetadata.episodeNumber as number) ?? undefined,
              gcsAudioPath: gcsAudioPath!,
              chapters: (updatedMetadata.chapters as string) ?? undefined,
              tags: (updatedMetadata.tags as string[]) ?? undefined,
              thumbnailGcsPath: (updatedMetadata.thumbnailGcsPath as string) ?? undefined,
              author: showHosts,
              transcript: transcript ?? (updatedMetadata.transcript as string) ?? undefined,
              youtubeVideoUrl: youtubeUrl ?? undefined,
              explicit: (updatedMetadata.explicit as boolean) ?? undefined,
              isDraft: (updatedMetadata.isDraft as boolean) ?? false,
              scheduledAt: (updatedMetadata.scheduleMode as string) === "schedule"
                ? (updatedMetadata.scheduledAt as string) ?? undefined
                : undefined,
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

      const description = (updatedMetadata.description as string) ?? "";
      const chapters = (updatedMetadata.chapters as string) ?? "";
      const isDraft = (updatedMetadata.isDraft as boolean) ?? false;
      const scheduleMode = (updatedMetadata.scheduleMode as string) ?? "now";
      const scheduledAt = (updatedMetadata.scheduledAt as string) ?? undefined;

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
        thumbnailGcsPath: (updatedMetadata.thumbnailGcsPath as string) ?? undefined,
        transcript: (updatedMetadata.transcriptDisplay as string) || (updatedMetadata.transcript as string) || undefined,
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

  // --- Post-distribution verification ---
  // Wait a few seconds for platform APIs to be consistent, then verify
  if (finalStatus === "completed" || (!allFailed && anyFailed)) {
    try {
      await new Promise((resolve) => setTimeout(resolve, 60_000));
      const verification = await verifyDistribution(
        job.id, job.wpShowId, job.title, !!existingYoutubeUrl
      );
      if (!verification.verified) {
        let showName = `Show #${job.wpShowId}`;
        try {
          const { getShow } = await import("@/lib/wordpress/client");
          const show = await getShow(job.wpShowId);
          showName = show.title.rendered;
        } catch {
          // Fall back to ID
        }

        const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

        await sendVerificationFailureNotification({
          jobTitle: job.title,
          showName,
          issues: verification.issues,
          jobUrl: `${baseUrl}/dashboard/distribute/${job.id}`,
        });
      }
    } catch (error) {
      console.error("[processor] Post-distribution verification failed:", error);
    }
  }

  return { jobId: job.id, status: finalStatus, platformResults };
}
