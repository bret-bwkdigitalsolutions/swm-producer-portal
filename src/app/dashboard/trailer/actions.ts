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

export async function submitTrailer(
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
    ContentType.TRAILER
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
  const movieTitle = formData.get("movie_title") as string;
  const youtubeUrl = formData.get("youtube_url") as string;
  const releaseDate = formData.get("release_date") as string | null;
  const status = formData.get("status") as "publish" | "future" | "draft";
  const scheduledDate = formData.get("scheduled_date") as string | null;

  // Validate required fields
  const errors: Record<string, string[]> = {};

  if (!showId) errors.show = ["Please select a show."];
  if (!movieTitle?.trim()) errors.movie_title = ["Title is required."];
  if (!youtubeUrl?.trim()) {
    errors.youtube_url = ["YouTube URL is required."];
  } else {
    // Validate YouTube URL format
    const ytRegex =
      /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|embed\/|shorts\/)|youtu\.be\/)/;
    if (!ytRegex.test(youtubeUrl.trim())) {
      errors.youtube_url = ["Please enter a valid YouTube URL."];
    }
  }
  if (status === "future" && !scheduledDate) {
    errors.scheduled_date = ["Please select a scheduled date."];
  }

  if (Object.keys(errors).length > 0) {
    return { success: false, message: "Please fix the errors below.", errors };
  }

  try {
    const payload = {
      title: movieTitle.trim(),
      status: status || "publish",
      ...(status === "future" && scheduledDate ? { date: scheduledDate } : {}),
      meta: {
        _swm_portal_user_id: session.user.id,
        _swm_youtube_url: youtubeUrl.trim(),
        _swm_show_id: parseInt(showId, 10),
        ...(releaseDate ? { _swm_release_date: releaseDate } : {}),
      },
    };

    const post = await createPost(ContentType.TRAILER, payload);

    // Log activity
    await db.activityLog.create({
      data: {
        userId: session.user.id,
        action: "create",
        contentType: ContentType.TRAILER,
        wpPostId: post.id,
        wpShowId: parseInt(showId, 10),
        details: `Created trailer: "${movieTitle.trim()}"`,
      },
    });

    return {
      success: true,
      message: `Trailer "${movieTitle.trim()}" ${status === "draft" ? "saved as draft" : status === "future" ? "scheduled" : "published"} successfully.`,
    };
  } catch (error) {
    if (error instanceof WpApiError) {
      return {
        success: false,
        message: `WordPress error: ${error.message}`,
      };
    }
    console.error("Trailer submission error:", error);
    return {
      success: false,
      message: "An unexpected error occurred. Please try again.",
    };
  }
}
