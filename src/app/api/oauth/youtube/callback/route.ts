import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  exchangeCodeForTokens,
  getYouTubeChannelInfo,
  getGoogleAccountEmail,
} from "@/lib/youtube-oauth";
import {
  oauthStateCookieOptions,
  parseOAuthStateShowId,
  verifyOAuthState,
  YOUTUBE_OAUTH_STATE_COOKIE,
} from "@/lib/oauth-state";

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
  const state = searchParams.get("state"); // "<wpShowId>.<nonce>"
  const error = searchParams.get("error");
  const expectedState = request.cookies.get(YOUTUBE_OAUTH_STATE_COOKIE)?.value;

  // Single-use: always clear the state cookie on the way out.
  const redirect = (path: string) => {
    const response = NextResponse.redirect(new URL(path, baseUrl()));
    response.cookies.set(YOUTUBE_OAUTH_STATE_COOKIE, "", { ...oauthStateCookieOptions(), maxAge: 0 });
    return response;
  };

  // CSRF check: the state must match the one we set when the flow started.
  if (!verifyOAuthState(state, expectedState)) {
    console.warn("YouTube OAuth callback: state mismatch or expired — rejecting");
    return redirect(
      `/admin/credentials?error=${encodeURIComponent("YouTube connection expired or was not started from this browser. Please click Connect again.")}`
    );
  }

  const wpShowId = parseOAuthStateShowId(state)!;

  if (error) {
    return redirect(`/admin/credentials/${wpShowId}?error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return redirect("/admin/credentials?error=missing_params");
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
      return redirect(`/admin/credentials/${wpShowId}?error=${encodeURIComponent(reason)}`);
    }

    // Capture which Google account granted this OAuth. Non-fatal if it fails
    // (older credentials may not have userinfo scope granted).
    const connectedEmail = await getGoogleAccountEmail(tokens.accessToken);

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
        connectedEmail,
      },
      update: {
        credentialType: "oauth",
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenExpiresAt: tokens.expiresAt,
        status: "valid",
        channelId: channelInfo.channelId,
        channelTitle: channelInfo.title,
        connectedEmail,
      },
    });

    const emailSuffix = connectedEmail ? ` via ${connectedEmail}` : "";
    const successMsg = encodeURIComponent(
      `YouTube connected: ${channelInfo.title} (${channelInfo.channelId})${emailSuffix}`
    );
    return redirect(`/admin/credentials/${wpShowId}?success=${successMsg}`);
  } catch (err) {
    console.error("YouTube OAuth callback error:", err);
    const errorMsg = encodeURIComponent(
      err instanceof Error ? err.message : "Failed to connect YouTube"
    );
    return redirect(`/admin/credentials/${wpShowId}?error=${errorMsg}`);
  }
}
