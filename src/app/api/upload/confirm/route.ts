import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

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
    select: { id: true, userId: true, status: true, gcsPath: true },
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

  // Move job to pending — ready for the processor to pick up
  await db.distributionJob.update({
    where: { id: jobId },
    data: { status: "pending" },
  });

  return NextResponse.json({ success: true, status: "pending" });
}
