import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { processJob } from "@/lib/jobs/processor";
import { checkForDuplicates } from "@/lib/jobs/duplicate-check";

export async function POST(request: NextRequest) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { jobId?: string; skipProcessing?: boolean; forceDuplicates?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 }
    );
  }

  const { jobId, skipProcessing, forceDuplicates } = body;
  if (!jobId) {
    return NextResponse.json(
      { error: "Missing required field: jobId." },
      { status: 400 }
    );
  }

  const job = await db.distributionJob.findUnique({
    where: { id: jobId },
    select: {
      id: true, userId: true, status: true, gcsPath: true, metadata: true,
      title: true, wpShowId: true,
      platforms: { select: { platform: true } },
    },
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

  // Allow "uploading" (normal flow) or "pending" (AI path triggering processing after review)
  const allowedStatuses = ["uploading", "pending"];
  if (!allowedStatuses.includes(job.status)) {
    return NextResponse.json(
      { error: `Job is not in a confirmable state (current: ${job.status}).` },
      { status: 409 }
    );
  }

  if (!job.gcsPath) {
    const jobMetadata = job.metadata as Record<string, unknown>;
    if (!jobMetadata.existingYoutubeUrl) {
      return NextResponse.json(
        { error: "No file has been uploaded for this job." },
        { status: 400 }
      );
    }
    // Live YouTube job — no GCS upload needed, proceeding without a file
  }

  // Move to pending if still uploading
  if (job.status === "uploading") {
    await db.distributionJob.update({
      where: { id: jobId },
      data: { status: "pending" },
    });
  }

  // If skipProcessing is set, just mark upload as done without triggering processing
  // (used by AI path to confirm upload before running analysis)
  if (skipProcessing) {
    return NextResponse.json({ success: true, status: "pending" });
  }

  // Pre-distribution duplicate check: refuse to publish to any platform that
  // already has an episode with the same title for this show, unless the
  // caller has explicitly confirmed by passing forceDuplicates=true. Catches
  // accidental re-distribution of the same content.
  if (!forceDuplicates && job.platforms.length > 0) {
    try {
      const dupResult = await checkForDuplicates(
        job.wpShowId,
        job.title,
        job.platforms.map((p) => p.platform),
      );
      if (Object.keys(dupResult.matches).length > 0) {
        return NextResponse.json(
          {
            error: "duplicate_detected",
            message:
              "An episode with this title already appears on one or more selected platforms. Confirm to distribute anyway.",
            duplicates: dupResult.matches,
          },
          { status: 409 }
        );
      }
    } catch (err) {
      // Non-fatal — log and proceed. Better to ship than to block on a
      // platform-API hiccup during the duplicate check.
      console.warn(`[confirm] duplicate check failed for ${jobId}:`, err);
    }
  }

  // Atomically transition to processing to prevent double invocation
  const updated = await db.distributionJob.updateMany({
    where: { id: jobId, status: "pending" },
    data: { status: "processing" },
  });

  if (updated.count === 0) {
    return NextResponse.json(
      { error: "Job is already being processed." },
      { status: 409 }
    );
  }

  // Trigger processing (non-blocking)
  processJob(jobId).catch((error) => {
    console.error(`[confirm] Background processing failed for job ${jobId}:`, error);
  });

  return NextResponse.json({ success: true, status: "processing" });
}
