import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  exchangeCodeForTokens,
  getYouTubeChannelInfo,
} from "@/lib/youtube-oauth";

function baseUrl(): string {
  return process.env.NEXTAUTH_URL ?? "http://localhost:3000";
}

export async function GET(request: NextRequest) {
  // Verify the user is an authenticated admin
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return NextResponse.redirect(new URL("/login", baseUrl()));
  }

  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state"); // wpShowId
  const error = searchParams.get("error");

  if (error) {
    const wpShowId = state ?? "0";
    return NextResponse.redirect(
      new URL(
        `/admin/credentials/${wpShowId}?error=${encodeURIComponent(error)}`,
        baseUrl()
      )
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      new URL("/admin/credentials?error=missing_params", baseUrl())
    );
  }

  const wpShowId = parseInt(state, 10);
  if (isNaN(wpShowId) || wpShowId < 0) {
    return NextResponse.redirect(
      new URL("/admin/credentials?error=invalid_show", baseUrl())
    );
  }

  try {
    // Exchange the authorization code for tokens
    const tokens = await exchangeCodeForTokens(code);

    // Store the credential first (before any API calls that might fail)
    await db.platformCredential.upsert({
      where: { wpShowId_platform: { wpShowId, platform: "youtube" } },
      create: {
        wpShowId,
        platform: "youtube",
        credentialType: "oauth",
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenExpiresAt: tokens.expiresAt,
        status: "valid",
      },
      update: {
        credentialType: "oauth",
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenExpiresAt: tokens.expiresAt,
        status: "valid",
      },
    });

    // Try to get channel info for the success message (non-blocking)
    let channelLabel = "YouTube account";
    try {
      const channelInfo = await getYouTubeChannelInfo(tokens.accessToken);
      channelLabel = `${channelInfo.title} (${channelInfo.channelId})`;
    } catch (channelErr) {
      console.warn("Could not fetch YouTube channel info:", channelErr);
    }

    // Redirect back with success
    const successMsg = encodeURIComponent(
      `YouTube connected: ${channelLabel}`
    );
    return NextResponse.redirect(
      new URL(
        `/admin/credentials/${wpShowId}?success=${successMsg}`,
        baseUrl()
      )
    );
  } catch (err) {
    console.error("YouTube OAuth callback error:", err);
    const errorMsg = encodeURIComponent(
      err instanceof Error ? err.message : "Failed to connect YouTube"
    );
    return NextResponse.redirect(
      new URL(
        `/admin/credentials/${wpShowId}?error=${errorMsg}`,
        baseUrl()
      )
    );
  }
}
