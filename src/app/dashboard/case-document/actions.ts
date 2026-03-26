"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createPost, uploadMedia } from "@/lib/wordpress/client";
import { ContentType } from "@/lib/constants";
import { verifyContentTypeAccess } from "@/lib/auth-guard";

interface FormState {
  success?: boolean;
  message?: string;
  errors?: Record<string, string[]>;
}

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

export async function submitCaseDocument(
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
    ContentType.CASE_DOCUMENT
  );
  if (!hasContentAccess) {
    return { success: false, message: "You do not have access to this content type." };
  }

  // Extract fields
  const title = (formData.get("title") as string)?.trim();
  const description = formData.get("description") as string;
  const caseSeriesId = formData.get("case_series") as string;
  const docTypeId = formData.get("doc_type") as string;
  const allowDownload = formData.get("allow_download") === "true";
  const publishStatus = formData.get("status") as "publish" | "future";
  const scheduledDate = formData.get("scheduled_date") as string | null;

  // File upload
  const documentFile = formData.get("document_file") as File | null;

  // Thumbnail (dual mode from ImageInput)
  const thumbnailFile = formData.get("thumbnail_file") as File | null;
  const thumbnailUrl = formData.get("thumbnail_url") as string | null;

  // Validation
  const errors: Record<string, string[]> = {};

  if (!title) errors.title = ["Title is required."];
  if (!caseSeriesId) errors.case_series = ["Please select a case/series."];
  if (!docTypeId) errors.doc_type = ["Please select a document type."];

  if (documentFile && documentFile.size > 0) {
    if (!ALLOWED_MIME_TYPES.has(documentFile.type)) {
      errors.document_file = [
        "Unsupported file type. Please upload PDF, DOC, images, audio, or video.",
      ];
    }
    if (documentFile.size > 500 * 1024 * 1024) {
      errors.document_file = ["File must be under 500MB."];
    }
  }

  if (Object.keys(errors).length > 0) {
    return { success: false, message: "Please fix the errors below.", errors };
  }

  try {
    // Upload document file if provided
    let documentMediaId: number | undefined;
    if (documentFile && documentFile.size > 0) {
      const uploaded = await uploadMedia(documentFile);
      documentMediaId = uploaded.id;
    }

    // Upload thumbnail if file provided
    let thumbnailMediaId: number | undefined;
    if (thumbnailFile && thumbnailFile.size > 0) {
      const uploaded = await uploadMedia(thumbnailFile);
      thumbnailMediaId = uploaded.id;
    }

    // Create post in WordPress
    await createPost(ContentType.CASE_DOCUMENT, {
      title,
      content: description || "",
      status: publishStatus,
      ...(publishStatus === "future" && scheduledDate
        ? { date: scheduledDate }
        : {}),
      ...(thumbnailMediaId ? { featured_media: thumbnailMediaId } : {}),
      // Taxonomy assignments
      swm_case_series: caseSeriesId ? [Number(caseSeriesId)] : [],
      swm_doc_type: docTypeId ? [Number(docTypeId)] : [],
      meta: {
        _swm_portal_user_id: session.user.id,
        _swm_document_file: documentMediaId || "",
        _swm_allow_download: allowDownload,
        _swm_thumbnail_url: thumbnailUrl || "",
      },
    });

    // Log activity
    await db.activityLog.create({
      data: {
        userId: session.user.id,
        action: "create",
        contentType: ContentType.CASE_DOCUMENT,
      },
    });

    return {
      success: true,
      message:
        publishStatus === "future"
          ? "Case document scheduled successfully!"
          : "Case document published successfully!",
    };
  } catch (error) {
    console.error("Failed to submit case document:", error);
    return {
      success: false,
      message: "Failed to submit case document. Please try again.",
    };
  }
}
