import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { uploadBuffer } from "@/lib/gcs";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE = 15 * 1024 * 1024; // 15 MB

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!session.user.hasDistributionAccess && session.user.role !== "admin") {
    return NextResponse.json(
      { error: "You do not have distribution access." },
      { status: 403 }
    );
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const jobId = formData.get("jobId") as string | null;

  if (!file || !jobId) {
    return NextResponse.json(
      { error: "Missing file or jobId." },
      { status: 400 }
    );
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: `Unsupported image type: ${file.type}` },
      { status: 400 }
    );
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json(
      { error: "Image exceeds 15 MB limit." },
      { status: 400 }
    );
  }

  // Verify job exists and belongs to user
  const job = await db.distributionJob.findUnique({
    where: { id: jobId },
    select: { id: true, userId: true, metadata: true },
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
    const buffer = Buffer.from(await file.arrayBuffer());
    const gcsPath = await uploadBuffer(file.name, buffer, file.type);

    // Store thumbnail path in job metadata
    const existingMetadata = (job.metadata as Record<string, unknown>) ?? {};
    await db.distributionJob.update({
      where: { id: jobId },
      data: {
        metadata: { ...existingMetadata, thumbnailGcsPath: gcsPath },
      },
    });

    console.log(`[thumbnail] Uploaded to GCS: ${gcsPath}`);

    return NextResponse.json({ gcsPath });
  } catch (error) {
    console.error("[thumbnail] Upload failed:", error);
    return NextResponse.json(
      { error: "Failed to upload thumbnail." },
      { status: 500 }
    );
  }
}
