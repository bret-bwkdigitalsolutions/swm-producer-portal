import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { processJob } from "@/lib/jobs/processor";

export async function POST(request: NextRequest) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { jobId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 }
    );
  }

  const { jobId } = body;
  if (!jobId) {
    return NextResponse.json(
      { error: "Missing required field: jobId." },
      { status: 400 }
    );
  }

  const job = await db.distributionJob.findUnique({
    where: { id: jobId },
    select: { id: true, userId: true, status: true, gcsPath: true, metadata: true },
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

  if (job.status !== "uploading") {
    return NextResponse.json(
      { error: `Job is not in uploading state (current: ${job.status}).` },
      { status: 409 }
    );
  }

  if (!job.gcsPath) {
    return NextResponse.json(
      { error: "No file has been uploaded for this job." },
      { status: 400 }
    );
  }

  // Move to pending
  await db.distributionJob.update({
    where: { id: jobId },
    data: { status: "pending" },
  });

  // Check if this is a scheduled post
  const metadata = job.metadata as Record<string, unknown>;
  const scheduleMode = (metadata.scheduleMode as string) ?? "now";

  if (scheduleMode === "schedule") {
    // Leave as pending — a scheduled job cron will pick it up
    return NextResponse.json({ success: true, status: "scheduled" });
  }

  // Trigger processing immediately (non-blocking)
  processJob(jobId).catch((error) => {
    console.error(`[confirm] Background processing failed for job ${jobId}:`, error);
  });

  return NextResponse.json({ success: true, status: "processing" });
}
