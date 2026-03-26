import { NextRequest, NextResponse } from "next/server";
import { processNextJob } from "@/lib/jobs/processor";

/**
 * POST /api/jobs/process
 *
 * Triggers processing of the next pending distribution job.
 * Protected by a shared secret so it can be called from a cron scheduler
 * (e.g., Railway cron) or an external webhook without exposing the
 * endpoint publicly.
 *
 * Headers:
 *   Authorization: Bearer <JOB_PROCESSING_SECRET>
 */
export async function POST(request: NextRequest) {
  // Authenticate the request
  const secret = process.env.JOB_PROCESSING_SECRET;
  if (!secret) {
    console.error(
      "[api/jobs/process] JOB_PROCESSING_SECRET is not configured."
    );
    return NextResponse.json(
      { error: "Server misconfiguration" },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (token !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await processNextJob();

    if (!result) {
      return NextResponse.json(
        { message: "No pending jobs", processed: false },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        message: `Job ${result.jobId} processed`,
        processed: true,
        jobId: result.jobId,
        status: result.status,
        platforms: result.platformResults,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[api/jobs/process] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
