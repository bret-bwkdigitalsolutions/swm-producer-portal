import "server-only";
import { getCached } from "./cache";
import {
  getTransistorApiKey,
  resolvePlatformId,
  parseTransistorShowId,
} from "./credentials";
import type {
  TransistorShow,
  TransistorEpisode,
  TransistorAnalyticsPoint,
  TransistorCountryData,
  TransistorAppData,
  TransistorDeviceData,
  DateRange,
} from "./types";

const BASE_URL = "https://api.transistor.fm/v1";

// Transistor rate-limits to ~10 requests / 10 seconds and returns 429 when
// exceeded. A cache-cold dashboard load, a "Refresh Data" click, or the
// background scraper running concurrently can burst past that. Rather than let
// a transient 429 throw and blank the podcast panels, retry with backoff.
const MAX_ATTEMPTS = 4;

/** Convert yyyy-mm-dd to dd-mm-yyyy for Transistor API */
function toTransistorDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${d}-${m}-${y}`;
}

/** 429 (rate limit) and 5xx (server) are transient — worth retrying. */
export function isRetryableTransistorStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Backoff before the next attempt. Honors a `Retry-After` header (seconds) when
 * present and sane; otherwise exponential 1s/2s/4s with jitter to avoid a
 * thundering herd when several calls back off together. `attempt` is 1-based.
 */
export function computeTransistorBackoffMs(
  attempt: number,
  retryAfterHeader: string | null,
  jitterMs = 0
): number {
  const retryAfter = Number(retryAfterHeader);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.round(retryAfter * 1000);
  }
  return 2 ** (attempt - 1) * 1000 + jitterMs;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function transistorFetch<T>(
  path: string,
  apiKey: string,
  params?: Record<string, string>
): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url.toString(), {
      headers: { "x-api-key": apiKey },
    });

    if (res.ok) return res.json();

    lastError = new Error(
      `Transistor API error: ${res.status} ${res.statusText}`
    );

    if (!isRetryableTransistorStatus(res.status) || attempt === MAX_ATTEMPTS) {
      throw lastError;
    }

    const backoffMs = computeTransistorBackoffMs(
      attempt,
      res.headers.get("retry-after"),
      Math.floor(Math.random() * 250)
    );
    console.warn(
      `[transistor] ${res.status} on ${path} — retry ${attempt}/${MAX_ATTEMPTS - 1} in ${backoffMs}ms`
    );
    await sleep(backoffMs);
  }

  throw lastError ?? new Error("Transistor API error: exhausted retries");
}

async function requireApiKey(wpShowId: number): Promise<string> {
  const key = await getTransistorApiKey(wpShowId);
  if (!key) throw new Error("No Transistor API key configured for this show.");
  return key;
}

async function requireShowId(wpShowId: number): Promise<string> {
  const url = await resolvePlatformId(wpShowId, "transistor_show");
  if (!url) throw new Error("No Transistor show linked for this show.");
  return parseTransistorShowId(url);
}

export async function getTransistorShows(
  wpShowId: number
): Promise<TransistorShow[]> {
  const apiKey = await requireApiKey(wpShowId);

  return getCached(`analytics:transistor:${wpShowId}:shows`, 3600, async () => {
    const raw = await transistorFetch<{ data: TransistorShow[] }>(
      "/shows",
      apiKey
    );
    return raw.data ?? [];
  });
}

export async function getTransistorEpisodes(
  wpShowId: number
): Promise<TransistorEpisode[]> {
  const apiKey = await requireApiKey(wpShowId);
  const showId = await requireShowId(wpShowId);

  return getCached(
    `analytics:transistor:${wpShowId}:episodes`,
    3600,
    async () => {
      const raw = await transistorFetch<{ data: TransistorEpisode[] }>(
        "/episodes",
        apiKey,
        { show_id: showId }
      );
      return raw.data ?? [];
    }
  );
}

export async function getTransistorShowAnalytics(
  wpShowId: number,
  dateRange: DateRange
): Promise<TransistorAnalyticsPoint[]> {
  const apiKey = await requireApiKey(wpShowId);
  const showId = await requireShowId(wpShowId);

  return getCached(
    `analytics:transistor:${wpShowId}:show:${dateRange.from}:${dateRange.to}`,
    14400,
    async () => {
      const raw = await transistorFetch<{
        data: { attributes: { downloads: TransistorAnalyticsPoint[] } };
      }>(`/analytics/${showId}`, apiKey, {
        start_date: toTransistorDate(dateRange.from),
        end_date: toTransistorDate(dateRange.to),
      });
      return raw.data?.attributes?.downloads ?? [];
    }
  );
}

export async function getTransistorEpisodeAnalytics(
  wpShowId: number,
  episodeId: string,
  dateRange: DateRange
): Promise<TransistorAnalyticsPoint[]> {
  const apiKey = await requireApiKey(wpShowId);

  return getCached(
    `analytics:transistor:${wpShowId}:episode:${episodeId}:${dateRange.from}:${dateRange.to}`,
    14400,
    async () => {
      const raw = await transistorFetch<{
        data: { attributes: { downloads: TransistorAnalyticsPoint[] } };
      }>(`/analytics/episodes/${episodeId}`, apiKey, {
        start_date: toTransistorDate(dateRange.from),
        end_date: toTransistorDate(dateRange.to),
      });
      return raw.data?.attributes?.downloads ?? [];
    }
  );
}

export async function getTransistorCountryAnalytics(
  wpShowId: number
): Promise<TransistorCountryData[]> {
  const apiKey = await requireApiKey(wpShowId);
  const showId = await requireShowId(wpShowId);

  return getCached(
    `analytics:transistor:${wpShowId}:countries`,
    14400,
    async () => {
      const raw = await transistorFetch<{
        data: { attributes: { countries: TransistorCountryData[] } };
      }>(`/analytics/${showId}/countries`, apiKey);
      return raw.data?.attributes?.countries ?? [];
    }
  );
}

export async function getTransistorAppAnalytics(
  wpShowId: number
): Promise<TransistorAppData[]> {
  const apiKey = await requireApiKey(wpShowId);
  const showId = await requireShowId(wpShowId);

  return getCached(
    `analytics:transistor:${wpShowId}:apps`,
    14400,
    async () => {
      const raw = await transistorFetch<{
        data: { attributes: { applications: TransistorAppData[] } };
      }>(`/analytics/${showId}/applications`, apiKey);
      return raw.data?.attributes?.applications ?? [];
    }
  );
}

export async function getTransistorDeviceAnalytics(
  wpShowId: number
): Promise<TransistorDeviceData[]> {
  const apiKey = await requireApiKey(wpShowId);
  const showId = await requireShowId(wpShowId);

  return getCached(
    `analytics:transistor:${wpShowId}:devices`,
    14400,
    async () => {
      const raw = await transistorFetch<{
        data: { attributes: { devices: TransistorDeviceData[] } };
      }>(`/analytics/${showId}/devices`, apiKey);
      return raw.data?.attributes?.devices ?? [];
    }
  );
}
