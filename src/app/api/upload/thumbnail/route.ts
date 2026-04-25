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
  const youtubeVideoId = formData.get("youtubeVideoId") as string | null;

  if (!jobId) {
    return NextResponse.json(
      { error: "Missing jobId." },
      { status: 400 }
    );
  }

  if (!file && !youtubeVideoId) {
    return NextResponse.json(
      { error: "Missing file or youtubeVideoId." },
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
    let buffer: Buffer;
    let contentType: string;
    let filename: string;

    if (file) {
      // Standard file upload path
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
      buffer = Buffer.from(await file.arrayBuffer());
      contentType = file.type;
      filename = file.name;
    } else {
      // YouTube thumbnail fallback — fetch server-side to avoid CORS
      const urls = [
        `https://img.youtube.com/vi/${youtubeVideoId}/maxresdefault.jpg`,
        `https://img.youtube.com/vi/${youtubeVideoId}/hqdefault.jpg`,
      ];

      let fetched = false;
      for (const url of urls) {
        const res = await fetch(url);
        if (res.ok) {
          buffer = Buffer.from(await res.arrayBuffer());
          contentType = "image/jpeg";
          filename = `youtube-${youtubeVideoId}.jpg`;
          fetched = true;
          break;
        }
      }

      if (!fetched) {
        return NextResponse.json(
          { error: "Could not fetch YouTube thumbnail." },
          { status: 400 }
        );
      }
    }

    const gcsPath = await uploadBuffer(filename!, buffer!, contentType!);

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
