import { NextRequest, NextResponse } from "next/server";
import { bearerTokenMatches } from "@/lib/secure-compare";
import { queueDueLiveTranscriptions } from "@/lib/live-marks/queue";

/**
 * Drain one due live-recording mark scan.
 *
 * The live-recording poll cron also calls this, so a separate Railway
 * schedule is optional. Hit it directly to run one recording on staging:
 *   Authorization: Bearer ${CRON_SECRET}
 */
export async function POST(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured on the server." },
      { status: 500 }
    );
  }

  if (!bearerTokenMatches(request.headers.get("authorization"), expected)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const summary = await queueDueLiveTranscriptions();
    console.log(
      `[live-transcription] disabled=${summary.disabled} queued=${summary.queued.join(",") || "none"}`
    );
    return NextResponse.json(summary);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown live transcription error";
    console.error("[live-transcription] Fatal:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
