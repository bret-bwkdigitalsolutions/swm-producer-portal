import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export async function POST(request: NextRequest) {
  // Verify admin access
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // This endpoint can be used to trigger a scraper run via Railway's API
  // or by calling the scraper service directly. For now, it returns
  // the scrape log status so admins can monitor health.
  // In production, this would trigger the Railway cron job via their API.

  return NextResponse.json({
    message: "Scraper trigger endpoint ready. Wire up Railway cron trigger during deployment.",
    timestamp: new Date().toISOString(),
  });
}
