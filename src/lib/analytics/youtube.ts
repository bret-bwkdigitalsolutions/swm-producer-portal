import "server-only";
import { getCached } from "./cache";
import { getYouTubeAccessToken } from "./credentials";
import type {
  YouTubeChannelStats,
  YouTubeVideo,
  YouTubeAnalyticsPoint,
  YouTubeTrafficSource,
  YouTubeCountryData,
  DateRange,
} from "./types";

const DATA_API_BASE = "https://www.googleapis.com/youtube/v3";
const ANALYTICS_API_BASE = "https://youtubeanalytics.googleapis.com/v2";

async function requireAccessToken(wpShowId: number): Promise<string> {
  const token = await getYouTubeAccessToken(wpShowId);
  if (!token) throw new Error("No YouTube credentials configured for this show.");
  return token;
}

async function fetchDataApi(
  accessToken: string,
  path: string,
  params: Record<string, string>
) {
  const url = new URL(`${DATA_API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`YouTube Data API error (${res.status}): ${text}`);
  }

  return res.json();
}

async function fetchAnalyticsApi(
  accessToken: string,
  params: {
    metrics: string;
    dimensions?: string;
    filters?: string;
    startDate: string;
    endDate: string;
  }
) {
  const url = new URL(`${ANALYTICS_API_BASE}/reports`);
  url.searchParams.set("ids", "channel==MINE");
  url.searchParams.set("metrics", params.metrics);
  if (params.dimensions) url.searchParams.set("dimensions", params.dimensions);
  if (params.filters) url.searchParams.set("filters", params.filters);
  url.searchParams.set("startDate", params.startDate);
  url.searchParams.set("endDate", params.endDate);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`YouTube Analytics API error (${res.status}): ${text}`);
  }

  return res.json();
}

export async function getYouTubeChannelStats(
  wpShowId: number
): Promise<YouTubeChannelStats> {
  const accessToken = await requireAccessToken(wpShowId);

  return getCached(
    `analytics:youtube:${wpShowId}:channel-stats`,
    3600,
    async () => {
      const data = await fetchDataApi(accessToken, "/channels", {
        part: "statistics",
        mine: "true",
      });

      const stats = data.items?.[0]?.statistics;
      if (!stats) throw new Error("No channel statistics found");

      return {
        subscriberCount: Number(stats.subscriberCount),
        viewCount: Number(stats.viewCount),
        videoCount: Number(stats.videoCount),
      };
    }
  );
}

export async function getYouTubeVideos(
  wpShowId: number,
  maxResults = 50
): Promise<YouTubeVideo[]> {
  const accessToken = await requireAccessToken(wpShowId);

  return getCached(
    `analytics:youtube:${wpShowId}:videos`,
    3600,
    async () => {
      const searchData = await fetchDataApi(accessToken, "/search", {
        part: "snippet",
        forMine: "true",
        type: "video",
        order: "date",
        maxResults: String(maxResults),
      });

      const videoIds: string[] = (searchData.items || []).map(
        (item: { id: { videoId: string } }) => item.id.videoId
      );

      if (videoIds.length === 0) return [];

      const videos: YouTubeVideo[] = [];
      for (let i = 0; i < videoIds.length; i += 50) {
        const chunk = videoIds.slice(i, i + 50);
        const detailData = await fetchDataApi(accessToken, "/videos", {
          part: "snippet,statistics,contentDetails",
          id: chunk.join(","),
        });

        for (const item of detailData.items || []) {
          videos.push({
            id: item.id,
            title: item.snippet.title,
            description: item.snippet.description,
            publishedAt: item.snippet.publishedAt,
            thumbnailUrl:
              item.snippet.thumbnails?.medium?.url ||
              item.snippet.thumbnails?.default?.url ||
              "",
            duration: item.contentDetails.duration,
            viewCount: Number(item.statistics.viewCount || 0),
            likeCount: Number(item.statistics.likeCount || 0),
            commentCount: Number(item.statistics.commentCount || 0),
          });
        }
      }

      return videos;
    }
  );
}

export async function getYouTubeChannelAnalytics(
  wpShowId: number,
  dateRange: DateRange
): Promise<YouTubeAnalyticsPoint[]> {
  const accessToken = await requireAccessToken(wpShowId);

  return getCached(
    `analytics:youtube:${wpShowId}:channel:${dateRange.from}:${dateRange.to}`,
    21600,
    async () => {
      const data = await fetchAnalyticsApi(accessToken, {
        metrics:
          "views,estimatedMinutesWatched,subscribersGained,subscribersLost",
        dimensions: "day",
        startDate: dateRange.from,
        endDate: dateRange.to,
      });

      return (data.rows || []).map((row: number[]) => ({
        date: row[0],
        views: row[1],
        estimatedMinutesWatched: row[2],
        subscribersGained: row[3],
        subscribersLost: row[4],
      }));
    }
  );
}

export async function getYouTubeVideoAnalytics(
  wpShowId: number,
  videoId: string,
  dateRange: DateRange
): Promise<YouTubeAnalyticsPoint[]> {
  const accessToken = await requireAccessToken(wpShowId);

  return getCached(
    `analytics:youtube:${wpShowId}:video:${videoId}:${dateRange.from}:${dateRange.to}`,
    21600,
    async () => {
      const data = await fetchAnalyticsApi(accessToken, {
        metrics:
          "views,estimatedMinutesWatched,subscribersGained,subscribersLost",
        dimensions: "day",
        filters: `video==${videoId}`,
        startDate: dateRange.from,
        endDate: dateRange.to,
      });

      return (data.rows || []).map((row: number[]) => ({
        date: row[0],
        views: row[1],
        estimatedMinutesWatched: row[2],
        subscribersGained: row[3],
        subscribersLost: row[4],
      }));
    }
  );
}

export async function getYouTubeTrafficSources(
  wpShowId: number,
  dateRange: DateRange
): Promise<YouTubeTrafficSource[]> {
  const accessToken = await requireAccessToken(wpShowId);

  return getCached(
    `analytics:youtube:${wpShowId}:traffic:${dateRange.from}:${dateRange.to}`,
    21600,
    async () => {
      const data = await fetchAnalyticsApi(accessToken, {
        metrics: "views,estimatedMinutesWatched",
        dimensions: "insightTrafficSourceType",
        startDate: dateRange.from,
        endDate: dateRange.to,
      });

      return (data.rows || []).map((row: (string | number)[]) => ({
        source: row[0] as string,
        views: row[1] as number,
        estimatedMinutesWatched: row[2] as number,
      }));
    }
  );
}

export async function getYouTubeGeoAnalytics(
  wpShowId: number,
  dateRange: DateRange
): Promise<YouTubeCountryData[]> {
  const accessToken = await requireAccessToken(wpShowId);

  return getCached(
    `analytics:youtube:${wpShowId}:geo:${dateRange.from}:${dateRange.to}`,
    21600,
    async () => {
      const data = await fetchAnalyticsApi(accessToken, {
        metrics: "views,estimatedMinutesWatched",
        dimensions: "country",
        startDate: dateRange.from,
        endDate: dateRange.to,
      });

      return (data.rows || []).map((row: (string | number)[]) => ({
        country: row[0] as string,
        views: row[1] as number,
        estimatedMinutesWatched: row[2] as number,
      }));
    }
  );
}
