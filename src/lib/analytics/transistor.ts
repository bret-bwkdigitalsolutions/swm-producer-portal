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

  const res = await fetch(url.toString(), {
    headers: { "x-api-key": apiKey },
  });

  if (!res.ok) {
    throw new Error(`Transistor API error: ${res.status} ${res.statusText}`);
  }

  return res.json();
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
      }>("/analytics", apiKey, {
        show_id: showId,
        start_date: dateRange.from,
        end_date: dateRange.to,
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
        start_date: dateRange.from,
        end_date: dateRange.to,
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
      }>("/analytics/countries", apiKey, { show_id: showId });
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
      }>("/analytics/applications", apiKey, { show_id: showId });
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
      }>("/analytics/devices", apiKey, { show_id: showId });
      return raw.data?.attributes?.devices ?? [];
    }
  );
}
