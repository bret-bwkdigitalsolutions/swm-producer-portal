"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createPost, uploadMedia } from "@/lib/wordpress/client";
import { WpApiError } from "@/lib/wordpress/types";
import { ContentType } from "@/lib/constants";

interface FormState {
  success?: boolean;
  message?: string;
  errors?: Record<string, string[]>;
}

export async function submitReview(
  prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, message: "You must be logged in." };
  }

  // Extract fields
  const showId = formData.get("show_id") as string;
  const reviewerName = formData.get("reviewer_name") as string;
  const reviewerCustom = formData.get("reviewer_custom") as string;
  const category = formData.get("category") as string;
  const movieTitle = formData.get("movie_title") as string;
  const rating = formData.get("rating") as string;
  const reviewBody = formData.get("review_body") as string;
  const status = formData.get("status") as "publish" | "future";
  const scheduledDate = formData.get("scheduled_date") as string | null;

  // Poster image — can be file or URL
  const posterFile = formData.get("poster_image_file") as File | null;
  const posterUrl = formData.get("poster_image_url") as string | null;

  // Validate required fields
  const errors: Record<string, string[]> = {};

  if (!showId) errors.show = ["Please select a show."];
  if (!reviewerName) errors.reviewer_name = ["Please select a reviewer."];
  if (reviewerName === "other" && !reviewerCustom?.trim()) {
    errors.reviewer_custom = ["Please enter the reviewer name."];
  }
  if (!category) errors.category = ["Please select a category."];
  if (!movieTitle?.trim()) errors.movie_title = ["Title is required."];
  if (!reviewBody?.trim()) errors.review_body = ["Review body is required."];
  if (status === "future" && !scheduledDate) {
    errors.scheduled_date = ["Please select a scheduled date."];
  }

  if (Object.keys(errors).length > 0) {
    return { success: false, message: "Please fix the errors below.", errors };
  }

  try {
    // Upload poster image if a file was provided
    let featuredMediaId: number | undefined;
    let posterImageUrl: string | undefined;

    if (posterFile && posterFile.size > 0) {
      const media = await uploadMedia(posterFile);
      featuredMediaId = media.id;
      posterImageUrl = media.source_url;
    } else if (posterUrl?.trim()) {
      posterImageUrl = posterUrl.trim();
    }

    const resolvedReviewer =
      reviewerName === "other" ? reviewerCustom.trim() : reviewerName;

    const ratingNum = rating ? parseInt(rating, 10) : undefined;

    const payload = {
      title: movieTitle.trim(),
      status: status || "publish",
      ...(status === "future" && scheduledDate ? { date: scheduledDate } : {}),
      content: reviewBody,
      ...(featuredMediaId ? { featured_media: featuredMediaId } : {}),
      meta: {
        _swm_portal_user_id: session.user.id,
        _swm_reviewer_name: resolvedReviewer,
        _swm_review_category: category,
        _swm_show_id: parseInt(showId, 10),
        ...(ratingNum ? { _swm_rating: ratingNum } : {}),
        ...(posterImageUrl && !featuredMediaId
          ? { _swm_poster_url: posterImageUrl }
          : {}),
      },
    };

    const post = await createPost(ContentType.REVIEW, payload);

    // Log activity
    await db.activityLog.create({
      data: {
        userId: session.user.id,
        action: "create",
        contentType: ContentType.REVIEW,
        wpPostId: post.id,
        wpShowId: parseInt(showId, 10),
        details: `Created review: "${movieTitle.trim()}"`,
      },
    });

    return {
      success: true,
      message: `Review "${movieTitle.trim()}" ${status === "future" ? "scheduled" : "published"} successfully.`,
    };
  } catch (error) {
    if (error instanceof WpApiError) {
      return {
        success: false,
        message: `WordPress error: ${error.message}`,
      };
    }
    console.error("Review submission error:", error);
    return {
      success: false,
      message: "An unexpected error occurred. Please try again.",
    };
  }
}
