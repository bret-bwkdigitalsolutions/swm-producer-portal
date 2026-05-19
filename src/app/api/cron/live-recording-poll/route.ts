import { NextRequest, NextResponse } from "next/server";
import { pollLiveRecordings } from "@/lib/live-recording/poll";

/**
 * Railway cron target — schedule every 2 minutes against this endpoint
 * with an Authorization header carrying `Bearer ${CRON_SECRET}`. One
 * request per tick walks all active LiveRecording rows, derives state
 * transitions, and pushes updates to WordPress. Returns a JSON summary
 * so Railway logs show what happened on each tick.
 */
export async function POST(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured on the server." },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization") ?? "";
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const summary = await pollLiveRecordings();
    console.log(
      `[live-recording-poll] checked=${summary.totalChecked} transitions=${summary.transitions.length} handoffs=${summary.handoffsTriggered.length} failures=${summary.failures.length}`
    );
    return NextResponse.json(summary);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown poll worker error";
    console.error("[live-recording-poll] Fatal:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET is exposed for ad-hoc admin debugging — same auth check.
export async function GET(request: NextRequest) {
  return POST(request);
}
