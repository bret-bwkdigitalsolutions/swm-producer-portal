import { LIVE_MARKS_SOURCE } from "./constants";

export interface LiveMark {
  seconds: number;
  quote: string;
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

export function buildLiveMarksPayload(input: {
  wpShowId: number;
  youtubeVideoId: string;
  marks: LiveMark[];
}): LiveMarksPayload {
  return {
    show_id: input.wpShowId,
    live_youtube_id: input.youtubeVideoId,
    marks: input.marks.map((mark) => ({
      seconds: mark.seconds,
      quote: mark.quote,
      cue: mark.cue,
    })),
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
    if (typeof row.quote !== "string" || typeof row.cue !== "string") continue;
    marks.push({
      seconds: Math.max(0, Math.floor(row.seconds)),
      quote: row.quote,
      cue: row.cue,
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
    case "failed":
      return "Failed";
    default:
      return "Not scanned";
  }
}
