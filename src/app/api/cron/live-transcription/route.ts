import { NextRequest, NextResponse } from "next/server";
import { bearerTokenMatches } from "@/lib/secure-compare";
import { queueDueLiveTranscriptions } from "@/lib/live-marks/queue";
import { queueVimeoLiveMarks } from "@/lib/live-marks/vimeo-watch";

/**
 * Drain one due live-recording mark scan, and check configured Vimeo events.
 *
 * The live-recording poll cron also calls both, so a separate Railway
 * schedule is optional. Hit it directly to run one recording on staging:
 *   Authorization: Bearer ${CRON_SECRET}
 *
 * Vimeo watching uses the same LIVE_TRANSCRIPTION_ENABLED switch as the
 * YouTube archive scan. While that variable is off, this route queues
 * neither. An admin Re-scan of a YouTube recording is a different action
 * and still runs while the flag is off.
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
    let vimeoMarks: Awaited<ReturnType<typeof queueVimeoLiveMarks>> | {
      error: string;
    };
    try {
      vimeoMarks = await queueVimeoLiveMarks();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Vimeo live marks failed";
      console.error("[live-transcription] Vimeo live marks failed:", error);
      vimeoMarks = { error: message };
    }
    console.log(
      `[live-transcription] disabled=${summary.disabled} queued=${summary.queued.join(",") || "none"} vimeoDisabled=${"disabled" in vimeoMarks ? vimeoMarks.disabled : "error"}`
    );
    return NextResponse.json({ ...summary, vimeoMarks });
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
