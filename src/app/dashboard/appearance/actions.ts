"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createPost, uploadMedia } from "@/lib/wordpress/client";
import { WpApiError } from "@/lib/wordpress/types";
import { ContentType } from "@/lib/constants";
import { verifyShowAccess, verifyContentTypeAccess } from "@/lib/auth-guard";

interface FormState {
  success?: boolean;
  message?: string;
  errors?: Record<string, string[]>;
}

export async function submitAppearance(
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) {
    return { success: false, message: "Not authenticated." };
  }

  // Verify content type access
  const hasContentAccess = await verifyContentTypeAccess(
    session.user.id,
    session.user.role,
    ContentType.APPEARANCE
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
  const datetimeStart = formData.get("datetime_start") as string;
  const datetimeEnd = formData.get("datetime_end") as string;
  const venue = formData.get("venue") as string;
  const location = formData.get("location") as string;
  const address = formData.get("address") as string;
  const ticketUrl = formData.get("ticket_url") as string;
  const eventUrl = formData.get("event_url") as string;
  const status = formData.get("appearance_status") as string;
  const publishStatus = formData.get("status") as "publish" | "future" | "draft";
  const scheduledDate = formData.get("scheduled_date") as string | null;

  // Validation
  const errors: Record<string, string[]> = {};

  if (!showId) errors.show_id = ["Please select a show."];
  if (!datetimeStart) errors.datetime_start = ["Start date/time is required."];
  if (!datetimeEnd) errors.datetime_end = ["End date/time is required."];
  if (!venue) errors.venue = ["Venue is required."];
  if (!location) errors.location = ["Location is required."];
  if (!address) errors.address = ["Address is required."];
  if (!status) errors.appearance_status = ["Status is required."];

  if (datetimeStart && datetimeEnd && datetimeEnd < datetimeStart) {
    errors.datetime_end = ["End time must be after start time."];
  }

  if (ticketUrl && !isValidUrl(ticketUrl)) {
    errors.ticket_url = ["Please enter a valid URL."];
  }
  if (eventUrl && !isValidUrl(eventUrl)) {
    errors.event_url = ["Please enter a valid URL."];
  }

  if (Object.keys(errors).length > 0) {
    return { success: false, message: "Please fix the errors below.", errors };
  }

  try {
    // Upload gallery images
    const galleryFiles = formData.getAll("gallery") as File[];
    const galleryIds: number[] = [];

    for (const file of galleryFiles) {
      if (file.size > 0) {
        const uploaded = await uploadMedia(file);
        galleryIds.push(uploaded.id);
      }
    }

    // Build the title from venue + location
    const title = `${venue} - ${location}`;

    // Create post in WordPress
    const wpPost = await createPost(ContentType.APPEARANCE, {
      title,
      status: publishStatus,
      ...(publishStatus === "future" && scheduledDate
        ? { date: scheduledDate }
        : {}),
      meta: {
        _swm_portal_user_id: session.user.id,
        _swm_show_id: Number(showId),
        _swm_datetime_start: datetimeStart,
        _swm_datetime_end: datetimeEnd,
        _swm_venue: venue,
        _swm_location: location,
        _swm_address: address,
        _swm_ticket_url: ticketUrl || "",
        _swm_event_url: eventUrl || "",
        _swm_appearance_status: status,
        _swm_gallery: galleryIds,
      },
    });

    // Log activity
    await db.activityLog.create({
      data: {
        userId: session.user.id,
        action: "create",
        contentType: ContentType.APPEARANCE,
        wpPostId: wpPost.id,
        wpShowId: Number(showId),
      },
    });

    return {
      success: true,
      message: publishStatus === "draft"
        ? "Appearance saved as draft."
        : publishStatus === "future"
          ? "Appearance scheduled successfully!"
          : "Appearance published successfully!",
    };
  } catch (error) {
    console.error("Failed to submit appearance:", error);
    if (error instanceof WpApiError) {
      return { success: false, message: `WordPress error: ${error.message}` };
    }
    return {
      success: false,
      message: "Failed to submit appearance. Please try again.",
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
