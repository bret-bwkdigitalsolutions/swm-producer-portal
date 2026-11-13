import {
  MARK_DEDUPE_SECONDS,
  MARK_QUOTE_MAX_CHARS,
} from "./constants";
import { plainCue, plainQuote, type LiveMark } from "./payload";

/**
 * Today's OG premium show. The website stores this event on Your Dark
 * Companion (show 21). `VIMEO_LIVE_EVENTS` replaces this list when set.
 */
export const DEFAULT_VIMEO_LIVE_EVENT = {
  eventId: "6344608",
  hash: "f86b2c8698",
  showId: 21,
} as const;

/** Referer the embed-only OG event accepts. Override with VIMEO_LIVE_REFERRER. */
export const DEFAULT_VIMEO_LIVE_REFERRER = "https://stolenwatermedia.com/";

/**
 * Fields requested from the live event. Deliberately omits stream_key,
 * backup_stream_key, and every RTMP link.
 */
export const VIMEO_EVENT_FIELDS = [
  "uri",
  "title",
  "stream_privacy.view",
  "clip_to_play.uri",
  "clip_to_play.live.status",
  "clip_to_play.config_url",
  "streamable_clip.uri",
  "streamable_clip.live.status",
  "streamable_clip.config_url",
].join(",");

export interface VimeoLiveEventConfig {
  eventId: string;
  /** Unlisted hash. Empty when the event URL has none. */
  hash: string;
  showId: number;
}

export type VimeoLiveStatus = "streaming" | "done" | "unavailable" | "unknown";

export interface VimeoEventSnapshot {
  eventId: string;
  title: string | null;
  privacy: string | null;
  status: VimeoLiveStatus;
  videoId: string | null;
  configUrl: string | null;
}

export interface VimeoHlsSource {
  url: string;
  /** Unix seconds the ingest reported, when the player config includes it. */
  streamStartedAt: number | null;
}

/**
 * `eventId:hash:showId` entries, comma-separated. The hash may be empty
 * (`eventId::showId`). `off` watches nothing. Blank uses the OG default.
 */
export function parseVimeoLiveEvents(
  raw: string | undefined = process.env.VIMEO_LIVE_EVENTS
): VimeoLiveEventConfig[] {
  if (raw == null || raw.trim() === "") {
    return [{ ...DEFAULT_VIMEO_LIVE_EVENT }];
  }
  const value = raw.trim();
  if (value.toLowerCase() === "off" || value === "-") return [];
  const events: VimeoLiveEventConfig[] = [];
  for (const part of value.split(",")) {
    const piece = part.trim();
    if (!piece) continue;
    const [eventIdRaw, hashRaw, showRaw] = piece.split(":");
    const eventId = (eventIdRaw ?? "").trim();
    const showId = Number.parseInt((showRaw ?? "").trim(), 10);
    if (!/^\d{3,20}$/.test(eventId)) continue;
    if (!Number.isFinite(showId) || showId <= 0) continue;
    const hash = (hashRaw ?? "").trim();
    if (hash && !/^[A-Za-z0-9]+$/.test(hash)) continue;
    events.push({ eventId, hash, showId });
  }
  return events;
}

export function vimeoLiveReferrer(
  raw: string | undefined = process.env.VIMEO_LIVE_REFERRER
): string {
  const value = raw?.trim();
  if (!value) return DEFAULT_VIMEO_LIVE_REFERRER;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return DEFAULT_VIMEO_LIVE_REFERRER;
    return url.toString();
  } catch {
    return DEFAULT_VIMEO_LIVE_REFERRER;
  }
}

export function redactSecrets(text: string): string {
  return text
    .replace(/bearer\s+\S+/gi, "bearer [redacted]")
    .replace(/jwt\s+\S+/gi, "jwt [redacted]")
    .replace(/https?:\/\/\S+/g, "[url]")
    .slice(0, 500);
}

function videoIdFromUri(uri: unknown): string | null {
  if (typeof uri !== "string") return null;
  const match = uri.match(/\/videos\/(\d+)/);
  return match ? match[1] : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function clipStatus(clip: Record<string, unknown> | null): VimeoLiveStatus {
  const live = asRecord(clip?.live);
  const status = live?.status;
  if (status === "streaming" || status === "done" || status === "unavailable") {
    return status;
  }
  return "unknown";
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("https://")) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Read the event JSON. Ignores stream keys and RTMP links when a response
 * includes them anyway.
 */
export function parseVimeoEventSnapshot(
  eventId: string,
  body: unknown
): VimeoEventSnapshot {
  const row = asRecord(body);
  const clip = asRecord(row?.clip_to_play) ?? asRecord(row?.streamable_clip);
  const streamable = asRecord(row?.streamable_clip);
  const privacy = asRecord(row?.stream_privacy);
  const title = typeof row?.title === "string" ? row.title : null;
  const view = typeof privacy?.view === "string" ? privacy.view : null;
  const videoId = videoIdFromUri(clip?.uri) ?? videoIdFromUri(streamable?.uri);
  const configUrl =
    httpsUrl(clip?.config_url) ?? httpsUrl(streamable?.config_url);
  return {
    eventId,
    title,
    privacy: view,
    status: clipStatus(clip),
    videoId,
    configUrl,
  };
}

function hostAllowed(hostname: string): boolean {
  return (
    hostname === "vimeo.com" ||
    hostname === "player.vimeo.com" ||
    hostname.endsWith(".vimeocdn.com") ||
    hostname.endsWith(".vimeo.com")
  );
}

/**
 * Player-config HLS URL plus the ingest start, when present.
 * Returns null when the config has no allowed HLS URL.
 */
export function parseVimeoHlsSource(body: unknown): VimeoHlsSource | null {
  const row = asRecord(body);
  const request = asRecord(row?.request);
  const files = asRecord(request?.files);
  const hls = asRecord(files?.hls);
  const cdns = asRecord(hls?.cdns);
  if (!cdns) return null;
  const preferred =
    typeof hls?.default_cdn === "string" ? hls.default_cdn : null;
  const order = preferred
    ? [preferred, ...Object.keys(cdns).filter((key) => key !== preferred)]
    : Object.keys(cdns);
  let url: string | null = null;
  for (const key of order) {
    const cdn = asRecord(cdns[key]);
    const candidate = httpsUrl(cdn?.url) ?? httpsUrl(cdn?.avc_url);
    if (!candidate) continue;
    if (!hostAllowed(new URL(candidate).hostname)) continue;
    url = candidate;
    break;
  }
  if (!url) return null;
  return { url, streamStartedAt: readStreamStartedAt(row) };
}

function readStreamStartedAt(row: Record<string, unknown> | null): number | null {
  const video = asRecord(row?.video);
  const live = asRecord(video?.live_event);
  const ingest = asRecord(live?.ingest);
  const raw = ingest?.start_time;
  const numeric = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const seconds = numeric > 10_000_000_000 ? numeric / 1000 : numeric;
  return Math.floor(seconds);
}

/** 30-second bucket shared with the YouTube cue dedupe. */
export function vimeoMarkBucket(offsetSeconds: number): number {
  const seconds = Number.isFinite(offsetSeconds) ? Math.floor(offsetSeconds) : 0;
  return Math.floor(Math.max(0, seconds) / MARK_DEDUPE_SECONDS);
}

/**
 * Identity of one cue. The live pass may not know the video id yet and the
 * archive pass will. The bucket ignores the video id so those two passes
 * cannot both post the same moment.
 */
export function vimeoMarkIdentity(
  eventId: string,
  offsetSeconds: number
): { eventId: string; dedupeBucket: number } {
  return { eventId, dedupeBucket: vimeoMarkBucket(offsetSeconds) };
}

/** Blank when the live pass has not learned a video id yet. */
export function vimeoVideoKey(videoId: string | null | undefined): string {
  return videoId?.trim() ?? "";
}

/**
 * A watcher that already ran its full window for this video does not start
 * another one while that same video is still the current broadcast.
 */
export function vimeoLiveWatchRestartAllowed(input: {
  videoId: string | null;
  exhaustedVideoId: string | null;
}): boolean {
  if (input.exhaustedVideoId == null) return true;
  return input.exhaustedVideoId !== vimeoVideoKey(input.videoId);
}

/** One Deepgram window fits the shared daily cap when fewer than `cap` are used. */
export function vimeoPaidWindowAllowed(usedToday: number, cap: number): boolean {
  return usedToday < cap;
}

export type VimeoPostFailureKind =
  | "website_not_ready"
  | "overlap"
  | "config"
  | "contract"
  | "retryable";

/**
 * A 400 or 422 is terminal, the same class as the YouTube `contract_error`
 * plan. Other failures stay retryable. A 401 or 403 stops the loop but is
 * not a rejected payload.
 */
export function vimeoFailureDisposition(
  kind: VimeoPostFailureKind
): "retry" | "terminal" | "stop" {
  if (kind === "contract") return "terminal";
  if (kind === "config") return "stop";
  return "retry";
}

/**
 * ffprobe `format.start_time` on this live HLS is the seconds from ingest
 * start to the live edge. Utterance times in a capture that begins at that
 * edge are added to it.
 */
export function utterancesAtStreamEdge<T extends { start: number; end: number }>(
  utterances: T[],
  edgeSeconds: number
): T[] {
  const edge = Number.isFinite(edgeSeconds) ? Math.max(0, edgeSeconds) : 0;
  return utterances.map((utterance) => ({
    ...utterance,
    start: utterance.start + edge,
    end: utterance.end + edge,
  }));
}

export interface VimeoLiveMarkPayload {
  show_id: number;
  platform: "vimeo";
  vimeo_event_id: string;
  vimeo_video_id?: string;
  offset_seconds: number;
  cue_text: string;
  source: "live_transcript";
  marks: Array<LiveMark & { offset_seconds: number; cue_text: string }>;
}

/** Snippet sent as cue_text: the quote, then the spoken cue. */
export function vimeoCueText(mark: LiveMark): string {
  const quote = plainQuote(mark.quote);
  const cue = plainCue(mark.cue);
  const combined = [quote, cue].filter(Boolean).join(" ");
  if (combined.length <= MARK_QUOTE_MAX_CHARS) return combined;
  return plainQuote(combined);
}

/**
 * One mark per POST. `offset_seconds` is the same lead-adjusted second the
 * YouTube payload sends as `seconds` (cue start minus 10, clamped).
 */
export function buildVimeoLiveMarkPayload(input: {
  showId: number;
  eventId: string | number;
  videoId?: string | number | null;
  mark: LiveMark;
}): VimeoLiveMarkPayload {
  const cueText = vimeoCueText(input.mark);
  const offset = input.mark.seconds;
  const mark = {
    seconds: offset,
    offset_seconds: offset,
    quote: input.mark.quote,
    cue: input.mark.cue,
    cue_text: cueText,
  };
  const payload: VimeoLiveMarkPayload = {
    show_id: input.showId,
    platform: "vimeo",
    vimeo_event_id: String(input.eventId).trim(),
    offset_seconds: offset,
    cue_text: cueText,
    source: "live_transcript",
    marks: [mark],
  };
  if (input.videoId != null && String(input.videoId).trim() !== "") {
    payload.vimeo_video_id = String(input.videoId).trim();
  }
  return payload;
}
