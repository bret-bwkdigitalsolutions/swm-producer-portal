import "server-only";
import { wpAuthorizationHeader } from "@/lib/wordpress/client";

/**
 * Look up a live-stream `swm_episode` that a newly published episode should
 * replace. Contract from the website dedup endpoint:
 *   GET {WP}/wp-json/swm/v1/dedup/live-candidate?show_id=&date=&youtube_id=
 *   → { candidate: { id, title, youtube_id, date } | null }
 *
 * `youtube_id` is optional. When it is set, the website follow-up to PR #30
 * returns the same-show live candidate with that video id and ignores
 * `date`. Older website code ignores unknown params and still filters by
 * `date`, so callers keep sending a date. The route is live on production
 * and returns 401 without auth. Any error fails open so publishing
 * continues. Callers still require `candidate.youtube_id` to equal the id
 * they asked for.
 */

const AIR_TIME_ZONE = "America/Chicago";
const LOOKUP_TIMEOUT_MS = 15_000;

export interface LiveStreamCandidate {
  id: number;
  title: string;
  youtube_id: string;
  date: string;
}

/**
 * Calendar air/recording date (YYYY-MM-DD) in America/Chicago.
 * A bare YYYY-MM-DD is kept as-is so UTC parsing cannot shift it back a day.
 * Datetimes are converted to the Central calendar day. Missing or unparseable
 * input uses `now`.
 */
/**
 * Calendar day in America/Chicago, or null when `input` is missing or not a date.
 * Does not substitute today — callers that need a fallback use `toAirDate`.
 */
export function parseAirDate(input?: string | null): string | null {
  const trimmed = input?.trim() ?? "";
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatAirDate(parsed);
}

export function toAirDate(input?: string | null, now: Date = new Date()): string {
  return parseAirDate(input) ?? formatAirDate(now);
}

function formatAirDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: AIR_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

/** WP_API_URL is the wp/v2 base; this endpoint lives on the swm/v1 namespace. */
function swmApiBase(): string | null {
  const apiUrl = process.env.WP_API_URL?.trim();
  if (!apiUrl) return null;
  return apiUrl.replace(/\/wp\/v2\/?$/, "");
}

function parseCandidateId(value: unknown): number | null {
  const raw =
    typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : typeof value === "string"
        ? value.trim()
        : "";
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

function parseCandidate(value: unknown): LiveStreamCandidate | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = parseCandidateId(raw.id);
  if (id == null) return null;

  // The YouTube id match in publishToWordPress is the safety check. Do not
  // reject on candidate.date: that parse depends on the server timezone.
  const youtubeId = typeof raw.youtube_id === "string" ? raw.youtube_id.trim() : "";
  const rawDate = typeof raw.date === "string" ? raw.date : "";
  return {
    id,
    title: typeof raw.title === "string" ? raw.title : "",
    youtube_id: youtubeId,
    date: parseAirDate(rawDate) ?? rawDate.trim(),
  };
}

export async function findLiveStreamCandidate(
  wpShowId: number,
  airDate: string,
  youtubeId?: string
): Promise<LiveStreamCandidate | null> {
  const base = swmApiBase();
  if (!base) {
    console.warn(
      "[wordpress] Live-candidate lookup skipped (WP_API_URL unset); publishing without supersede."
    );
    return null;
  }

  const url = new URL(`${base}/swm/v1/dedup/live-candidate`);
  // Always send date. Older website code ignores youtube_id and filters by
  // this day. The follow-up ignores date when youtube_id is present.
  url.searchParams.set("show_id", String(wpShowId));
  url.searchParams.set("date", airDate);
  const liveVideoId = youtubeId?.trim() ?? "";
  if (liveVideoId) {
    url.searchParams.set("youtube_id", liveVideoId);
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: wpAuthorizationHeader() },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.warn(
        `[wordpress] Live-candidate lookup unavailable (HTTP ${response.status}); publishing without supersede.`
      );
      return null;
    }

    const body = (await response.json()) as unknown;
    if (!body || typeof body !== "object") {
      console.warn(
        "[wordpress] Live-candidate lookup returned an unexpected body; publishing without supersede."
      );
      return null;
    }

    const candidate = (body as { candidate?: unknown }).candidate;
    if (candidate == null) return null;

    const parsed = parseCandidate(candidate);
    if (!parsed) {
      console.warn(
        "[wordpress] Live-candidate response had an unusable candidate; publishing without supersede."
      );
      return null;
    }
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[wordpress] Live-candidate lookup failed (${message}); publishing without supersede.`
    );
    return null;
  }
}
