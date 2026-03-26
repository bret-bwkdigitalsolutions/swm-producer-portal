"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";

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
  "podbean",
  "patreon",
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
    return { success: false, message: "You do not have distribution access." };
  }

  // Extract form fields
  const showId = formData.get("show_id") as string | null;
  const title = formData.get("title") as string | null;
  const description = formData.get("description") as string | null;
  const tags = formData.get("tags") as string | null;
  const scheduleMode = formData.get("schedule_mode") as string | null;
  const scheduledAt = formData.get("scheduled_at") as string | null;

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

  // Check for video file — in this UI layer we validate presence; actual upload
  // to GCS will be handled by the pipeline implementation later.
  const videoFile = formData.get("video_file") as File | null;
  if (!videoFile || videoFile.size === 0) {
    errors.video_file = ["Please upload a video file."];
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

  // Build metadata JSON
  const metadata = {
    description: description!.trim(),
    tags: parsedTags,
    scheduleMode: scheduleMode ?? "now",
    scheduledAt: scheduleMode === "schedule" ? scheduledAt : null,
    // Thumbnail and video file references will be populated by the upload pipeline
    thumbnailUploaded: (formData.get("thumbnail") as File | null)?.size
      ? true
      : false,
    videoFileName: videoFile!.name,
    videoFileSize: videoFile!.size,
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
  const job = await db.$transaction(async (tx) => {
    const newJob = await tx.distributionJob.create({
      data: {
        userId: session.user.id,
        wpShowId: parseInt(showId!, 10),
        title: title!.trim(),
        metadata,
        status: "pending",
      },
    });

    await tx.distributionJobPlatform.createMany({
      data: selectedPlatforms.map((platform) => ({
        jobId: newJob.id,
        platform,
        status: "queued",
      })),
    });

    // Log activity
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

  redirect(`/dashboard/distribute/${job.id}`);
}
