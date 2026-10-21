import { NextRequest, NextResponse } from "next/server";
import { bearerTokenMatches } from "@/lib/secure-compare";
import {
  PortalWordPressRequestError,
  dispatchPortalWordPress,
} from "@/lib/wordpress/portal-dispatch";
import {
  runOnPortal,
  serializePortalError,
} from "@/lib/wordpress/portal-proxy";

/**
 * POST /api/jobs/wordpress
 *
 * Cloud Run video workers call WordPress through here. Their egress address
 * changes every run and the site firewall blocks it. This process is the
 * Railway portal, which has a fixed IP.
 *
 * Headers:
 *   Authorization: Bearer <JOB_PROCESSING_SECRET>
 *
 * Body: `{ "op": "getShow" | "liveCandidate" | "createPost" | "updatePost" |
 *   "findEpisode" | "uploadMedia" | "verifyEpisode" | "recentEpisodeTitles" |
 *   "latestEpisodeNumbers", ... }`
 */
export async function POST(request: NextRequest) {
  const secret = process.env.JOB_PROCESSING_SECRET;
  if (!secret) {
    console.error("[api/jobs/wordpress] JOB_PROCESSING_SECRET is not configured.");
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  if (!bearerTokenMatches(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);

  try {
    const result = await runOnPortal(() => dispatchPortalWordPress(body));
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof PortalWordPressRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const op =
      body && typeof body === "object" && "op" in body ? String(body.op) : "unknown";
    console.error(
      `[api/jobs/wordpress] ${op} failed:`,
      error instanceof Error ? error.message : error
    );
    return NextResponse.json(
      { ok: false, error: serializePortalError(error) },
      { status: 502 }
    );
  }
}
