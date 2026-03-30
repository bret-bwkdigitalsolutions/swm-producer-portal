import { NextRequest, NextResponse } from "next/server";
import { processJob } from "@/lib/jobs/processor";

/**
 * POST /api/jobs/process
 *
 * Triggers processing of a specific distribution job by ID.
 * Protected by a shared secret so it can be called from internal
 * endpoints (e.g., the confirm action) without exposing the
 * endpoint publicly.
 *
 * Body:
 *   { "jobId": "<distribution-job-id>" }
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

  // Parse the job ID from the request body
  const body = await request.json().catch(() => null);
  const jobId = body?.jobId;
  if (!jobId || typeof jobId !== "string") {
    return NextResponse.json(
      { error: "Missing or invalid jobId in request body" },
      { status: 400 }
    );
  }

  try {
    const result = await processJob(jobId);

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
