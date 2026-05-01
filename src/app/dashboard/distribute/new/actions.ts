"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { toISOWithTimezone } from "@/lib/timezone";
import { getLatestEpisodeNumbers } from "@/lib/wordpress/client";
import { extractYoutubeVideoId } from "@/lib/youtube-url";

interface FormState {
  success?: boolean;
  message?: string;
  errors?: Record<string, string[]>;
  jobId?: string;
}

const VALID_PLATFORMS = [
  "youtube",
  "spotify",
  "apple",
  "transistor",
  "website",
] as const;

export async function submitDistribution(
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  if (!session.user.hasDistributionAccess && session.user.role !== "admin") {
    redirect("/dashboard");
  }

  // Extract form fields
  const showId = formData.get("show_id") as string | null;
  const title = formData.get("title") as string | null;
  const description = formData.get("description") as string | null;
  const tags = formData.get("tags") as string | null;
  const scheduleMode = formData.get("schedule_mode") as string | null;
  const scheduledAtRaw = formData.get("scheduled_at") as string | null;
  const timezone = formData.get("timezone") as string | null;
  const scheduledAt =
    scheduledAtRaw && scheduleMode === "schedule"
      ? toISOWithTimezone(scheduledAtRaw, timezone)
      : scheduledAtRaw;
  const videoFileName = formData.get("video_file_name") as string | null;
  const videoFileSize = formData.get("video_file_size") as string | null;
  const videoContentType = formData.get("video_content_type") as string | null;
  const existingYoutubeUrl = formData.get("existing_youtube_url") as string | null;
  const seasonNumber = formData.get("season_number") as string | null;
  const episodeNumber = formData.get("episode_number") as string | null;
  const explicit = formData.get("explicit") === "true";

  // Collect selected platforms
  const selectedPlatforms = VALID_PLATFORMS.filter(
    (p) => formData.get(`platform_${p}`) === "on"
  );

  // Validation
  const errors: Record<string, string[]> = {};

  if (!showId) {
    errors.show_id = ["Please select a show."];
  }

  if (!title || title.trim().length === 0) {
    errors.title = ["Title is required."];
  }

  if (!description || description.trim().length === 0) {
    errors.description = ["Description is required."];
  }

  if (selectedPlatforms.length === 0) {
    errors.platforms = ["Select at least one target platform."];
  }

  if (scheduleMode === "schedule" && !scheduledAt) {
    errors.scheduled_at = ["Please select a date and time for scheduling."];
  }

  if (!videoFileName && !existingYoutubeUrl) {
    errors.video_file = ["Please select a video file or provide a YouTube URL."];
  }

  if (existingYoutubeUrl) {
    if (!extractYoutubeVideoId(existingYoutubeUrl)) {
      errors.video_file = [
        "Please provide a valid YouTube URL (e.g. https://www.youtube.com/watch?v=VIDEO_ID or https://www.youtube.com/live/VIDEO_ID).",
      ];
    }
  }

  if (Object.keys(errors).length > 0) {
    return {
      success: false,
      message: "Please fix the errors below.",
      errors,
    };
  }

  // Parse tags
  const parsedTags = tags
    ? tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

  // Check if this is a draft/test upload
  const publishStatus = formData.get("status") as string | null;
  const isDraft = publishStatus === "draft";

  // Build metadata JSON
  const metadata = {
    description: description!.trim(),
    tags: parsedTags,
    isDraft,
    scheduleMode: isDraft ? "now" : (scheduleMode ?? "now"),
    scheduledAt: scheduleMode === "schedule" && !isDraft ? scheduledAt : null,
    youtubePrivacy: isDraft ? "unlisted" : "public",
    videoFileName,
    videoFileSize: videoFileSize ? parseInt(videoFileSize, 10) : 0,
    videoContentType,
    seasonNumber: seasonNumber ? parseInt(seasonNumber, 10) : undefined,
    episodeNumber: episodeNumber ? parseInt(episodeNumber, 10) : undefined,
    explicit,
    ...(existingYoutubeUrl ? { existingYoutubeUrl } : {}),
  };

  // Verify user has access to this show
  if (session.user.role !== "admin") {
    const wpShowId = parseInt(showId!, 10);
    const access = await db.userShowAccess.findUnique({
      where: {
        userId_wpShowId: {
          userId: session.user.id,
          wpShowId,
        },
      },
    });
    if (!access) {
      return {
        success: false,
        message: "You do not have access to this show.",
      };
    }
  }

  // Create the distribution job and platform records in a transaction
  // Job starts as "uploading" — will move to "pending" after video upload completes
  const job = await db.$transaction(async (tx) => {
    const newJob = await tx.distributionJob.create({
      data: {
        userId: session.user.id,
        wpShowId: parseInt(showId!, 10),
        title: title!.trim(),
        metadata,
        status: "uploading",
      },
    });

    await tx.distributionJobPlatform.createMany({
      data: selectedPlatforms.map((platform) => ({
        jobId: newJob.id,
        platform,
        status: "queued",
      })),
    });

    await tx.activityLog.create({
      data: {
        userId: session.user.id,
        action: "distribute",
        contentType: "episode",
        wpShowId: parseInt(showId!, 10),
        details: `Distribution job created: "${title!.trim()}" to ${selectedPlatforms.join(", ")}`,
      },
    });

    return newJob;
  });

  return {
    success: true,
    message: "Job created. Uploading video...",
    jobId: job.id,
  };
}

/**
 * Update a distribution job's metadata and platforms before triggering processing.
 * Used by the AI path after the producer reviews suggestions and selects final platforms.
 */
export async function updateDistribution(
  jobId: string,
  data: {
    title?: string;
    description: string;
    chapters?: string;
    tags?: string[];
    platforms: string[];
    isDraft?: boolean;
    scheduleMode?: string;
    scheduledAt?: string | null;
    timezone?: string | null;
    seasonNumber?: number;
    episodeNumber?: number;
    explicit?: boolean;
  }
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const job = await db.distributionJob.findUnique({
    where: { id: jobId },
    select: { id: true, userId: true, metadata: true },
  });

  if (!job) {
    return { success: false, message: "Job not found." };
  }

  if (job.userId !== session.user.id && session.user.role !== "admin") {
    return { success: false, message: "You do not own this job." };
  }

  const existingMetadata = job.metadata as Record<string, unknown>;

  await db.$transaction(async (tx) => {
    // Update job metadata with final description, chapters, tags, and optional fields
    await tx.distributionJob.update({
      where: { id: jobId },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        metadata: {
          ...existingMetadata,
          description: data.description,
          ...(data.chapters ? { chapters: data.chapters } : {}),
          ...(data.tags ? { tags: data.tags } : {}),
          isDraft: data.isDraft ?? false,
          scheduleMode: data.scheduleMode ?? "now",
          scheduledAt:
            data.scheduledAt && data.scheduleMode === "schedule"
              ? toISOWithTimezone(data.scheduledAt, data.timezone)
              : (data.scheduledAt ?? null),
          ...(data.seasonNumber !== undefined
            ? { seasonNumber: data.seasonNumber }
            : {}),
          ...(data.episodeNumber !== undefined
            ? { episodeNumber: data.episodeNumber }
            : {}),
          ...(data.explicit !== undefined ? { explicit: data.explicit } : {}),
        },
      },
    });

    // Replace platform records with the user's final selection
    await tx.distributionJobPlatform.deleteMany({
      where: { jobId },
    });

    const validPlatforms = VALID_PLATFORMS.filter((p) =>
      data.platforms.includes(p)
    );
    if (validPlatforms.length > 0) {
      await tx.distributionJobPlatform.createMany({
        data: validPlatforms.map((platform) => ({
          jobId,
          platform,
          status: "queued" as const,
        })),
      });
    }
  });

  return { success: true, jobId };
}

/**
 * Fetch the suggested next episode number and season for a show, plus the
 * show's seasonScheme so the form can render correctly:
 *   - "none"   — caller should hide season + episode inputs
 *   - "season" — caller shows "Season" + "Episode" labels
 *   - "case"   — caller shows "Case" + "Part" labels
 */
export async function getNextEpisodeNumber(
  wpShowId: number
): Promise<{
  episodeNumber: number | null;
  seasonNumber: number | null;
  seasonScheme: "none" | "season" | "case";
}> {
  const session = await auth();
  if (!session?.user) {
    return { episodeNumber: null, seasonNumber: null, seasonScheme: "none" };
  }

  const meta = await db.showMetadata.findUnique({ where: { wpShowId } });
  const seasonScheme =
    (meta?.seasonScheme === "season" || meta?.seasonScheme === "case")
      ? meta.seasonScheme
      : "none";

  // For shows with no season scheme, never populate either field.
  if (seasonScheme === "none") {
    return { episodeNumber: null, seasonNumber: null, seasonScheme };
  }

  const currentSeason = meta?.currentSeason ?? null;
  const { episodeNumber, seasonNumber } = await getLatestEpisodeNumbers(wpShowId);

  // If the latest WP episode is in the same season we're currently on,
  // suggest its number + 1. Otherwise (current season is fresh, no episodes
  // in it yet), suggest E=1.
  const inCurrentSeason = currentSeason != null && seasonNumber === currentSeason;
  const nextEp = inCurrentSeason
    ? (episodeNumber != null ? episodeNumber + 1 : 1)
    : 1;

  return {
    episodeNumber: nextEp,
    seasonNumber: currentSeason,
    seasonScheme,
  };
}
