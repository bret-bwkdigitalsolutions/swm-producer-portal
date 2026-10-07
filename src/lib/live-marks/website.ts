import "server-only";

import { wpAuthorizationHeader } from "@/lib/wordpress/client";
import { WpConfigError } from "@/lib/wordpress/types";
import {
  buildLiveMarksPayload,
  parseLiveMarksResponse,
  type LiveMark,
  type LiveMarksApiResponse,
  type LiveMarksPayload,
} from "./payload";

const REQUEST_TIMEOUT_MS = 20_000;

export type PostLiveMarksResult =
  | { ok: true; response: LiveMarksApiResponse }
  | { ok: false; kind: "website_not_ready" }
  | { ok: false; kind: "config"; message: string }
  | { ok: false; kind: "retryable"; message: string };

/**
 * `{WP origin}/wp-json/swm-chat/v1/portal/live-marks`.
 * `WP_API_URL` is the wp/v2 base (`https://host/wp-json/wp/v2`).
 */
export function liveMarksEndpointUrl(wpApiUrl: string): string {
  const trimmed = wpApiUrl.trim().replace(/\/$/, "");
  const origin = trimmed
    .replace(/\/wp-json\/wp\/v2$/, "")
    .replace(/\/wp-json$/, "");
  return `${origin}/wp-json/swm-chat/v1/portal/live-marks`;
}

/**
 * POST the marks with the same Basic app-password header as other portal
 * writes (`createPost` / `_swm_supersedes` in the WordPress client).
 * The website accepts that user when it can `edit_others_posts`.
 *
 * A 404 is `website_not_ready` (the portal may ship before the route
 * exists). A 401 or 403 is a config error, the same class as
 * {@link WpConfigError}: the caller must not retry it.
 */
export async function postLiveMarks(input: {
  wpShowId: number;
  youtubeVideoId: string;
  marks: LiveMark[];
}): Promise<PostLiveMarksResult> {
  const payload = buildLiveMarksPayload(input);
  return postLiveMarksPayload(payload);
}

export async function postLiveMarksPayload(
  payload: LiveMarksPayload
): Promise<PostLiveMarksResult> {
  const wpApiUrl = process.env.WP_API_URL?.trim();
  if (!wpApiUrl) {
    return {
      ok: false,
      kind: "config",
      message: "WP_API_URL is not configured.",
    };
  }
  const endpoint = liveMarksEndpointUrl(wpApiUrl);

  let authorization: string;
  try {
    authorization = wpAuthorizationHeader();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const configError = new WpConfigError(
      `WP API config error: ${reason}`,
      endpoint
    );
    return { ok: false, kind: "config", message: configError.message };
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "TimeoutError"
        ? "timed out"
        : error instanceof Error
          ? error.message
          : "could not be reached";
    return {
      ok: false,
      kind: "retryable",
      message: `Website marks request failed: ${reason}`,
    };
  }

  if (response.status === 404) {
    return { ok: false, kind: "website_not_ready" };
  }

  if (response.status === 401 || response.status === 403) {
    const configError = new WpConfigError(
      `WordPress rejected the marks request (HTTP ${response.status}). The app user must be allowed to edit others' posts. Not retrying.`,
      endpoint
    );
    return { ok: false, kind: "config", message: configError.message };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return {
      ok: false,
      kind: "retryable",
      message: `Website marks request failed (HTTP ${response.status})${
        body ? `: ${body.slice(0, 300)}` : ""
      }`,
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      ok: false,
      kind: "retryable",
      message: "Website marks response was not JSON.",
    };
  }
  const parsed = parseLiveMarksResponse(body);
  if (!parsed) {
    return {
      ok: false,
      kind: "retryable",
      message: "Website marks response did not include stored, posted_to, and live_post_id.",
    };
  }
  return { ok: true, response: parsed };
}
