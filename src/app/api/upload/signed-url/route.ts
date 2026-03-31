import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { generateSignedUploadUrl } from "@/lib/gcs";

const ALLOWED_VIDEO_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
  "video/x-matroska",
  "video/webm",
  "video/mpeg",
  "video/x-ms-wmv",
];

const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

export async function POST(request: NextRequest) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Only users with distribution access (or admins) can upload
  if (!session.user.hasDistributionAccess && session.user.role !== "admin") {
    return NextResponse.json(
      { error: "You do not have distribution access." },
      { status: 403 }
    );
  }

  let body: { filename?: string; contentType?: string; jobId?: string; purpose?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 }
    );
  }

  const { filename, contentType, jobId, purpose } = body;

  if (!filename || !contentType || !jobId) {
    return NextResponse.json(
      { error: "Missing required fields: filename, contentType, jobId." },
      { status: 400 }
    );
  }

  // Validate content type based on purpose
  const isThumbnail = purpose === "thumbnail";
  const allowedTypes = isThumbnail ? ALLOWED_IMAGE_TYPES : ALLOWED_VIDEO_TYPES;

  if (!allowedTypes.includes(contentType)) {
    return NextResponse.json(
      {
        error: `Unsupported file type: ${contentType}. Allowed types: ${allowedTypes.join(", ")}`,
      },
      { status: 400 }
    );
  }

  // Verify the distribution job exists and belongs to this user
  const job = await db.distributionJob.findUnique({
    where: { id: jobId },
    select: { id: true, userId: true, status: true },
  });

  if (!job) {
    return NextResponse.json(
      { error: "Distribution job not found." },
      { status: 404 }
    );
  }

  if (job.userId !== session.user.id && session.user.role !== "admin") {
    return NextResponse.json(
      { error: "You do not own this distribution job." },
      { status: 403 }
    );
  }

  try {
    const { uploadUrl, gcsPath } = await generateSignedUploadUrl(
      filename,
      contentType
    );

    if (isThumbnail) {
      // Store thumbnail path in job metadata
      const job2 = await db.distributionJob.findUnique({
        where: { id: jobId },
        select: { metadata: true },
      });
      const existingMetadata = (job2?.metadata as Record<string, unknown>) ?? {};
      await db.distributionJob.update({
        where: { id: jobId },
        data: {
          metadata: { ...existingMetadata, thumbnailGcsPath: gcsPath },
        },
      });
    } else {
      // Update the distribution job with the video GCS path
      await db.distributionJob.update({
        where: { id: jobId },
        data: { gcsPath },
      });
    }

    return NextResponse.json({ uploadUrl, gcsPath });
  } catch (error) {
    console.error("[Upload API] Failed to generate signed URL:", error);

    const message =
      error instanceof Error ? error.message : "Failed to generate upload URL.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
