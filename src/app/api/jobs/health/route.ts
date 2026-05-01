import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/jobs/health
 *
 * Checks all PlatformCredentials and updates their status based on token
 * expiry. Returns a summary of credential health across all shows.
 *
 * Headers:
 *   Authorization: Bearer <JOB_PROCESSING_SECRET>
 */
export async function GET(request: NextRequest) {
  // Authenticate the request
  const secret = process.env.JOB_PROCESSING_SECRET;
  if (!secret) {
    console.error(
      "[api/jobs/health] JOB_PROCESSING_SECRET is not configured."
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
    const credentials = await db.platformCredential.findMany();

    const now = new Date();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    const results: {
      id: string;
      wpShowId: number;
      platform: string;
      previousStatus: string;
      newStatus: string;
    }[] = [];

    for (const cred of credentials) {
      let newStatus: "valid" | "expiring_soon" | "expired" = "valid";

      if (cred.credentialType === "oauth" && cred.refreshToken) {
        // OAuth access tokens are short-lived (~1h) but auto-refresh on next
        // use via the long-lived refresh token. Don't flip to "expired" from
        // access-token expiry alone — only a real refresh failure (recorded
        // in src/lib/analytics/credentials.ts) should mark these expired.
        newStatus = cred.status === "expired" ? "expired" : "valid";
      } else if (cred.tokenExpiresAt) {
        const expiresAt = new Date(cred.tokenExpiresAt);

        if (expiresAt <= now) {
          newStatus = "expired";
        } else if (expiresAt.getTime() - now.getTime() < sevenDaysMs) {
          newStatus = "expiring_soon";
        }
      }

      // Only update if status changed
      if (newStatus !== cred.status) {
        await db.platformCredential.update({
          where: { id: cred.id },
          data: { status: newStatus },
        });
      }

      results.push({
        id: cred.id,
        wpShowId: cred.wpShowId,
        platform: cred.platform,
        previousStatus: cred.status,
        newStatus,
      });
    }

    const summary = {
      total: results.length,
      valid: results.filter((r) => r.newStatus === "valid").length,
      expiringSoon: results.filter((r) => r.newStatus === "expiring_soon")
        .length,
      expired: results.filter((r) => r.newStatus === "expired").length,
    };

    return NextResponse.json(
      {
        message: "Health check complete",
        summary,
        credentials: results,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[api/jobs/health] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
