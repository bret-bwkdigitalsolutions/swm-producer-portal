import { NextRequest, NextResponse } from "next/server";
import { bearerTokenMatches } from "@/lib/secure-compare";
import { failStaleProcessingJobs } from "@/lib/jobs/stale-job-watchdog";

/**
 * Watchdog for distribution jobs whose worker stopped heartbeating.
 *
 * The web process also runs this on a timer (see instrumentation.ts). Point
 * a Railway cron at this route as a backstop — the startup sweep alone does
 * not run again until the next deploy.
 *
 *   Authorization: Bearer ${CRON_SECRET}
 *   Schedule: every 5 minutes (cron: every 5th minute)
 *
 * Post-distribution verification is not resumed here. Those checks are
 * setTimeouts armed at startup by resumeVerificationSchedules, and that
 * function schedules another timer per pending tier on every call. A
 * 5-minute tick would run the same tiers again.
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
    const summary = await failStaleProcessingJobs();
    console.log(
      `[sweep-stale-jobs] checked=${summary.checked} failed=${summary.failedIds.length}`
    );
    return NextResponse.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown watchdog error";
    console.error("[sweep-stale-jobs] Fatal:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
