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

    // Verify the connected account actually has a YouTube channel before
    // persisting anything. If we save without verifying, the credential will
    // look "valid" in the UI but every upload will fail with
    // youtubeSignupRequired (the picked Google account has no channel).
    let channelInfo: Awaited<ReturnType<typeof getYouTubeChannelInfo>>;
    try {
      channelInfo = await getYouTubeChannelInfo(tokens.accessToken);
    } catch (channelErr) {
      console.error("YouTube OAuth: channel verification failed", channelErr);
      const reason =
        channelErr instanceof Error &&
        channelErr.message.includes("No YouTube channel")
          ? "The Google account you picked has no YouTube channel. Re-connect and choose a brand account that owns a channel (e.g. Sunset Lounge)."
          : "Could not verify the YouTube channel for this account. Re-connect and try again.";
      return NextResponse.redirect(
        new URL(
          `/admin/credentials/${wpShowId}?error=${encodeURIComponent(reason)}`,
          baseUrl()
        )
      );
    }

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
        channelId: channelInfo.channelId,
        channelTitle: channelInfo.title,
      },
      update: {
        credentialType: "oauth",
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenExpiresAt: tokens.expiresAt,
        status: "valid",
        channelId: channelInfo.channelId,
        channelTitle: channelInfo.title,
      },
    });

    const successMsg = encodeURIComponent(
      `YouTube connected: ${channelInfo.title} (${channelInfo.channelId})`
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
