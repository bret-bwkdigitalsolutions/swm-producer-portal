"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createPost } from "@/lib/wordpress/client";
import { WpApiError } from "@/lib/wordpress/types";
import { ContentType } from "@/lib/constants";
import { verifyShowAccess, verifyContentTypeAccess } from "@/lib/auth-guard";

interface FormState {
  success?: boolean;
  message?: string;
  errors?: Record<string, string[]>;
}

export async function submitEpisode(
  prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, message: "You must be logged in." };
  }

  // Verify content type access
  const hasContentAccess = await verifyContentTypeAccess(
    session.user.id,
    session.user.role,
    ContentType.EPISODE
  );
  if (!hasContentAccess) {
    return { success: false, message: "You do not have access to this content type." };
  }

  // Verify show access
  const showIdRaw = formData.get("show_id") as string;
  if (showIdRaw) {
    const hasShowAccess = await verifyShowAccess(session.user.id, parseInt(showIdRaw, 10));
    if (!hasShowAccess) {
      return { success: false, message: "You do not have access to this show." };
    }
  }

  // Extract fields
  const showId = formData.get("show_id") as string;
  const episodeNumber = formData.get("episode_number") as string;
  const seasonNumber = formData.get("season_number") as string | null;
  const title = formData.get("title") as string;
  const description = formData.get("description") as string;
  const durationMinutes = formData.get("duration_minutes") as string | null;
  const vimeoUrl = formData.get("vimeo_url") as string | null;
  const youtubeUrl = formData.get("youtube_url") as string | null;
  const premiumOnly = formData.get("premium_only") as string;
  const contentWarning = formData.get("content_warning") as string | null;
  const status = formData.get("status") as "publish" | "future" | "draft";
  const scheduledDate = formData.get("scheduled_date") as string | null;

  // Validate required fields
  const errors: Record<string, string[]> = {};

  if (!showId) errors.show = ["Please select a show."];
  if (!episodeNumber?.trim()) {
    errors.episode_number = ["Episode number is required."];
  } else if (isNaN(parseInt(episodeNumber, 10)) || parseInt(episodeNumber, 10) < 1) {
    errors.episode_number = ["Episode number must be a positive number."];
  }
  if (seasonNumber?.trim() && (isNaN(parseInt(seasonNumber, 10)) || parseInt(seasonNumber, 10) < 1)) {
    errors.season_number = ["Season number must be a positive number."];
  }
  if (!title?.trim()) errors.title = ["Title is required."];
  if (status === "future" && !scheduledDate) {
    errors.scheduled_date = ["Please select a scheduled date."];
  }

  // Validate URLs if provided
  const urlPattern = /^https?:\/\/.+/;
  if (vimeoUrl?.trim() && !urlPattern.test(vimeoUrl.trim())) {
    errors.vimeo_url = ["Please enter a valid URL."];
  }
  if (youtubeUrl?.trim() && !urlPattern.test(youtubeUrl.trim())) {
    errors.youtube_url = ["Please enter a valid URL."];
  }
  if (Object.keys(errors).length > 0) {
    return { success: false, message: "Please fix the errors below.", errors };
  }

  try {
    const epNum = parseInt(episodeNumber, 10);
    const seaNum = seasonNumber?.trim() ? parseInt(seasonNumber, 10) : undefined;
    const durMin = durationMinutes?.trim()
      ? parseInt(durationMinutes, 10)
      : undefined;

    const payload = {
      title: title.trim(),
      status: status || "publish",
      ...(status === "future" && scheduledDate ? { date: scheduledDate } : {}),
      content: description || "",
      meta: {
        _swm_portal_user_id: session.user.id,
        _swm_show_id: parseInt(showId, 10),
        _swm_episode_number: epNum,
        ...(seaNum !== undefined ? { _swm_season_number: seaNum } : {}),
        ...(durMin !== undefined ? { _swm_duration_minutes: durMin } : {}),
        ...(vimeoUrl?.trim() ? { _swm_vimeo_url: vimeoUrl.trim() } : {}),
        ...(youtubeUrl?.trim() ? { _swm_youtube_url: youtubeUrl.trim() } : {}),
        _swm_premium_only: premiumOnly === "true",
        ...(contentWarning?.trim()
          ? { _swm_content_warning: contentWarning.trim() }
          : {}),
      },
    };

    const post = await createPost(ContentType.EPISODE, payload);

    // Log activity
    await db.activityLog.create({
      data: {
        userId: session.user.id,
        action: "create",
        contentType: ContentType.EPISODE,
        wpPostId: post.id,
        wpShowId: parseInt(showId, 10),
        details: `Created episode: "${title.trim()}" (Ep. ${epNum}${seaNum ? `, S${seaNum}` : ""})`,
      },
    });

    return {
      success: true,
      message: `Episode "${title.trim()}" ${status === "draft" ? "saved as draft" : status === "future" ? "scheduled" : "published"} successfully.`,
    };
  } catch (error) {
    if (error instanceof WpApiError) {
      return {
        success: false,
        message: `WordPress error: ${error.message}`,
      };
    }
    console.error("Episode submission error:", error);
    return {
      success: false,
      message: "An unexpected error occurred. Please try again.",
    };
  }
}
