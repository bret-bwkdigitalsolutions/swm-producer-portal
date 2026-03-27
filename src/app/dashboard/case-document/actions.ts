"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createPost, uploadMedia } from "@/lib/wordpress/client";
import { WpApiError } from "@/lib/wordpress/types";
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

export async function submitCaseDocumentBulk(
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) {
    return { success: false, message: "Not authenticated." };
  }

  const hasContentAccess = await verifyContentTypeAccess(
    session.user.id,
    session.user.role,
    ContentType.CASE_DOCUMENT
  );
  if (!hasContentAccess) {
    return {
      success: false,
      message: "You do not have access to this content type.",
    };
  }

  const caseSeriesId = formData.get("case_series") as string;
  const fileCount = parseInt(formData.get("file_count") as string, 10);

  if (!fileCount || fileCount < 1) {
    return { success: false, message: "No files selected." };
  }

  let succeeded = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < fileCount; i++) {
    const file = formData.get(`file_${i}`) as File | null;
    const title = (formData.get(`title_${i}`) as string)?.trim();
    const docTypeId = formData.get(`doc_type_${i}`) as string;
    const allowDownload = formData.get(`allow_download_${i}`) === "true";

    if (!file || file.size === 0) {
      errors.push(`File ${i + 1}: No file provided.`);
      failed++;
      continue;
    }

    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      errors.push(`${file.name}: Unsupported file type.`);
      failed++;
      continue;
    }

    if (file.size > 500 * 1024 * 1024) {
      errors.push(`${file.name}: File must be under 500MB.`);
      failed++;
      continue;
    }

    try {
      // Upload file to WordPress media library
      const uploaded = await uploadMedia(file);

      // Use filename-derived title if none provided
      const postTitle = title || file.name.replace(/\.[^.]+$/, "");

      // Create post in WordPress
      const wpPost = await createPost(ContentType.CASE_DOCUMENT, {
        title: postTitle,
        status: "publish",
        ...(caseSeriesId
          ? { swm_case_series: [Number(caseSeriesId)] }
          : {}),
        ...(docTypeId ? { swm_doc_type: [Number(docTypeId)] } : {}),
        meta: {
          _swm_portal_user_id: session.user.id,
          _swm_document_file: uploaded.id,
          _swm_allow_download: allowDownload,
        },
      });

      // Log activity
      await db.activityLog.create({
        data: {
          userId: session.user.id,
          action: "create",
          contentType: ContentType.CASE_DOCUMENT,
          wpPostId: wpPost.id,
        },
      });

      succeeded++;
    } catch (error) {
      console.error(`Failed to upload ${file.name}:`, error);
      if (error instanceof WpApiError) {
        errors.push(`${file.name}: WordPress error — ${error.message}`);
      } else {
        errors.push(`${file.name}: Upload failed.`);
      }
      failed++;
    }
  }

  if (failed === fileCount) {
    return {
      success: false,
      message: `All ${fileCount} uploads failed. ${errors.join(" ")}`,
    };
  }

  if (failed > 0) {
    return {
      success: true,
      message: `${succeeded} of ${fileCount} documents uploaded. ${failed} failed: ${errors.join(" ")}`,
    };
  }

  return {
    success: true,
    message: `${succeeded} document${succeeded !== 1 ? "s" : ""} uploaded successfully!`,
  };
}
