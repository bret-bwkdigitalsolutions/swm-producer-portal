import "server-only";

import {
  VIMEO_EVENT_FIELDS,
  parseVimeoEventSnapshot,
  parseVimeoHlsSource,
  redactSecrets,
  vimeoLiveReferrer,
  type VimeoEventSnapshot,
  type VimeoHlsSource,
  type VimeoLiveEventConfig,
} from "./vimeo-events";

const API = "https://api.vimeo.com";
const VIEWER_URL = "https://vimeo.com/_next/viewer";

export interface VimeoLiveReading {
  snapshot: VimeoEventSnapshot;
  hls: VimeoHlsSource | null;
  /** Which credential called the API. Never the secret itself. */
  auth: "bearer" | "viewer";
}

let viewerJwt: { value: string; exp: number } | null = null;

function jwtExpiry(token: string): number {
  try {
    const part = token.split(".")[1];
    if (!part) return 0;
    const json = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as {
      exp?: unknown;
    };
    return typeof json.exp === "number" ? json.exp : 0;
  } catch {
    return 0;
  }
}

async function viewerAuthorization(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (viewerJwt && viewerJwt.exp - now > 60) {
    return `jwt ${viewerJwt.value}`;
  }
  const response = await fetch(VIEWER_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Vimeo viewer token request failed (HTTP ${response.status}).`);
  }
  const body = (await response.json()) as { jwt?: unknown };
  if (typeof body.jwt !== "string" || !body.jwt) {
    throw new Error("Vimeo viewer token response had no jwt.");
  }
  viewerJwt = { value: body.jwt, exp: jwtExpiry(body.jwt) };
  return `jwt ${body.jwt}`;
}

async function authorizationHeader(): Promise<{ header: string; auth: "bearer" | "viewer" }> {
  const token = process.env.VIMEO_ACCESS_TOKEN?.trim();
  if (token) return { header: `Bearer ${token}`, auth: "bearer" };
  return { header: await viewerAuthorization(), auth: "viewer" };
}

async function vimeoGet(
  url: string,
  authorization: string | null,
  accept: string
): Promise<unknown> {
  const referrer = vimeoLiveReferrer();
  const headers: Record<string, string> = {
    Accept: accept,
    Referer: referrer,
  };
  if (authorization) headers.Authorization = authorization;
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Vimeo API ${response.status}: ${redactSecrets(text).slice(0, 180)}`
    );
  }
  return response.json();
}

/**
 * Read one configured event and, when the player config exposes it, the
 * live HLS URL. Playback URLs stay in memory. Stream keys are not requested.
 */
export async function readVimeoLiveEvent(
  event: VimeoLiveEventConfig
): Promise<VimeoLiveReading> {
  const referrer = vimeoLiveReferrer();
  const id = event.hash ? `${event.eventId}:${event.hash}` : event.eventId;
  const endpoint = new URL(`${API}/live_events/${id}`);
  endpoint.searchParams.set("fields", VIMEO_EVENT_FIELDS);
  endpoint.searchParams.set("referrer", referrer);
  endpoint.searchParams.set("clip_to_play_id", "0");

  const first = await authorizationHeader();
  let authorization = first.header;
  let auth = first.auth;
  let body: unknown;
  try {
    body = await vimeoGet(
      endpoint.toString(),
      authorization,
      "application/vnd.vimeo.*+json;version=3.4.9"
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (auth !== "bearer" || !message.includes("401")) throw error;
    authorization = await viewerAuthorization();
    auth = "viewer";
    body = await vimeoGet(
      endpoint.toString(),
      authorization,
      "application/vnd.vimeo.*+json;version=3.4.9"
    );
  }

  const snapshot = parseVimeoEventSnapshot(event.eventId, body);
  let hls: VimeoHlsSource | null = null;
  if (snapshot.configUrl) {
    // The player config is authorized by the event referrer, not the
    // account token. Do not send the token to player.vimeo.com.
    const config = await vimeoGet(snapshot.configUrl, null, "application/json");
    hls = parseVimeoHlsSource(config);
  }
  return { snapshot, hls, auth };
}
