import "server-only";

import crypto from "crypto";

/**
 * CSRF protection for the YouTube "connect channel" OAuth flow.
 *
 * The OAuth `state` used to be just the show ID, so anyone who could get an
 * admin to open a crafted callback URL could attach *their* YouTube channel to
 * a show. Now the state is `<showId>.<random nonce>`, the same value is kept
 * in a short-lived httpOnly cookie, and the callback only proceeds when the
 * two match.
 */

export const YOUTUBE_OAUTH_STATE_COOKIE = "swm_yt_oauth_state";
export const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;

export function createOAuthState(wpShowId: number): string {
  const nonce = crypto.randomBytes(24).toString("base64url");
  return `${wpShowId}.${nonce}`;
}

/** Parse the show ID out of a state value (`<showId>.<nonce>`). */
export function parseOAuthStateShowId(state: string | null | undefined): number | null {
  if (!state) return null;
  const match = /^(\d+)\.[A-Za-z0-9_-]{16,}$/.exec(state);
  if (!match) return null;
  const id = parseInt(match[1], 10);
  return Number.isNaN(id) ? null : id;
}

/** Constant-time comparison of the returned state with the cookie value. */
export function verifyOAuthState(
  state: string | null | undefined,
  cookieValue: string | null | undefined
): boolean {
  if (!state || !cookieValue) return false;
  if (parseOAuthStateShowId(state) === null) return false;
  const a = Buffer.from(state);
  const b = Buffer.from(cookieValue);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function oauthStateCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // "lax" so the cookie is sent on Google's top-level redirect back to us.
    sameSite: "lax" as const,
    path: "/api/oauth/youtube",
    maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
  };
}
