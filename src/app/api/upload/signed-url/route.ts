import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { generateSignedUploadUrl } from "@/lib/gcs";
import { mergeJobMetadata } from "@/lib/jobs/job-metadata";

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
    select: { id: true, userId: true, status: true, metadata: true },
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
    const meta = (job.metadata as Record<string, unknown>) ?? {};
    const pinned =
      typeof meta.gcsBucket === "string" && meta.gcsBucket.trim()
        ? meta.gcsBucket.trim()
        : undefined;
    const { uploadUrl, gcsPath, bucketName } = await generateSignedUploadUrl(
      filename,
      contentType,
      { resumable: !isThumbnail, bucket: pinned }
    );

    if (isThumbnail) {
      // Do not set gcsBucket from a thumbnail. That hint is the video's
      // bucket; a thumbnail-only write would send later video reads to the
      // wrong bucket during dual-read.
      await mergeJobMetadata(jobId, { thumbnailGcsPath: gcsPath });
    } else {
      // Update the distribution job with the video GCS path and pin the bucket
      // so later reads do not guess during the dual-bucket period.
      await db.distributionJob.update({
        where: { id: jobId },
        data: { gcsPath },
      });
      await mergeJobMetadata(jobId, { gcsBucket: bucketName });
    }

    return NextResponse.json({ uploadUrl, gcsPath });
  } catch (error) {
    console.error("[Upload API] Failed to generate signed URL:", error);

    const message =
      error instanceof Error ? error.message : "Failed to generate upload URL.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
