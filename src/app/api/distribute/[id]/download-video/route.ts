import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { generateSignedDownloadUrl } from "@/lib/gcs";
import { downloadFullVideoToGcs } from "@/lib/jobs/video-downloader";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const job = await db.distributionJob.findUnique({
    where: { id },
    select: {
      id: true,
      gcsPath: true,
      wpShowId: true,
      title: true,
      metadata: true,
    },
  });

  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const metadata = job.metadata as Record<string, unknown>;

  // Case 1: Upload-based job — video file is already in GCS at job.gcsPath
  if (job.gcsPath && !metadata.existingYoutubeUrl && !metadata.existingVimeoUrl) {
    const url = await generateSignedDownloadUrl(job.gcsPath, 4 * 60 * 60 * 1000); // 4 hours
    return NextResponse.json({ downloadUrl: url });
  }

  // Case 2: URL-sourced job — check if we've already downloaded the full video
  const existingVideoGcsPath = metadata.gcsFullVideoPath as string | undefined;
  if (existingVideoGcsPath) {
    const url = await generateSignedDownloadUrl(existingVideoGcsPath, 4 * 60 * 60 * 1000);
    return NextResponse.json({ downloadUrl: url });
  }

  // Case 3: URL-sourced job — need to download the full video first
  const videoUrl = (metadata.existingYoutubeUrl ?? metadata.existingVimeoUrl) as string | undefined;
  if (!videoUrl) {
    return NextResponse.json(
      { error: "No video source found for this job" },
      { status: 400 }
    );
  }

  try {
    const gcsPath = await downloadFullVideoToGcs(videoUrl, job.id, job.wpShowId ?? undefined);

    // Cache the GCS path in metadata so future clicks don't re-download.
    // Wrap with JSON.parse/stringify to satisfy Prisma's strict JsonValue type.
    await db.distributionJob.update({
      where: { id: job.id },
      data: {
        metadata: JSON.parse(
          JSON.stringify({ ...metadata, gcsFullVideoPath: gcsPath })
        ),
      },
    });

    const url = await generateSignedDownloadUrl(gcsPath, 4 * 60 * 60 * 1000);
    return NextResponse.json({ downloadUrl: url });
  } catch (error) {
    console.error(`[download-video] Failed to download video for job ${job.id}:`, error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to download video" },
      { status: 500 }
    );
  }
}
