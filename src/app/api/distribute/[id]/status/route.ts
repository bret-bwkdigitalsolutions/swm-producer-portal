import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const job = await db.distributionJob.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      userId: true,
      platforms: {
        select: {
          id: true,
          platform: true,
          status: true,
          error: true,
          externalId: true,
          externalUrl: true,
          completedAt: true,
        },
      },
    },
  });

  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Verify ownership (admins can view any job)
  if (job.userId !== session.user.id && session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    status: job.status,
    platforms: job.platforms.map((p) => ({
      id: p.id,
      platform: p.platform,
      status: p.status,
      error: p.error,
      externalId: p.externalId,
      externalUrl: p.externalUrl,
      completedAt: p.completedAt?.toISOString() ?? null,
    })),
  });
}
