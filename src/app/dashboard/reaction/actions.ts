"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createPost, uploadMedia } from "@/lib/wordpress/client";
import { compressForWordPress } from "@/lib/image";
import { WpApiError } from "@/lib/wordpress/types";
import { ContentType } from "@/lib/constants";
import { verifyShowAccess, verifyContentTypeAccess } from "@/lib/auth-guard";
import { toISOWithTimezone } from "@/lib/timezone";

interface FormState {
  success?: boolean;
  message?: string;
  errors?: Record<string, string[]>;
}

export async function submitReaction(
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
    ContentType.REACTION
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
  const reactionType = formData.get("reaction_type") as string;
  const title = formData.get("title") as string;
  const youtubeVideoId = formData.get("youtube_video_id") as string;
  const teamsCovered = formData.get("teams_covered") as string | null;
  const gameWindow = formData.get("game_window") as string | null;
  const thumbnailFile = formData.get("thumbnail_file") as File | null;
  const thumbnailUrl = formData.get("thumbnail_url") as string | null;
  const status = formData.get("status") as "publish" | "future" | "draft";
  const scheduledDateRaw = formData.get("scheduled_date") as string | null;
  const timezone = formData.get("timezone") as string | null;
  const scheduledDate = scheduledDateRaw
    ? toISOWithTimezone(scheduledDateRaw, timezone)
    : null;

  // Validate required fields
  const errors: Record<string, string[]> = {};

  if (!showId) errors.show = ["Please select a show."];
  if (!reactionType?.trim()) errors.reaction_type = ["Reaction type is required."];
  if (!title?.trim()) errors.title = ["Title is required."];
  if (!youtubeVideoId?.trim()) errors.youtube_video_id = ["YouTube Video ID is required."];
  if (status === "future" && !scheduledDate) {
    errors.scheduled_date = ["Please select a scheduled date."];
  }

  if (Object.keys(errors).length > 0) {
    return { success: false, message: "Please fix the errors below.", errors };
  }

  try {
    // Upload thumbnail if a file was provided
    let featuredMedia: number | undefined;
    if (thumbnailFile && thumbnailFile.size > 0) {
      const compressed = await compressForWordPress(thumbnailFile);
      const media = await uploadMedia(compressed);
      featuredMedia = media.id;
    }

    const payload = {
      title: title.trim(),
      status: status || "publish",
      ...(status === "future" && scheduledDate ? { date: scheduledDate } : {}),
      ...(featuredMedia !== undefined ? { featured_media: featuredMedia } : {}),
      meta: {
        _swm_portal_user_id: session.user.id,
        _swm_portal_submission: true,
        _swm_reaction_type: reactionType.trim(),
        parent_show_id: parseInt(showId, 10),
        youtube_video_id: youtubeVideoId.trim(),
        ...(teamsCovered?.trim() ? { teams_covered: teamsCovered.trim() } : {}),
        ...(gameWindow?.trim() ? { game_window: gameWindow.trim() } : {}),
        ...(thumbnailUrl?.trim() && !featuredMedia ? { thumbnail_url: thumbnailUrl.trim() } : {}),
      },
    };

    const post = await createPost(ContentType.REACTION, payload);

    // Log activity
    await db.activityLog.create({
      data: {
        userId: session.user.id,
        action: "create",
        contentType: ContentType.REACTION,
        wpPostId: post.id,
        wpShowId: parseInt(showId, 10),
        details: `Created reaction: "${title.trim()}"`,
      },
    });

    return {
      success: true,
      message: `Reaction "${title.trim()}" ${status === "draft" ? "saved as draft" : status === "future" ? "scheduled" : "published"} successfully.`,
    };
  } catch (error) {
    if (error instanceof WpApiError) {
      return {
        success: false,
        message: `WordPress error: ${error.message}`,
      };
    }
    console.error("Reaction submission error:", error);
    return {
      success: false,
      message: "An unexpected error occurred. Please try again.",
    };
  }
}
