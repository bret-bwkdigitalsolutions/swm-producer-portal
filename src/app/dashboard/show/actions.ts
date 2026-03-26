"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createPost } from "@/lib/wordpress/client";
import { ContentType } from "@/lib/constants";
import { revalidateTag } from "next/cache";

interface FormState {
  success?: boolean;
  message?: string;
  errors?: Record<string, string[]>;
}

export async function submitShow(
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return { success: false, message: "Admin access required." };
  }

  // Extract fields
  const title = (formData.get("title") as string)?.trim();
  const description = (formData.get("description") as string)?.trim();
  const hostNames = (formData.get("host_names") as string)?.trim();
  const youtubeUrl = (formData.get("youtube_url") as string)?.trim();
  const spotifyUrl = (formData.get("spotify_url") as string)?.trim();
  const appleUrl = (formData.get("apple_url") as string)?.trim();
  const websiteUrl = (formData.get("website_url") as string)?.trim();
  const accentColor = (formData.get("accent_color") as string)?.trim();
  const publishStatus = formData.get("status") as "publish" | "future";
  const scheduledDate = formData.get("scheduled_date") as string | null;

  // Validation
  const errors: Record<string, string[]> = {};

  if (!title) errors.title = ["Show title is required."];

  if (youtubeUrl && !isValidUrl(youtubeUrl)) {
    errors.youtube_url = ["Please enter a valid YouTube URL."];
  }
  if (spotifyUrl && !isValidUrl(spotifyUrl)) {
    errors.spotify_url = ["Please enter a valid Spotify URL."];
  }
  if (appleUrl && !isValidUrl(appleUrl)) {
    errors.apple_url = ["Please enter a valid Apple Podcasts URL."];
  }
  if (websiteUrl && !isValidUrl(websiteUrl)) {
    errors.website_url = ["Please enter a valid website URL."];
  }
  if (accentColor && !/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(accentColor)) {
    errors.accent_color = ["Please enter a valid hex color (e.g. #FF5500)."];
  }

  if (Object.keys(errors).length > 0) {
    return { success: false, message: "Please fix the errors below.", errors };
  }

  try {
    // Create show in WordPress
    await createPost(ContentType.SHOW, {
      title,
      content: description || "",
      status: publishStatus,
      ...(publishStatus === "future" && scheduledDate
        ? { date: scheduledDate }
        : {}),
      meta: {
        _swm_portal_user_id: session.user.id,
        _swm_host_names: hostNames || "",
        _swm_youtube_url: youtubeUrl || "",
        _swm_spotify_url: spotifyUrl || "",
        _swm_apple_url: appleUrl || "",
        _swm_website_url: websiteUrl || "",
        _swm_accent_color: accentColor || "",
      },
    });

    // Invalidate the show cache so new show appears in dropdowns
    revalidateTag("wp-shows", "max");

    // Log activity
    await db.activityLog.create({
      data: {
        userId: session.user.id,
        action: "create",
        contentType: ContentType.SHOW,
      },
    });

    return {
      success: true,
      message:
        publishStatus === "future"
          ? "Show scheduled successfully!"
          : "Show created successfully!",
    };
  } catch (error) {
    console.error("Failed to create show:", error);
    return {
      success: false,
      message: "Failed to create show. Please try again.",
    };
  }
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}
