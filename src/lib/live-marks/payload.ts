import {
  LIVE_MARKS_SOURCE,
  MARK_CUE_MAX_CHARS,
  MARK_QUOTE_MAX_CHARS,
  MARK_SECONDS_MAX,
  MAX_MARKS_PER_POST,
} from "./constants";

export interface LiveMark {
  seconds: number;
  quote: string;
  /** Short spoken cue, e.g. "mark that". Always sent; "" is allowed. */
  cue: string;
}

export interface LiveMarksPayload {
  show_id: number;
  live_youtube_id: string;
  marks: LiveMark[];
  source: typeof LIVE_MARKS_SOURCE;
}

export interface LiveMarksApiResponse {
  stored: number;
  posted_to: number | null;
  live_post_id: number | null;
}

/** Integer seconds in `[0, 86400]`. */
export function clampMarkSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return 0;
  return Math.min(MARK_SECONDS_MAX, Math.max(0, Math.floor(seconds)));
}

/** Plain text, at most 280 characters, keeping the end closest to the cue. */
export function plainQuote(text: string): string {
  const plain = text
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= MARK_QUOTE_MAX_CHARS) return plain;
  const tail = plain.slice(plain.length - MARK_QUOTE_MAX_CHARS).trimStart();
  const space = tail.search(/\s/);
  if (space > 0 && space < 40) return tail.slice(space + 1);
  return tail.slice(0, MARK_QUOTE_MAX_CHARS);
}

/** Short cue such as "mark that". Empty becomes "". */
export function plainCue(text: string | null | undefined): string {
  const plain = (text ?? "").replace(/\s+/g, " ").trim();
  if (plain.length <= MARK_CUE_MAX_CHARS) return plain;
  return plain.slice(0, MARK_CUE_MAX_CHARS).trim();
}

export function sanitizeLiveMark(mark: {
  seconds: number;
  quote: string;
  cue?: string | null;
}): LiveMark {
  return {
    seconds: clampMarkSeconds(mark.seconds),
    quote: plainQuote(mark.quote),
    cue: plainCue(mark.cue),
  };
}

export function buildLiveMarksPayload(input: {
  wpShowId: number;
  youtubeVideoId: string;
  marks: Array<{ seconds: number; quote: string; cue?: string | null }>;
}): LiveMarksPayload {
  const marks = input.marks
    .map((mark) => sanitizeLiveMark(mark))
    .sort((a, b) => a.seconds - b.seconds)
    .slice(0, MAX_MARKS_PER_POST);
  return {
    show_id: input.wpShowId,
    live_youtube_id: input.youtubeVideoId,
    marks,
    source: LIVE_MARKS_SOURCE,
  };
}

/** `https://www.youtube.com/watch?v=<id>&t=<seconds>s` */
export function youtubeTimestampUrl(videoId: string, seconds: number): string {
  const t = Math.max(0, Math.floor(seconds));
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&t=${t}s`;
}

export function formatMarkClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
}

export function readStoredMarks(value: unknown): LiveMark[] {
  if (!Array.isArray(value)) return [];
  const marks: LiveMark[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.seconds !== "number" || !Number.isFinite(row.seconds)) continue;
    if (typeof row.quote !== "string") continue;
    marks.push({
      seconds: clampMarkSeconds(row.seconds),
      quote: plainQuote(row.quote),
      cue: typeof row.cue === "string" ? plainCue(row.cue) : "",
    });
  }
  return marks;
}

export function readStoredMarksResponse(value: unknown): LiveMarksApiResponse | null {
  return parseLiveMarksResponse(value);
}

export function parseLiveMarksResponse(value: unknown): LiveMarksApiResponse | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.stored !== "number" || !Number.isFinite(row.stored)) return null;
  const posted = nullablePostId(row.posted_to);
  const live = nullablePostId(row.live_post_id);
  if (posted === undefined || live === undefined) return null;
  return { stored: row.stored, posted_to: posted, live_post_id: live };
}

function nullablePostId(value: unknown): number | null | undefined {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

export function transcriptStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "pending":
      return "Queued";
    case "processing":
      return "Transcribing";
    case "completed":
      return "Scanned";
    case "skipped":
      return "Skipped";
    case "website_not_ready":
      return "Website not ready";
    case "config_error":
      return "Configuration error";
    case "contract_error":
      return "Contract error";
    case "failed":
      return "Failed";
    default:
      return "Not scanned";
  }
}
