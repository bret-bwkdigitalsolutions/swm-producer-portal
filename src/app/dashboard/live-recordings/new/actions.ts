"use server";

import { requireAdmin } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { extractYoutubeVideoId } from "@/lib/youtube-url";
import { isValidVimeoUrl } from "@/lib/vimeo-url";
import { getVideoLiveDetails } from "@/lib/youtube-api";
import { getYouTubeAccessToken } from "@/lib/analytics/credentials";
import { createPost } from "@/lib/wordpress/client";
import { WpApiError } from "@/lib/wordpress/types";
import { ContentType } from "@/lib/constants";
import { toISOWithTimezone } from "@/lib/timezone";
import { revalidatePath } from "next/cache";

interface ActionResult {
  success?: boolean;
  message?: string;
  liveRecordingId?: string;
  wpPostId?: number;
  errors?: Record<string, string[]>;
}

export async function createLiveRecording(
  _prevState: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const session = await requireAdmin();

  const wpShowIdRaw = formData.get("wpShowId") as string;
  const youtubeLiveUrl = (formData.get("youtubeLiveUrl") as string)?.trim() ?? "";
  const title = (formData.get("title") as string)?.trim() ?? "";
  const description = (formData.get("description") as string)?.trim() ?? "";
  const scheduledStartLocal = formData.get("scheduledStartAt") as string;
  const timezone = formData.get("timezone") as string | null;
  const isPremiumOnly = formData.get("premium_only") === "true";
  const vimeoSourceUrl = (formData.get("vimeoSourceUrl") as string)?.trim() ?? "";

  const errors: Record<string, string[]> = {};
  if (!wpShowIdRaw) errors.wpShowId = ["Pick a show."];
  if (!youtubeLiveUrl) errors.youtubeLiveUrl = ["YouTube URL is required."];
  if (!title) errors.title = ["Title is required."];
  if (!scheduledStartLocal)
    errors.scheduledStartAt = ["Scheduled start is required."];

  const wpShowId = parseInt(wpShowIdRaw, 10);
  if (wpShowIdRaw && (isNaN(wpShowId) || wpShowId < 1)) {
    errors.wpShowId = ["Invalid show."];
  }

  const videoId = youtubeLiveUrl ? extractYoutubeVideoId(youtubeLiveUrl) : null;
  if (youtubeLiveUrl && !videoId) {
    errors.youtubeLiveUrl = [
      "Could not extract a YouTube video ID from that URL.",
    ];
  }

  if (vimeoSourceUrl && !isValidVimeoUrl(vimeoSourceUrl)) {
    errors.vimeoSourceUrl = ["Please provide a valid Vimeo URL (e.g. https://vimeo.com/123456789)."];
  }

  // Convert the datetime-local string to an absolute ISO timestamp using the
  // browser-provided timezone. Falls back to UTC if no timezone supplied.
  let scheduledStartAt: Date | null = null;
  if (scheduledStartLocal) {
    try {
      const iso = toISOWithTimezone(scheduledStartLocal, timezone);
      scheduledStartAt = new Date(iso);
      if (isNaN(scheduledStartAt.getTime())) {
        errors.scheduledStartAt = ["Invalid date/time."];
        scheduledStartAt = null;
      }
    } catch {
      errors.scheduledStartAt = ["Invalid date/time."];
    }
  }

  if (Object.keys(errors).length > 0) {
    return {
      success: false,
      message: "Please fix the errors below.",
      errors,
    };
  }

  // At this point all required fields are present + valid shape
  // (validation above narrows the types, but TS doesn't know that)
  if (!videoId || !scheduledStartAt) {
    return { success: false, message: "Validation error." };
  }

  // Reject duplicate YouTube video IDs early (the DB unique constraint
  // would catch it anyway, but a friendly message beats a 500 page).
  const existing = await db.liveRecording.findUnique({
    where: { youtubeVideoId: videoId },
  });
  if (existing) {
    return {
      success: false,
      message: `This YouTube video is already scheduled (recording ${existing.id}, state: ${existing.state}).`,
    };
  }

  // Verify the YouTube video actually exists. The show's existing YouTube
  // OAuth token covers this — any read is fine. If the show has no YouTube
  // credential at all, we skip verification (defer until polling discovers
  // it, when the failure is recoverable via admin retry).
  const accessToken = await getYouTubeAccessToken(wpShowId);
  if (accessToken) {
    try {
      const details = await getVideoLiveDetails(accessToken, videoId);
      if (!details) {
        return {
          success: false,
          message:
            "YouTube can't find that video. Check the URL or confirm the live event is created in YouTube Studio.",
          errors: { youtubeLiveUrl: ["Video not found on YouTube."] },
        };
      }
    } catch (error) {
      // Don't block creation on transient YouTube errors — log and proceed.
      // The polling cron will reattempt and surface persistent failures.
      console.warn(
        `[createLiveRecording] YouTube verification failed for ${videoId}:`,
        error
      );
    }
  }

  // Create the portal-side row first so we have a stable ID for the WP
  // post's _swm_live_recording_portal_id meta even if the WP create fails.
  const liveRecording = await db.liveRecording.create({
    data: {
      wpShowId,
      youtubeVideoId: videoId,
      youtubeLiveUrl,
      title,
      description: description || null,
      scheduledStartAt,
      state: "scheduled",
      isPremiumOnly,
      vimeoSourceUrl: vimeoSourceUrl || null,
      createdByUserId: session.user.id,
    },
  });

  // Publish the WP swm_episode post in the scheduled state. Meta keys per
  // docs/live-recording-wordpress-coordination.md — the theme reads these.
  try {
    const wpPost = await createPost(ContentType.EPISODE, {
      title,
      content: description || "",
      status: "publish",
      meta: {
        _swm_portal_user_id: session.user.id,
        _swm_portal_submission: true,
        parent_show_id: wpShowId,
        _swm_episode_source: "live",
        _swm_episode_live_state: "scheduled",
        _swm_episode_youtube_live_url: youtubeLiveUrl,
        _swm_episode_youtube_video_id: videoId,
        _swm_episode_scheduled_start: scheduledStartAt.toISOString(),
        _swm_live_recording_portal_id: liveRecording.id,
        is_premium_only: isPremiumOnly,
      },
    });

    await db.liveRecording.update({
      where: { id: liveRecording.id },
      data: { wpPostId: wpPost.id },
    });

    await db.activityLog.create({
      data: {
        userId: session.user.id,
        action: "create",
        contentType: "live_recording",
        wpPostId: wpPost.id,
        wpShowId,
      },
    });

    revalidatePath("/dashboard/live-recordings");

    return {
      success: true,
      message: "Live recording scheduled. WP post is published.",
      liveRecordingId: liveRecording.id,
      wpPostId: wpPost.id,
    };
  } catch (error) {
    console.error("[createLiveRecording] WP post creation failed:", error);
    const reason =
      error instanceof WpApiError
        ? `WordPress error: ${error.message}`
        : error instanceof Error
          ? error.message
          : "Unknown error";
    // Leave the LiveRecording row in place — admin can retry WP creation
    // from the detail view. Surface the recording ID so they can navigate
    // there directly.
    return {
      success: false,
      message: `Recording created (id ${liveRecording.id}) but WordPress publish failed: ${reason}. You can retry from the detail page.`,
      liveRecordingId: liveRecording.id,
    };
  }
}
