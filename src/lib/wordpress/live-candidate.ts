import "server-only";

/**
 * Look up a live-stream `swm_episode` that a newly published episode should
 * replace. Contract from the website dedup endpoint:
 *   GET {WP}/wp-json/swm/v1/dedup/live-candidate?show_id=&date=
 *   → { candidate: { id, title, youtube_id, date } | null }
 *
 * Fail open: a 404 (endpoint not deployed yet) or any other error is logged
 * and treated as "no candidate" so publishing continues.
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
export function toAirDate(input?: string | null, now: Date = new Date()): string {
  const trimmed = input?.trim() ?? "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = trimmed ? new Date(trimmed) : now;
  const date = Number.isNaN(parsed.getTime()) ? now : parsed;
  return formatAirDate(date);
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

function wpAuthorizationHeader(): string {
  return (
    "Basic " +
    Buffer.from(
      `${process.env.WP_APP_USER ?? ""}:${process.env.WP_APP_PASSWORD ?? ""}`
    ).toString("base64")
  );
}

/** WP_API_URL is the wp/v2 base; this endpoint lives on the swm/v1 namespace. */
function swmApiBase(): string | null {
  const apiUrl = process.env.WP_API_URL?.trim();
  if (!apiUrl) return null;
  return apiUrl.replace(/\/wp\/v2\/?$/, "");
}

function parseCandidate(value: unknown): LiveStreamCandidate | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id =
    typeof raw.id === "number"
      ? raw.id
      : typeof raw.id === "string"
        ? Number(raw.id)
        : NaN;
  if (!Number.isInteger(id) || id <= 0) return null;
  return {
    id,
    title: typeof raw.title === "string" ? raw.title : "",
    youtube_id: typeof raw.youtube_id === "string" ? raw.youtube_id : "",
    date: typeof raw.date === "string" ? raw.date : "",
  };
}

export async function findLiveStreamCandidate(
  wpShowId: number,
  airDate: string
): Promise<LiveStreamCandidate | null> {
  const base = swmApiBase();
  if (!base) {
    console.warn(
      "[wordpress] Live-candidate lookup skipped (WP_API_URL unset); publishing without supersede."
    );
    return null;
  }

  const url = new URL(`${base}/swm/v1/dedup/live-candidate`);
  url.searchParams.set("show_id", String(wpShowId));
  url.searchParams.set("date", airDate);

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
